// ============================================================================
// Notification Agent — fanout to the human closer: SMS + email + Slack +
// dashboard. Builds the full deal-summary brief for warm/hot escalations.
// ============================================================================

import {
  centsToUsd,
  getConfig,
  logger,
  query,
  queryOne,
} from "@dealengine/shared";
import { sendgrid, slack, twilio } from "@dealengine/integrations";
import { generateDealSummary } from "@dealengine/ai";

export async function notifyOwnerOfLead(
  leadId: string,
  kind: "warm_lead" | "hot_lead" | "callback" | "reply_during_takeover" | "ai_error" | "system",
  fallback: { title: string; body: string },
): Promise<void> {
  const cfg = getConfig();

  const lead = await queryOne<{
    address_line1: string;
    city: string;
    state: string;
    temperature: string;
    owner_name: string | null;
    phone: string | null;
  }>(
    `SELECT p.address_line1, p.city, p.state, l.temperature,
            o.name_raw AS owner_name,
            (SELECT value FROM contact_points cp
              WHERE cp.lead_id = l.id AND cp.type LIKE 'phone%' AND NOT cp.opted_out
              ORDER BY preferred DESC LIMIT 1) AS phone
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!lead) return;

  let title = fallback.title;
  let body = fallback.body;
  let brief: Record<string, unknown> | null = null;

  // Rich deal summary for escalations.
  if (kind === "warm_lead" || kind === "hot_lead") {
    try {
      const qual = await queryOne<Record<string, unknown>>(
        `SELECT * FROM qualifications WHERE lead_id = $1`, [leadId]);
      const deal = await queryOne<{
        arv_cents: string; repairs_cents: string; mao_cents: string; strategy: string;
      }>(
        `SELECT arv_cents::text, repairs_cents::text, mao_cents::text, strategy
           FROM deal_analyses WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [leadId],
      );
      const flags = await query<{ flag: string }>(
        `SELECT flag FROM lead_distress_flags WHERE lead_id = $1`, [leadId]);
      const transcript = await query<{ direction: string; body: string }>(
        `SELECT m.direction, m.body FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
         WHERE c.lead_id = $1 ORDER BY m.sent_at ASC LIMIT 100`,
        [leadId],
      );

      const summary = await generateDealSummary({
        address: `${lead.address_line1}, ${lead.city}, ${lead.state}`,
        ownerName: lead.owner_name ?? "Unknown owner",
        flags: flags.rows.map((r) => r.flag),
        qualification: qual ?? {},
        arvCents: deal ? parseInt(deal.arv_cents, 10) : null,
        repairsCents: deal ? parseInt(deal.repairs_cents, 10) : null,
        maoCents: deal ? parseInt(deal.mao_cents, 10) : null,
        strategy: deal?.strategy ?? null,
        conversationTranscript: transcript.rows
          .map((m) => `${m.direction === "inbound" ? "Seller" : "Us"}: ${m.body}`)
          .join("\n"),
      });

      title = `${lead.temperature.toUpperCase()} — ${summary.headline}`;
      body = [
        `📍 ${lead.address_line1}, ${lead.city}, ${lead.state}`,
        `👤 ${lead.owner_name ?? "Unknown"} • ${lead.phone ?? "no phone"}`,
        deal ? `💰 ARV ${centsToUsd(parseInt(deal.arv_cents, 10))} • Repairs ${centsToUsd(parseInt(deal.repairs_cents, 10))} • MAO ${centsToUsd(parseInt(deal.mao_cents, 10))} • ${deal.strategy}` : "",
        `Motivation: ${summary.motivation}`,
        `Timeline: ${summary.timeline}`,
        `Price: ${summary.price_expectation}`,
        `Condition: ${summary.condition}`,
        `🎯 Angle: ${summary.negotiation_angle}`,
        summary.risk_factors.length ? `⚠️ Risks: ${summary.risk_factors.join("; ")}` : "",
        `Next: ${summary.recommended_next_action}`,
      ]
        .filter(Boolean)
        .join("\n");
      brief = summary as unknown as Record<string, unknown>;
    } catch (err) {
      logger.warn({ err, leadId }, "deal summary generation failed; using fallback text");
    }
  }

  const channels: Array<{ channel: string; ok: boolean }> = [];

  // SMS to the owner (short version).
  if (cfg.OWNER_PHONE) {
    try {
      await twilio.sendSms({
        to: cfg.OWNER_PHONE,
        body: `${title}\n${lead.phone ? `Seller: ${lead.phone}\n` : ""}${cfg.APP_BASE_URL}/leads/${leadId}`,
      });
      channels.push({ channel: "sms", ok: true });
    } catch (err) {
      logger.error({ err }, "owner SMS notify failed");
      channels.push({ channel: "sms", ok: false });
    }
  }

  // Email (full brief).
  if (cfg.OWNER_EMAIL) {
    try {
      await sendgrid.sendEmail({
        to: cfg.OWNER_EMAIL,
        subject: title,
        text: `${body}\n\nOpen: ${cfg.APP_BASE_URL}/leads/${leadId}`,
        categories: ["dealengine-notify"],
      });
      channels.push({ channel: "email", ok: true });
    } catch (err) {
      logger.error({ err }, "owner email notify failed");
      channels.push({ channel: "email", ok: false });
    }
  }

  // Slack (full brief).
  const slackOk = await slack.postSlack({
    text: `*${title}*\n${body}\n<${cfg.APP_BASE_URL}/leads/${leadId}|Open lead>`,
  });
  channels.push({ channel: "slack", ok: slackOk });

  // Dashboard notification (always).
  await query(
    `INSERT INTO notifications (kind, lead_id, title, body, payload, channels)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [kind, leadId, title, body, JSON.stringify({ brief }), JSON.stringify(channels)],
  );

  logger.info({ leadId, kind, channels }, "owner notified");
}
