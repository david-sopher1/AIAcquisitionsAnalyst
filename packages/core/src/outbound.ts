// ============================================================================
// Outbound dispatcher — the ONLY code path that sends anything to a seller.
// Compliance gate → channel adapter → persistence. Called by the Temporal
// outreach workflow and by human sends from the dashboard.
// ============================================================================

import {
  audit,
  getConfig,
  logger,
  query,
  queryOne,
  type Channel,
} from "@dealengine/shared";
import { checkOutbound } from "@dealengine/compliance";
import { dropcowboy, lob, sendgrid, twilio } from "@dealengine/integrations";
import { EMAIL_TEMPLATES, RVM_SCRIPT, SMS_TEMPLATES } from "@dealengine/ai";

export interface SendTouchInput {
  leadId: string;
  channel: Channel;
  templateKey?: string;
  /** Explicit body overrides the template (AI replies, human sends). */
  body?: string;
  campaignId?: string | null;
  sequenceKey?: string | null;
  stepNo?: number | null;
  actor?: string; // 'system:outreach' | user id
}

export interface SendTouchResult {
  status: "sent" | "blocked_compliance" | "failed" | "skipped";
  touchId: string | null;
  blockedReason?: string;
  retryAfter?: string;
}

export async function sendTouch(input: SendTouchInput): Promise<SendTouchResult> {
  const cfg = getConfig();

  // --- Load lead + contact + market context ------------------------------
  const lead = await queryOne<{
    id: string;
    status: string;
    human_takeover: boolean;
    address_line1: string;
    city: string;
    state: string;
    zip: string;
    timezone: string | null;
    owner_first: string | null;
    owner_name: string | null;
    mailing_line1: string | null;
    mailing_city: string | null;
    mailing_state: string | null;
    mailing_zip: string | null;
    pre_foreclosure: boolean;
  }>(
    `SELECT l.id, l.status, l.human_takeover,
            p.address_line1, p.city, p.state, p.zip,
            m.timezone,
            o.first_name AS owner_first, o.name_raw AS owner_name,
            o.mailing_line1, o.mailing_city, o.mailing_state, o.mailing_zip,
            EXISTS (SELECT 1 FROM lead_distress_flags f
                     WHERE f.lead_id = l.id AND f.flag = 'pre_foreclosure') AS pre_foreclosure
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN markets m ON m.id = l.market_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [input.leadId],
  );
  if (!lead) return { status: "failed", touchId: null, blockedReason: "lead not found" };
  if (["suppressed", "dead", "closed_won", "closed_lost"].includes(lead.status)) {
    return { status: "skipped", touchId: null, blockedReason: `lead status ${lead.status}` };
  }
  // AI never talks over the human once takeover is on (human sends pass actor).
  if (lead.human_takeover && (input.actor ?? "").startsWith("system:")) {
    return { status: "skipped", touchId: null, blockedReason: "human takeover active" };
  }

  // --- Pick contact point -------------------------------------------------
  const phoneChannels: Channel[] = ["sms", "mms", "rvm", "cold_call", "ai_voice"];
  let contact: { id: string; value: string } | null = null;
  if (phoneChannels.includes(input.channel)) {
    contact = await queryOne(
      `SELECT id, value FROM contact_points
        WHERE lead_id = $1 AND type IN ('phone_mobile','phone_unknown')
          AND NOT opted_out AND NOT litigator_risk
        ORDER BY preferred DESC, confidence DESC NULLS LAST
        LIMIT 1`,
      [input.leadId],
    );
  } else if (input.channel === "email") {
    contact = await queryOne(
      `SELECT id, value FROM contact_points
        WHERE lead_id = $1 AND type = 'email' AND NOT opted_out
        ORDER BY confidence DESC NULLS LAST LIMIT 1`,
      [input.leadId],
    );
  }
  if (!contact && !["direct_mail", "handwritten_mail"].includes(input.channel)) {
    return { status: "skipped", touchId: null, blockedReason: "no usable contact point" };
  }

  const contactValue =
    contact?.value ??
    `${lead.mailing_line1 ?? lead.address_line1}, ${lead.mailing_city ?? lead.city}, ${lead.mailing_state ?? lead.state} ${lead.mailing_zip ?? lead.zip}`;

  // --- Create the touch row ----------------------------------------------
  const touch = await queryOne<{ id: string }>(
    `INSERT INTO touches (lead_id, campaign_id, sequence_key, step_no, channel,
                          contact_point_id, scheduled_at, status)
     VALUES ($1,$2,$3,$4,$5::channel,$6, now(), 'queued') RETURNING id`,
    [input.leadId, input.campaignId ?? null, input.sequenceKey ?? null,
     input.stepNo ?? null, input.channel, contact?.id ?? null],
  );
  const touchId = touch!.id;

  // --- Compliance gate ----------------------------------------------------
  const check = await checkOutbound({
    leadId: input.leadId,
    touchId,
    channel: input.channel,
    contactValue,
    contactPointId: contact?.id,
    state: lead.state,
    timezone: lead.timezone ?? "America/New_York",
    isPreForeclosure: lead.pre_foreclosure,
  });
  if (!check.allowed) {
    await query(
      `UPDATE touches SET status = 'blocked_compliance', meta = meta || $2 WHERE id = $1`,
      [touchId, JSON.stringify({ blockedReason: check.blockedReason })],
    );
    return {
      status: "blocked_compliance",
      touchId,
      blockedReason: check.blockedReason ?? undefined,
      retryAfter: check.retryAfter?.toISOString(),
    };
  }

  // --- Render body --------------------------------------------------------
  const templateParams = {
    firstName: lead.owner_first,
    address: `${lead.address_line1}`,
    operatorName: cfg.OWNER_NAME,
    companyName: `${cfg.OWNER_NAME} Home Buyers`,
  };
  let body = input.body ?? "";
  if (!body && input.templateKey) {
    if (input.channel === "sms" || input.channel === "mms") {
      body = SMS_TEMPLATES[input.templateKey]?.(templateParams) ?? "";
    } else if (input.channel === "email") {
      body = EMAIL_TEMPLATES[input.templateKey]?.(templateParams)?.body ?? "";
    } else if (input.channel === "rvm") {
      body = RVM_SCRIPT(templateParams);
    }
  }
  if (!body && ["sms", "mms", "email"].includes(input.channel)) {
    await query(`UPDATE touches SET status = 'failed' WHERE id = $1`, [touchId]);
    return { status: "failed", touchId, blockedReason: "empty body / unknown template" };
  }

  // --- Dispatch -----------------------------------------------------------
  try {
    let providerMessageId = "";
    let provider = "";
    let costCents = 0;

    switch (input.channel) {
      case "sms":
      case "mms": {
        const res = await twilio.sendSms({
          to: contactValue,
          body,
          statusCallback: `${cfg.APP_BASE_URL}/webhooks/twilio/status`,
        });
        providerMessageId = res.providerMessageId;
        provider = "twilio";
        costCents = 2;
        break;
      }
      case "email": {
        const tmpl = input.templateKey
          ? EMAIL_TEMPLATES[input.templateKey]?.(templateParams)
          : null;
        const res = await sendgrid.sendEmail({
          to: contactValue,
          subject: tmpl?.subject ?? `About your property at ${lead.address_line1}`,
          text: body,
          categories: ["dealengine"],
        });
        providerMessageId = res.providerMessageId;
        provider = "sendgrid";
        costCents = 0;
        break;
      }
      case "rvm": {
        const res = await dropcowboy.sendRvm({
          to: contactValue,
          audioUrl: `${cfg.APP_BASE_URL}/assets/rvm/default.mp3`,
          callbackNumber: cfg.TWILIO_FROM_NUMBER ?? cfg.OWNER_PHONE ?? "",
          foreignId: touchId,
        });
        providerMessageId = res.providerMessageId;
        provider = "dropcowboy";
        costCents = 8;
        break;
      }
      case "direct_mail": {
        const res = await lob.sendPostcard({
          toName: lead.owner_name ?? "Property Owner",
          toLine1: lead.mailing_line1 ?? lead.address_line1,
          toCity: lead.mailing_city ?? lead.city,
          toState: lead.mailing_state ?? lead.state,
          toZip: lead.mailing_zip ?? lead.zip,
          frontTemplateId: "tmpl_front_default",
          backTemplateId: "tmpl_back_default",
          mergeVariables: {
            owner_name: lead.owner_first ?? "Neighbor",
            address: lead.address_line1,
            phone: cfg.TWILIO_FROM_NUMBER ?? "",
            operator: cfg.OWNER_NAME,
          },
        });
        providerMessageId = res.providerMessageId;
        provider = "lob";
        costCents = 75;
        break;
      }
      case "handwritten_mail": {
        const res = await lob.sendHandwrittenCard({
          toName: lead.owner_name ?? "Property Owner",
          toLine1: lead.mailing_line1 ?? lead.address_line1,
          toCity: lead.mailing_city ?? lead.city,
          toState: lead.mailing_state ?? lead.state,
          toZip: lead.mailing_zip ?? lead.zip,
          message:
            body ||
            `Hi ${lead.owner_first ?? "there"}, I'm a local buyer interested in your property on ${lead.address_line1}. If you'd ever consider selling, I'd love to make you a fair cash offer — no fees, no repairs. Call or text me anytime. — ${cfg.OWNER_NAME}`,
        });
        providerMessageId = res.providerMessageId;
        provider = "handwrytten";
        costCents = 325;
        break;
      }
      case "ai_voice":
      case "cold_call":
        // Voice is initiated by the workers (Retell) — sendTouch records intent only.
        provider = "retell";
        break;
    }

    await query(
      `UPDATE touches SET status = 'sent', sent_at = now(), provider = $2,
              provider_message_id = $3, cost_cents = $4, body_preview = left($5, 200)
        WHERE id = $1`,
      [touchId, provider, providerMessageId, costCents, body],
    );
    await query(
      `UPDATE leads SET last_contact_at = now(),
              status = CASE WHEN status IN ('scored','skip_traced') THEN 'in_outreach' ELSE status END
        WHERE id = $1`,
      [input.leadId],
    );

    // Log outbound SMS/email into the conversation thread too.
    if (["sms", "mms", "email"].includes(input.channel) && contact) {
      const convo = await queryOne<{ id: string }>(
        `INSERT INTO conversations (lead_id, channel, contact_point_id)
         VALUES ($1, $2::channel, $3)
         ON CONFLICT (lead_id, channel, contact_point_id)
         DO UPDATE SET last_outbound_at = now()
         RETURNING id`,
        [input.leadId, input.channel === "mms" ? "sms" : input.channel, contact.id],
      );
      await query(
        `INSERT INTO messages (conversation_id, direction, channel, body, provider_message_id, ai_generated)
         VALUES ($1, 'outbound', $2::channel, $3, $4, $5)`,
        [convo!.id, input.channel, body, providerMessageId,
         (input.actor ?? "system:").startsWith("system:")],
      );
    }

    await audit(input.actor ?? "system:outreach", "touch_sent", "touch", touchId, null, {
      channel: input.channel,
      leadId: input.leadId,
    });
    return { status: "sent", touchId };
  } catch (err) {
    logger.error({ err, touchId, channel: input.channel }, "touch send failed");
    await query(`UPDATE touches SET status = 'failed', meta = meta || $2 WHERE id = $1`, [
      touchId,
      JSON.stringify({ error: String(err) }),
    ]);
    return { status: "failed", touchId, blockedReason: String(err) };
  }
}
