// ============================================================================
// Inbound message processing — the heart of the Conversation Agent loop.
//
//   1. Persist the inbound message
//   2. Opt-out check (before anything else)
//   3. Claude turn: reply + intent + extraction + escalation
//   4. Persist qualification updates, temperature, status transitions
//   5. Send AI reply through the outbound gate (unless human takeover)
//   6. Escalate → underwrite + deal summary + notify owner
// ============================================================================

import {
  audit,
  getConfig,
  logger,
  query,
  queryOne,
  type Channel,
} from "@dealengine/shared";
import { processInboundForOptOut } from "@dealengine/compliance";
import { deriveTemperature } from "@dealengine/scoring";
import {
  generateConversationTurn,
  type ConversationTurnOutput,
  type HistoryMessage,
} from "@dealengine/ai";
import { sendTouch } from "./outbound.js";
import { notifyOwnerOfLead } from "./notify.js";
import { underwriteLead } from "./underwrite.js";

export interface InboundMessageInput {
  channel: Channel;          // sms | email
  fromValue: string;         // E.164 phone or email
  body: string;
  providerMessageId?: string;
}

export async function processInboundMessage(input: InboundMessageInput): Promise<{
  handled: boolean;
  leadId?: string;
  action?: string;
}> {
  // --- Resolve contact point + lead --------------------------------------
  const contact = await queryOne<{ id: string; lead_id: string | null; owner_id: string | null }>(
    `SELECT id, lead_id, owner_id FROM contact_points WHERE value = $1
      ORDER BY lead_id IS NOT NULL DESC LIMIT 1`,
    [input.fromValue],
  );
  if (!contact?.lead_id) {
    logger.warn({ from: input.fromValue }, "inbound from unknown contact");
    return { handled: false };
  }
  const leadId = contact.lead_id;

  // --- Conversation + message persistence --------------------------------
  const convoChannel = input.channel === "mms" ? "sms" : input.channel;
  const convo = await queryOne<{ id: string; status: string }>(
    `INSERT INTO conversations (lead_id, channel, contact_point_id, last_inbound_at)
     VALUES ($1, $2::channel, $3, now())
     ON CONFLICT (lead_id, channel, contact_point_id)
     DO UPDATE SET last_inbound_at = now()
     RETURNING id, status`,
    [leadId, convoChannel, contact.id],
  );
  const conversationId = convo!.id;

  // --- 1. Opt-out first ---------------------------------------------------
  const optedOut = await processInboundForOptOut({
    contactValue: input.fromValue,
    contactPointId: contact.id,
    leadId,
    channel: input.channel,
    body: input.body,
  });

  await query(
    `INSERT INTO messages (conversation_id, direction, channel, body, provider_message_id, intent)
     VALUES ($1, 'inbound', $2::channel, $3, $4, $5)`,
    [conversationId, input.channel, input.body, input.providerMessageId ?? null,
     optedOut ? "opt_out" : null],
  );

  if (optedOut) {
    // Twilio Messaging Service auto-replies to STOP; do not double-send.
    return { handled: true, leadId, action: "opt_out" };
  }

  // --- Human takeover: store only, notify, no AI reply --------------------
  const lead = await queryOne<{
    human_takeover: boolean;
    status: string;
    owner_first: string | null;
    address_line1: string;
    city: string;
    state: string;
    property_type: string;
  }>(
    `SELECT l.human_takeover, l.status, o.first_name AS owner_first,
            p.address_line1, p.city, p.state, p.property_type::text
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!lead) return { handled: false };

  if (lead.human_takeover || convo!.status === "human_takeover") {
    await notifyOwnerOfLead(leadId, "reply_during_takeover", {
      title: "Seller replied (takeover active)",
      body: input.body.slice(0, 300),
    });
    return { handled: true, leadId, action: "stored_for_human" };
  }

  // --- 2. Build history + Claude turn ------------------------------------
  const historyRes = await query<{ direction: "inbound" | "outbound"; body: string }>(
    `SELECT direction, body FROM messages
      WHERE conversation_id = $1 ORDER BY sent_at ASC LIMIT 60`,
    [conversationId],
  );
  const history: HistoryMessage[] = historyRes.rows;

  const flagsRes = await query<{ flag: string }>(
    `SELECT flag FROM lead_distress_flags WHERE lead_id = $1`,
    [leadId],
  );
  const qual = await queryOne<Record<string, unknown>>(
    `SELECT motivation_level, reason_for_selling, timeline_weeks,
            asking_price_cents, occupancy, mortgage_status, conversation_summary
       FROM qualifications WHERE lead_id = $1`,
    [leadId],
  );

  const cfg = getConfig();
  let turn: ConversationTurnOutput & { modelMeta: Record<string, unknown> };
  try {
    turn = await generateConversationTurn({
      leadContext: {
        ownerFirstName: lead.owner_first,
        address: lead.address_line1,
        city: lead.city,
        state: lead.state,
        propertyType: lead.property_type,
        operatorName: cfg.OWNER_NAME,
        companyName: `${cfg.OWNER_NAME} Home Buyers`,
        flags: flagsRes.rows.map((r) => r.flag),
        knownQualification: qual,
      },
      history,
    });
  } catch (err) {
    logger.error({ err, leadId }, "conversation model failed — notifying owner as fallback");
    await notifyOwnerOfLead(leadId, "ai_error", {
      title: "AI reply failed — manual response needed",
      body: `Seller said: "${input.body.slice(0, 200)}"`,
    });
    return { handled: true, leadId, action: "ai_error_escalated" };
  }

  // Tag the inbound message with the classified intent.
  await query(
    `UPDATE messages SET intent = $2 WHERE conversation_id = $1 AND direction = 'inbound'
       AND id = (SELECT id FROM messages WHERE conversation_id = $1 AND direction='inbound'
                 ORDER BY sent_at DESC LIMIT 1)`,
    [conversationId, turn.intent],
  );

  // --- 3. Persist qualification updates -----------------------------------
  const q = turn.qualification;
  await query(
    `INSERT INTO qualifications AS t (lead_id, motivation_level, motivation_notes,
        reason_for_selling, timeline_weeks, timeline_notes, asking_price_cents, price_flexible,
        condition_notes, repairs_needed, repair_level_guess, occupancy, mortgage_status,
        mortgage_balance_cents, best_contact_method, best_contact_time, callback_at,
        objections, conversation_summary, updated_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10::repair_level,COALESCE($11::occupancy_status,'unknown'),$12,$13,
             $14::channel,$15,$16,$17,$18, now())
     ON CONFLICT (lead_id) DO UPDATE SET
        motivation_level    = COALESCE(EXCLUDED.motivation_level, t.motivation_level),
        motivation_notes    = COALESCE(EXCLUDED.motivation_notes, t.motivation_notes),
        reason_for_selling  = COALESCE(EXCLUDED.reason_for_selling, t.reason_for_selling),
        timeline_weeks      = COALESCE(EXCLUDED.timeline_weeks, t.timeline_weeks),
        asking_price_cents  = COALESCE(EXCLUDED.asking_price_cents, t.asking_price_cents),
        price_flexible      = COALESCE(EXCLUDED.price_flexible, t.price_flexible),
        condition_notes     = COALESCE(EXCLUDED.condition_notes, t.condition_notes),
        repairs_needed      = COALESCE(EXCLUDED.repairs_needed, t.repairs_needed),
        repair_level_guess  = COALESCE(EXCLUDED.repair_level_guess, t.repair_level_guess),
        occupancy           = CASE WHEN EXCLUDED.occupancy <> 'unknown' THEN EXCLUDED.occupancy ELSE t.occupancy END,
        mortgage_status     = COALESCE(EXCLUDED.mortgage_status, t.mortgage_status),
        mortgage_balance_cents = COALESCE(EXCLUDED.mortgage_balance_cents, t.mortgage_balance_cents),
        best_contact_method = COALESCE(EXCLUDED.best_contact_method, t.best_contact_method),
        best_contact_time   = COALESCE(EXCLUDED.best_contact_time, t.best_contact_time),
        callback_at         = COALESCE(EXCLUDED.callback_at, t.callback_at),
        objections          = (SELECT to_jsonb(ARRAY(SELECT DISTINCT jsonb_array_elements_text(t.objections || EXCLUDED.objections)))),
        conversation_summary = EXCLUDED.conversation_summary,
        updated_at          = now()`,
    [
      leadId,
      q.motivation_level,
      q.motivation_notes,
      q.reason_for_selling,
      q.timeline_weeks,
      q.asking_price_dollars != null ? q.asking_price_dollars * 100 : null,
      q.price_flexible,
      q.condition_notes,
      q.repairs_needed,
      q.repair_level_guess,
      q.occupancy,
      q.mortgage_status,
      q.mortgage_balance_dollars != null ? q.mortgage_balance_dollars * 100 : null,
      q.best_contact_method,
      q.best_contact_time,
      q.callback_at_iso,
      JSON.stringify(q.new_objections ?? []),
      turn.conversation_summary,
    ],
  );

  // --- 4. Temperature + status --------------------------------------------
  const temperature = deriveTemperature({
    intent: turn.intent,
    motivationLevel: q.motivation_level,
    timelineWeeks: q.timeline_weeks,
    askingPriceGiven: q.asking_price_dollars != null,
    qualified: turn.escalate,
  });
  const newStatus =
    turn.intent === "not_interested" || turn.intent === "wrong_number"
      ? turn.intent === "wrong_number" ? "dead" : "nurture"
      : temperature === "hot" ? "hot"
      : temperature === "warm" ? "warm"
      : "conversing";
  await query(
    `UPDATE leads SET temperature = $2::lead_temperature, status = $3::lead_status
      WHERE id = $1 AND status NOT IN ('suppressed','closed_won','closed_lost','under_contract')`,
    [leadId, temperature, newStatus],
  );
  if (turn.end_conversation) {
    await query(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [conversationId]);
  }

  // --- 5. Send the AI reply ----------------------------------------------
  if (turn.reply.trim().length > 0) {
    await sendTouch({
      leadId,
      channel: convoChannel as Channel,
      body: turn.reply,
      actor: "system:conversation",
    });
  }

  // --- 6. Escalation ------------------------------------------------------
  if (turn.escalate) {
    await query(`UPDATE qualifications SET qualified = true WHERE lead_id = $1`, [leadId]);
    // Fire-and-forget: underwrite fresh, then notify with full deal summary.
    try {
      await underwriteLead(leadId);
    } catch (err) {
      logger.warn({ err, leadId }, "underwriting during escalation failed (continuing)");
    }
    await notifyOwnerOfLead(leadId, "warm_lead", {
      title: `${temperature === "hot" ? "HOT" : "Warm"} lead: ${lead.address_line1}`,
      body: turn.conversation_summary,
    });
  }

  await audit("system:conversation", "inbound_processed", "lead", leadId, null, {
    intent: turn.intent,
    escalate: turn.escalate,
    temperature,
  });
  return { handled: true, leadId, action: turn.escalate ? "escalated" : "replied" };
}
