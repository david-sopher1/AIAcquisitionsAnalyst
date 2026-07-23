// ============================================================================
// Daily Pipeline workflow — one run per market per day (Temporal Schedule).
//
//   pull records → ingest/dedupe → enrich → skip trace → score →
//   launch leadOutreach child workflows for qualifying leads.
//
// Durable: a crash mid-run resumes exactly where it left off.
// ============================================================================

import {
  proxyActivities,
  startChild,
  ParentClosePolicy,
} from "@temporalio/workflow";
import type { Activities } from "../activities.js";
import { leadOutreach } from "./leadOutreach.js";

const acts = proxyActivities<Activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 5, backoffCoefficient: 2 },
});

const heavyActs = proxyActivities<Activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 3 },
});

export interface DailyPipelineInput {
  marketKey: string;
  quicklists?: string[];
  pullSize?: number;
  /** Max new leads to skip trace per run (spend control). */
  skipTraceBudget?: number;
  /** Min score to enter outreach. */
  outreachMinScore?: number;
  /** Max leads to start outreach for per run (throughput control). */
  outreachBudget?: number;
}

const DEFAULT_QUICKLISTS = [
  "preforeclosure",
  "vacant",
  "tax-default",
  "inherited",
  "absentee-owner",
  "tired-landlord",
  "high-equity",
];

export async function dailyPipeline(input: DailyPipelineInput): Promise<{
  pulled: number;
  created: number;
  skipTraced: number;
  outreachStarted: number;
}> {
  const quicklists = input.quicklists ?? DEFAULT_QUICKLISTS;
  const pullSize = input.pullSize ?? 500;
  const skipTraceBudget = input.skipTraceBudget ?? 200;
  const outreachBudget = input.outreachBudget ?? 150;
  const minScore = input.outreachMinScore ?? 45;

  // 1. Pull + ingest -------------------------------------------------------
  const records = await heavyActs.pullMarketRecords({
    marketKey: input.marketKey,
    quicklists,
    take: pullSize,
  });
  const { created } = await heavyActs.ingestRecords(records);

  // 2. Enrich + skip trace + score new leads (bounded) ---------------------
  let skipTraced = 0;
  for (const leadId of created.slice(0, skipTraceBudget)) {
    try {
      await acts.enrichLeadActivity(leadId);
      const st = await acts.skipTraceLeadActivity(leadId);
      if (st.phones + st.emails > 0) skipTraced++;
      await acts.scoreLeadActivity(leadId);
      await acts.syncLeadToCrm(leadId);
    } catch {
      // per-lead failure never kills the run; activity retries already applied
    }
  }
  // Score any created leads beyond the trace budget so they rank tomorrow.
  for (const leadId of created.slice(skipTraceBudget)) {
    try {
      await acts.scoreLeadActivity(leadId);
    } catch {
      /* ignore */
    }
  }

  // 3. Launch outreach for today's best -----------------------------------
  const outreachLeads = await acts.selectLeadsForOutreach({
    marketKey: input.marketKey,
    minScore,
    limit: outreachBudget,
  });
  let outreachStarted = 0;
  for (const leadId of outreachLeads) {
    try {
      await startChild(leadOutreach, {
        args: [{ leadId }],
        workflowId: `outreach-${leadId}`,
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });
      outreachStarted++;
    } catch {
      // workflow already exists (lead re-selected) — fine
    }
  }

  // 4. KPI rollup for today -------------------------------------------------
  // Date.now() is deterministic inside the Temporal workflow sandbox.
  const today = new Date(Date.now()).toISOString().slice(0, 10);
  await acts.rollupKpisActivity(today);

  return { pulled: records.length, created: created.length, skipTraced, outreachStarted };
}
