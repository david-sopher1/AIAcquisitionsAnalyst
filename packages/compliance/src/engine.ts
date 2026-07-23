// ============================================================================
// Compliance engine — the single gate for ALL outbound communication.
//
// Every outbound touch (SMS, email, RVM, call, AI voice, mail) MUST pass
// checkOutbound() immediately before send. The engine evaluates, in order:
//
//   1. Global kill switch (OUTBOUND_ENABLED)
//   2. Suppression list (opt-outs, DNC requests, litigators, bounces)
//   3. Contact-point flags (opted_out, dnc_listed, litigator_risk)
//   4. Consent requirements (RVM / AI voice need express written consent)
//   5. Quiet hours in the RECIPIENT's local timezone (state-specific)
//   6. Frequency caps (per rolling 24h — state; per rolling 7d — config)
//   7. State-specific restrictions (e.g. MD pre-foreclosure channel limits)
//
// Every evaluation — allowed or blocked — is written to outbound_compliance_log.
// ============================================================================

import {
  audit,
  getConfig,
  logger,
  query,
  queryOne,
  type Channel,
} from "@dealengine/shared";
import { isOptOutMessage, localTimeParts, rulesForState } from "./state-rules.js";

export interface OutboundCheckInput {
  leadId: string;
  touchId?: string;
  channel: Channel;
  /** E.164 phone, email address, or mailing address string. */
  contactValue: string;
  contactPointId?: string;
  /** Recipient state (two-letter) — from the property/market. */
  state: string;
  /** IANA timezone of the recipient's market. */
  timezone: string;
  /** True if this lead has a pre_foreclosure distress flag. */
  isPreForeclosure?: boolean;
}

export interface OutboundCheckResult {
  allowed: boolean;
  blockedReason: string | null;
  checks: Record<string, { pass: boolean; detail?: string }>;
  /** If blocked only by quiet hours, the earliest time a retry may succeed. */
  retryAfter?: Date;
}

const PHONE_CHANNELS: Channel[] = ["sms", "mms", "rvm", "cold_call", "ai_voice"];
const MAIL_CHANNELS: Channel[] = ["direct_mail", "handwritten_mail"];

