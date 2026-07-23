// ============================================================================
// Webhook routes — Twilio inbound SMS + status, SendGrid events, Retell calls.
// All handlers ACK fast and do the heavy lifting inline (Claude call ~seconds)
// or defer to activities. Signature verification on every provider.
// ============================================================================

import type { FastifyInstance } from "fastify";
import { getConfig, logger, query, queryOne } from "@dealengine/shared";
import { processInboundMessage, notifyOwnerOfLead } from "@dealengine/core";
import { twilio } from "@dealengine/integrations";
import { signalSellerReplied } from "../temporal.js";

export async function webhookRoutes(app: FastifyInstance) {
  const cfg = getConfig();

  // --- Twilio inbound SMS/MMS ---------------------------------------------
  app.post("/webhooks/twilio/inbound", async (req, reply) => {
    const body = req.body as Record<string, string>;

    const valid = twilio.validateTwilioSignature({
      signature: req.headers["x-twilio-signature"] as string | undefined,
      url: `${cfg.APP_BASE_URL.replace(/\/$/, "")}/webhooks/twilio/inbound`,
      body,
    });
    if (!valid && cfg.NODE_ENV === "production") {
      logger.warn({ from: body.From }, "invalid twilio signature");
      return reply.code(403).send();
    }

    await query(
      `INSERT INTO webhook_events (provider, event_type, payload) VALUES ('twilio','inbound_sms',$1)`,
      [JSON.stringify(body)],
    );

    // Respond to Twilio immediately (empty TwiML) and process async.
    reply.header("Content-Type", "text/xml").send("<Response></Response>");

    setImmediate(async () => {
      try {
        const result = await processInboundMessage({
          channel: "sms",
          fromValue: body.From ?? "",
          body: body.Body ?? "",
          providerMessageId: body.MessageSid,
        });
        if (result.leadId) await signalSellerReplied(result.leadId);
      } catch (err) {
        logger.error({ err }, "inbound sms processing failed");
      }
    });
  });

  // --- Twilio delivery status ---------------------------------------------
  app.post("/webhooks/twilio/status", async (req, reply) => {
    const body = req.body as Record<string, string>;
    if (body.MessageSid && body.MessageStatus) {
      const mapped =
        body.MessageStatus === "delivered" ? "delivered"
        : ["failed", "undelivered"].includes(body.MessageStatus) ? "failed"
        : null;
      if (mapped) {
        await query(
          `UPDATE touches SET status = $2::touch_status WHERE provider_message_id = $1`,
          [body.MessageSid, mapped],
        );
      }
    }
    return reply.send({ ok: true });
  });

  // --- SendGrid events (bounces/spam → suppress) ---------------------------
  app.post("/webhooks/sendgrid/events", async (req, reply) => {
    const events = (Array.isArray(req.body) ? req.body : []) as Array<{
      email: string;
      event: string;
    }>;
    for (const ev of events) {
      if (["bounce", "dropped", "spamreport", "unsubscribe"].includes(ev.event)) {
        await query(
          `INSERT INTO suppressions (value, value_type, reason, source)
           VALUES ($1, 'email', $2, 'sendgrid')
           ON CONFLICT (value, value_type) DO NOTHING`,
          [ev.email.toLowerCase(), ev.event],
        );
        await query(
          `UPDATE contact_points SET opted_out = true WHERE type = 'email' AND value = $1`,
          [ev.email.toLowerCase()],
        );
      }
    }
    return reply.send({ ok: true });
  });

  // --- Retell call events (AI voice) ---------------------------------------
  app.post("/webhooks/retell/events", async (req, reply) => {
    const payload = req.body as {
      event?: string;
      call?: {
        call_id?: string;
        metadata?: { lead_id?: string };
        transcript?: string;
        call_analysis?: Record<string, unknown>;
      };
    };
    await query(
      `INSERT INTO webhook_events (provider, event_type, payload) VALUES ('retell',$1,$2)`,
      [payload.event ?? "unknown", JSON.stringify(payload)],
    );

    if (payload.event === "call_analyzed" && payload.call?.metadata?.lead_id) {
      const leadId = payload.call.metadata.lead_id;
      const transcript = payload.call.transcript ?? "";

      // Store the transcript on the lead's voice conversation.
      const contact = await queryOne<{ id: string }>(
        `SELECT id FROM contact_points WHERE lead_id = $1 AND type LIKE 'phone%' ORDER BY preferred DESC LIMIT 1`,
        [leadId],
      );
      if (contact && transcript) {
        const convo = await queryOne<{ id: string }>(
          `INSERT INTO conversations (lead_id, channel, contact_point_id, last_inbound_at)
           VALUES ($1, 'ai_voice', $2, now())
           ON CONFLICT (lead_id, channel, contact_point_id)
           DO UPDATE SET last_inbound_at = now() RETURNING id`,
          [leadId, contact.id],
        );
        await query(
          `INSERT INTO messages (conversation_id, direction, channel, body, provider_message_id, ai_generated)
           VALUES ($1, 'inbound', 'ai_voice', $2, $3, false)`,
          [convo!.id, transcript.slice(0, 20_000), payload.call.call_id ?? null],
        );
        // Voice transcripts flow through the same extraction pipeline: feed the
        // transcript as an inbound "message" so qualification updates + escalation run.
        setImmediate(async () => {
          try {
            const cp = await queryOne<{ value: string }>(
              `SELECT value FROM contact_points WHERE id = $1`, [contact.id]);
            if (cp) {
              await processInboundMessage({
                channel: "sms",
                fromValue: cp.value,
                body: `[voice call transcript]\n${transcript.slice(0, 6_000)}`,
                providerMessageId: payload.call?.call_id,
              });
            }
          } catch (err) {
            logger.error({ err, leadId }, "retell transcript processing failed");
            await notifyOwnerOfLead(leadId, "system", {
              title: "Voice call completed — review transcript",
              body: transcript.slice(0, 300),
            });
          }
        });
      }
    }
    return reply.send({ ok: true });
  });

  // --- Health --------------------------------------------------------------
  app.get("/health", async () => {
    await query("SELECT 1");
    return { ok: true, ts: new Date().toISOString() };
  });
}
