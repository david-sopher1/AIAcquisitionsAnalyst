// ============================================================================
// Temporal activities — thin wrappers over @dealengine/core so workflows get
// automatic retries, timeouts, and heartbeats around every side effect.
// ============================================================================

import {
  getConfig,
  logger,
  query,
  type Channel,
  type RawLeadInput,
} from "@dealengine/shared";
import {
  enrichLead,
  ingestRawLead,
  notifyOwnerOfLead,
  processInboundMessage,
  rollupKpisForDate,
  scoreAndPersist,
  sendTouch,
  skipTraceLead,
  underwriteLead,
  type InboundMessageInput,
  type SendTouchInput,
  type SendTouchResult,
} from "@dealengine/core";
import { batchdata, ghl, retell } from "@dealengine/integrations";

// --- Lead Generation Agent --------------------------------------------------

export async function pullMarketRecords(params: {
  marketKey: string;
  quicklists: string[];
  take: number;
}): Promise<RawLeadInput[]> {
  const market = await query<{ city: string; state: string; zips: string[] }>(
    `SELECT city, state, zips FROM markets WHERE key = $1 AND active`,
    [params.marketKey],
  );
  const m = market.rows[0];
  if (!m) return [];
  return batchdata.searchProperties({
    city: m.city,
    state: m.state,
    zips: m.zips.length ? m.zips : undefined,
    quicklists: params.quicklists,
    take: params.take,
    marketKey: params.marketKey,
  });
}

export async function ingestRecords(records: RawLeadInput[]): Promise<{
  created: string[];
  updated: number;
}> {
  const created: string[] = [];
  let updated = 0;
  for (const record of records) {
    const res = await ingestRawLead(record);
    if (res?.isNew) created.push(res.leadId);
    else if (res) updated++;
  }
  return { created, updated };
}

// --- Enrichment / skip trace / scoring --------------------------------------

export async function enrichLeadActivity(leadId: string): Promise<boolean> {
  return enrichLead(leadId);
}

export async function skipTraceLeadActivity(leadId: string): Promise<{ phones: number; emails: number }> {
  return skipTraceLead(leadId);
}

export async function scoreLeadActivity(leadId: string): Promise<number | null> {
  return scoreAndPersist(leadId);
}

export async function underwriteLeadActivity(leadId: string): Promise<boolean> {
  return underwriteLead(leadId);
}

/** Leads scored today above the outreach threshold, best first. */
export async function selectLeadsForOutreach(params: {
  marketKey: string;
  minScore: number;
  limit: number;
}): Promise<string[]> {
  const res = await query<{ id: string }>(
    `SELECT l.id FROM leads l
      JOIN markets m ON m.id = l.market_id
     WHERE m.key = $1 AND l.status = 'scored' AND l.score >= $2
       AND EXISTS (SELECT 1 FROM contact_points cp
                    WHERE cp.lead_id = l.id AND NOT cp.opted_out)
     ORDER BY l.score DESC
     LIMIT $3`,
    [params.marketKey, params.minScore, params.limit],
  );
  return res.rows.map((r) => r.id);
}

// --- Outreach ---------------------------------------------------------------

export async function sendTouchActivity(input: SendTouchInput): Promise<SendTouchResult> {
  return sendTouch(input);
}

export async function startAiVoiceCall(leadId: string): Promise<string | null> {
  const cfg = getConfig();
  const row = await query<{
    value: string; first_name: string | null; address_line1: string;
  }>(
    `SELECT cp.value, o.first_name, p.address_line1
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
       JOIN contact_points cp ON cp.lead_id = l.id
      WHERE l.id = $1 AND cp.type = 'phone_mobile' AND NOT cp.opted_out
      ORDER BY cp.preferred DESC LIMIT 1`,
    [leadId],
  );
  const r = row.rows[0];
  if (!r || !cfg.RETELL_API_KEY) return null;
  const res = await retell.startOutboundCall({
    to: r.value,
    leadId,
    dynamicVariables: {
      owner_name: r.first_name ?? "there",
      address: r.address_line1,
      operator_name: cfg.OWNER_NAME,
    },
  });
  return res.callId;
}

/** Has the seller replied on any channel since the given ISO timestamp? */
export async function hasReplySince(leadId: string, sinceIso: string): Promise<boolean> {
  const res = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE c.lead_id = $1 AND m.direction = 'inbound' AND m.sent_at > $2`,
    [leadId, sinceIso],
  );
  return parseInt(res.rows[0]?.n ?? "0", 10) > 0;
}

export async function getLeadStatus(leadId: string): Promise<string | null> {
  const res = await query<{ status: string }>(`SELECT status FROM leads WHERE id = $1`, [leadId]);
  return res.rows[0]?.status ?? null;
}

// --- Inbound / notifications / CRM ------------------------------------------

export async function processInboundActivity(input: InboundMessageInput): Promise<void> {
  await processInboundMessage(input);
}

export async function notifyOwnerActivity(params: {
  leadId: string;
  kind: "warm_lead" | "hot_lead" | "callback" | "system";
  title: string;
  body: string;
}): Promise<void> {
  await notifyOwnerOfLead(params.leadId, params.kind, {
    title: params.title,
    body: params.body,
  });
}

export async function syncLeadToCrm(leadId: string): Promise<void> {
  if (!ghl.ghlEnabled()) return;
  const res = await query<{
    first_name: string | null; last_name: string | null;
    phone: string | null; email: string | null;
    address_line1: string; city: string; state: string;
    status: string; temperature: string;
  }>(
    `SELECT o.first_name, o.last_name,
            (SELECT value FROM contact_points WHERE lead_id = l.id AND type LIKE 'phone%' AND NOT opted_out ORDER BY preferred DESC LIMIT 1) AS phone,
            (SELECT value FROM contact_points WHERE lead_id = l.id AND type = 'email' LIMIT 1) AS email,
            p.address_line1, p.city, p.state, l.status::text, l.temperature::text
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [leadId],
  );
  const r = res.rows[0];
  if (!r) return;
  await ghl.upsertContact({
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    address: r.address_line1,
    city: r.city,
    state: r.state,
    tags: ["dealengine", r.status, r.temperature],
  });
}

// --- KPIs --------------------------------------------------------------------

export async function rollupKpisActivity(dateIso: string): Promise<void> {
  await rollupKpisForDate(dateIso);
  logger.info({ date: dateIso }, "kpi rollup complete");
}

export type Activities = {
  pullMarketRecords: typeof pullMarketRecords;
  ingestRecords: typeof ingestRecords;
  enrichLeadActivity: typeof enrichLeadActivity;
  skipTraceLeadActivity: typeof skipTraceLeadActivity;
  scoreLeadActivity: typeof scoreLeadActivity;
  underwriteLeadActivity: typeof underwriteLeadActivity;
  selectLeadsForOutreach: typeof selectLeadsForOutreach;
  sendTouchActivity: typeof sendTouchActivity;
  startAiVoiceCall: typeof startAiVoiceCall;
  hasReplySince: typeof hasReplySince;
  getLeadStatus: typeof getLeadStatus;
  processInboundActivity: typeof processInboundActivity;
  notifyOwnerActivity: typeof notifyOwnerActivity;
  syncLeadToCrm: typeof syncLeadToCrm;
  rollupKpisActivity: typeof rollupKpisActivity;
};