export async function checkOutbound(input: OutboundCheckInput): Promise<OutboundCheckResult> {
  const cfg = getConfig();
  const checks: OutboundCheckResult["checks"] = {};
  let blockedReason: string | null = null;
  let retryAfter: Date | undefined;

  const block = (rule: string, detail: string) => {
    checks[rule] = { pass: false, detail };
    if (!blockedReason) blockedReason = `${rule}: ${detail}`;
  };
  const pass = (rule: string, detail?: string) => {
    checks[rule] = { pass: true, detail };
  };

  // 1. Kill switch --------------------------------------------------------
  if (!cfg.OUTBOUND_ENABLED) {
    block("kill_switch", "OUTBOUND_ENABLED=false");
  } else {
    pass("kill_switch");
  }

  // 2. Suppression list ---------------------------------------------------
  const valueType = PHONE_CHANNELS.includes(input.channel)
    ? "phone"
    : input.channel === "email"
      ? "email"
      : "address";
  const suppressed = await queryOne(
    `SELECT reason FROM suppressions WHERE value = $1 AND value_type = $2`,
    [input.contactValue, valueType],
  );
  if (suppressed) {
    block("suppression", `suppressed (${(suppressed as { reason: string }).reason})`);
  } else {
    pass("suppression");
  }

  // 3. Contact-point flags ------------------------------------------------
  if (input.contactPointId) {
    const cp = await queryOne<{ opted_out: boolean; dnc_listed: boolean; litigator_risk: boolean }>(
      `SELECT opted_out, dnc_listed, litigator_risk FROM contact_points WHERE id = $1`,
      [input.contactPointId],
    );
    if (cp?.opted_out) block("opt_out", "contact opted out");
    else if (cp?.litigator_risk) block("litigator", "flagged litigator risk");
    else if (cp?.dnc_listed && ["cold_call", "ai_voice", "rvm"].includes(input.channel))
      block("dnc", "number on DNC list — voice channels blocked");
    else pass("contact_flags");
  } else {
    pass("contact_flags", "no contact point id provided");
  }

  // 4. Consent requirements ----------------------------------------------
  const rules = rulesForState(input.state);
  if (rules.consentRequiredChannels.includes(input.channel)) {
    const consent = await queryOne(
      `SELECT 1 FROM consent_events ce
        JOIN contact_points cp ON cp.id = ce.contact_point_id
       WHERE cp.value = $1
         AND ce.kind = 'express_written_consent'
         AND NOT EXISTS (
           SELECT 1 FROM consent_events r
            WHERE r.contact_point_id = ce.contact_point_id
              AND r.kind IN ('revoked','opt_out','dnc_request')
              AND r.occurred_at > ce.occurred_at)
       LIMIT 1`,
      [input.contactValue],
    );
    if (!consent) {
      block("consent", `${input.channel} requires prior express written consent`);
    } else {
      pass("consent");
    }
  } else {
    pass("consent", "not required for channel");
  }

  // 5. Quiet hours (skip for mail + email) --------------------------------
  if (!MAIL_CHANNELS.includes(input.channel) && input.channel !== "email") {
    const { hour, weekday } = localTimeParts(input.timezone);
    const withinHours = hour >= rules.quietStartHour && hour < rules.quietEndHour;
    const sundayBlocked = rules.noSunday && weekday === 0;
    // Texas Sunday window: noon–9pm
    const txSundayBlocked = rules.state === "TX" && weekday === 0 && hour < 12;
    if (!withinHours || sundayBlocked || txSundayBlocked) {
      block(
        "quiet_hours",
        `local hour ${hour} outside ${rules.quietStartHour}:00–${rules.quietEndHour}:00 (${rules.state})`,
      );
      retryAfter = nextAllowedTime(input.timezone, rules.quietStartHour);
    } else {
      pass("quiet_hours", `local hour ${hour}`);
    }
  } else {
    pass("quiet_hours", "channel exempt");
  }

  // 6. Frequency caps -----------------------------------------------------
  if (PHONE_CHANNELS.includes(input.channel)) {
    const cap24 = rules.maxContactsPer24h;
    if (cap24 != null) {
      const { rows } = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM touches
          WHERE lead_id = $1 AND channel = ANY($2::channel[])
            AND status IN ('sent','delivered','queued')
            AND sent_at > now() - interval '24 hours'`,
        [input.leadId, PHONE_CHANNELS],
      );
      const n = parseInt(rows[0]?.n ?? "0", 10);
      if (n >= cap24) block("cap_24h", `${n}/${cap24} contacts in 24h (${rules.state})`);
      else pass("cap_24h", `${n}/${cap24}`);
    } else {
      pass("cap_24h", "no state cap");
    }

    if (input.channel === "sms" || input.channel === "mms") {
      const { rows } = await query<{ n: string }>(
        `SELECT count(*)::text AS n FROM touches
          WHERE lead_id = $1 AND channel IN ('sms','mms')
            AND status IN ('sent','delivered','queued')
            AND sent_at > now() - interval '7 days'`,
        [input.leadId],
      );
      const n = parseInt(rows[0]?.n ?? "0", 10);
      if (n >= cfg.SMS_WEEKLY_CAP) block("cap_weekly_sms", `${n}/${cfg.SMS_WEEKLY_CAP} SMS in 7d`);
      else pass("cap_weekly_sms", `${n}/${cfg.SMS_WEEKLY_CAP}`);
    }
  }

  // 7. State-specific restrictions ---------------------------------------
  if (input.isPreForeclosure && rules.state === "MD" && !MAIL_CHANNELS.includes(input.channel)) {
    block(
      "md_phifa",
      "MD pre-foreclosure leads: mail-first policy (PHIFA). Phone/SMS requires attorney-reviewed process.",
    );
  } else {
    pass("state_specific");
  }

  const allowed = blockedReason === null;

  // Log every evaluation --------------------------------------------------
  try {
    await query(
      `INSERT INTO outbound_compliance_log
         (touch_id, lead_id, contact_value, channel, allowed, blocked_reason, checks)
       VALUES ($1, $2, $3, $4::channel, $5, $6, $7)`,
      [
        input.touchId ?? null,
        input.leadId,
        input.contactValue,
        input.channel,
        allowed,
        blockedReason,
        JSON.stringify(checks),
      ],
    );
  } catch (err) {
    logger.error({ err }, "failed to write compliance log");
  }

  return { allowed, blockedReason, checks, retryAfter };
}

function nextAllowedTime(tz: string, startHour: number): Date {
  // Walk forward hour by hour until inside the window (max 24 steps).
  const now = new Date();
  for (let i = 1; i <= 24; i++) {
    const candidate = new Date(now.getTime() + i * 3600_000);
    const { hour } = localTimeParts(tz, candidate);
    if (hour >= startHour) return candidate;
  }
  return new Date(now.getTime() + 12 * 3600_000);
}

// ---------------------------------------------------------------------------
// Opt-out processing — call for EVERY inbound message before anything else.
// ---------------------------------------------------------------------------
export async function processInboundForOptOut(params: {
  contactValue: string;
  contactPointId?: string;
  leadId?: string;
  channel: Channel;
  body: string;
}): Promise<boolean> {
  if (!isOptOutMessage(params.body)) return false;

  const valueType = params.channel === "email" ? "email" : "phone";
  await query(
    `INSERT INTO suppressions (value, value_type, reason, source)
     VALUES ($1, $2, 'opt_out', $3)
     ON CONFLICT (value, value_type) DO NOTHING`,
    [params.contactValue, valueType, params.channel],
  );
  if (params.contactPointId) {
    await query(`UPDATE contact_points SET opted_out = true WHERE id = $1`, [
      params.contactPointId,
    ]);
    await query(
      `INSERT INTO consent_events (contact_point_id, lead_id, kind, channel, evidence)
       VALUES ($1, $2, 'opt_out', $3::channel, $4)`,
      [params.contactPointId, params.leadId ?? null, params.channel, JSON.stringify({ body: params.body })],
    );
  }
  if (params.leadId) {
    await query(
      `UPDATE leads SET status = 'suppressed', archived_reason = 'opt_out' WHERE id = $1`,
      [params.leadId],
    );
    // Cancel all pending touches for this lead across every channel.
    await query(
      `UPDATE touches SET status = 'canceled'
        WHERE lead_id = $1 AND status IN ('scheduled','queued')`,
      [params.leadId],
    );
  }
  await audit("system:compliance", "opt_out", "contact", params.contactValue, null, {
    channel: params.channel,
    body: params.body,
  });
  logger.info({ contact: params.contactValue }, "opt-out processed; lead suppressed");
  return true;
}
