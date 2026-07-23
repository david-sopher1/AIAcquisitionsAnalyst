// ============================================================================
// Lead Outreach workflow — Follow-Up Manager. One durable workflow per lead,
// running the multi-touch cadence over days/weeks, then long-term nurture.
//
//   * Survives restarts/deploys (Temporal timers, not cron rows).
//   * `sellerReplied` signal pauses the cadence — the Conversation Agent owns
//     the thread from the API side; cadence resumes only if the conversation
//     goes quiet again.
//   * `stopOutreach` signal (opt-out, human takeover, deal closed) ends it.
//   * Compliance blocks with retryAfter reschedule instead of failing.
// ============================================================================

import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type { Activities } from "../activities.js";

const acts = proxyActivities<Activities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 4, backoffCoefficient: 2 },
});

export const sellerRepliedSignal = defineSignal("sellerReplied");
export const stopOutreachSignal = defineSignal<[string]>("stopOutreach");

export interface LeadOutreachInput {
  leadId: string;
  /** Cadence override; default below. */
  steps?: CadenceStep[];
}

export interface CadenceStep {
  dayOffset: number;
  channel: "sms" | "email" | "rvm" | "ai_voice" | "direct_mail" | "handwritten_mail";
  templateKey: string;
}

/** Default 6-week multi-channel cadence, then quarterly nurture. */
const DEFAULT_CADENCE: CadenceStep[] = [
  { dayOffset: 0, channel: "sms", templateKey: "opener_v1" },
  { dayOffset: 2, channel: "sms", templateKey: "followup_no_reply_1" },
  { dayOffset: 4, channel: "email", templateKey: "opener_v1" },
  { dayOffset: 7, channel: "rvm", templateKey: "rvm_default" },       // consent-gated
  { dayOffset: 10, channel: "sms", templateKey: "opener_v2" },
  { dayOffset: 14, channel: "direct_mail", templateKey: "postcard_v1" },
  { dayOffset: 21, channel: "ai_voice", templateKey: "voice_default" }, // consent-gated
  { dayOffset: 28, channel: "sms", templateKey: "followup_no_reply_2" },
  { dayOffset: 42, channel: "handwritten_mail", templateKey: "handwritten_v1" },
];

const TERMINAL_STATUSES = new Set([
  "suppressed", "dead", "closed_won", "closed_lost", "under_contract",
]);
const CONVERSING_STATUSES = new Set(["conversing", "warm", "hot", "appointment", "offer_made"]);

export async function leadOutreach(input: LeadOutreachInput): Promise<string> {
  const steps = input.steps ?? DEFAULT_CADENCE;
  let replied = false;
  let stopped: string | null = null;

  setHandler(sellerRepliedSignal, () => {
    replied = true;
  });
  setHandler(stopOutreachSignal, (reason: string) => {
    stopped = reason;
  });

  const startMs = Date.now(); // deterministic in workflow sandbox

  for (const step of steps) {
    // Wait until the step's day, waking early on reply/stop signals.
    const targetMs = startMs + step.dayOffset * 24 * 3600 * 1000;
    const waitMs = targetMs - Date.now();
    if (waitMs > 0) {
      await condition(() => replied || stopped !== null, waitMs);
    }
    if (stopped) return `stopped:${stopped}`;

    // If the seller is talking to us, the cadence yields to the conversation.
    if (replied) {
      const done = await waitOutConversation();
      if (done) return done;
      replied = false; // conversation went quiet — resume cadence
    }

    // Status re-check before every touch.
    const status = await acts.getLeadStatus(input.leadId);
    if (!status || TERMINAL_STATUSES.has(status)) return `ended:status_${status}`;
    if (CONVERSING_STATUSES.has(status)) {
      const done = await waitOutConversation();
      if (done) return done;
    }

    // Send (compliance-gated). ai_voice is initiated via Retell.
    if (step.channel === "ai_voice") {
      await acts.startAiVoiceCall(input.leadId).catch(() => null);
      continue;
    }
    let result = await acts.sendTouchActivity({
      leadId: input.leadId,
      channel: step.channel,
      templateKey: step.templateKey,
      actor: "system:outreach",
      stepNo: step.dayOffset,
    });
    // Quiet-hours block → wait and retry once at the allowed time.
    if (result.status === "blocked_compliance" && result.retryAfter) {
      const delay = new Date(result.retryAfter).getTime() - Date.now();
      if (delay > 0 && delay < 24 * 3600 * 1000) {
        await condition(() => replied || stopped !== null, delay);
        if (stopped) return `stopped:${stopped}`;
        if (!replied) {
          result = await acts.sendTouchActivity({
            leadId: input.leadId,
            channel: step.channel,
            templateKey: step.templateKey,
            actor: "system:outreach",
            stepNo: step.dayOffset,
          });
        }
      }
    }
  }

  // ---- Long-term nurture: quarterly check-in for a year ------------------
  for (let quarter = 1; quarter <= 4; quarter++) {
    await condition(() => replied || stopped !== null, 91 * 24 * 3600 * 1000);
    if (stopped) return `stopped:${stopped}`;
    if (replied) {
      const done = await waitOutConversation();
      if (done) return done;
      replied = false;
    }
    const status = await acts.getLeadStatus(input.leadId);
    if (!status || TERMINAL_STATUSES.has(status)) return `ended:status_${status}`;
    await acts.sendTouchActivity({
      leadId: input.leadId,
      channel: "sms",
      templateKey: "nurture_quarterly",
      actor: "system:outreach",
    });
  }

  return "completed:nurture_exhausted";

  // -------------------------------------------------------------------------
  /** While a conversation is live, check status weekly; return non-null to end. */
  async function waitOutConversation(): Promise<string | null> {
    for (;;) {
      await sleep(7 * 24 * 3600 * 1000);
      if (stopped) return `stopped:${stopped}`;
      const status = await acts.getLeadStatus(input.leadId);
      if (!status || TERMINAL_STATUSES.has(status)) return `ended:status_${status}`;
      if (!CONVERSING_STATUSES.has(status)) return null; // resume cadence
      const active = await acts.hasReplySince(
        input.leadId,
        new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
      );
      if (!active && status !== "hot" && status !== "appointment") return null;
    }
  }
}
