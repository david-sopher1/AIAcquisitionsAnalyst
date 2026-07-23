// ============================================================================
// Conversation Agent — one Claude call per inbound message that produces:
// reply + intent + qualification extraction + escalation decision + summary.
//
// The system prompt is byte-stable and cached (cache_control); the lead
// context rides in the first user turn so caching still applies across turns
// of the SAME conversation.
// ============================================================================

import { logger, modelFor } from "@dealengine/shared";
import { getAnthropic } from "./client.js";
import {
  buildLeadContextBlock,
  CONVERSATION_SYSTEM_PROMPT,
  type LeadContext,
} from "./prompts.js";
import {
  CONVERSATION_TURN_SCHEMA,
  type ConversationTurnOutput,
} from "./schemas.js";

export interface HistoryMessage {
  direction: "inbound" | "outbound";
  body: string;
}

export async function generateConversationTurn(params: {
  leadContext: LeadContext;
  history: HistoryMessage[]; // oldest first, INCLUDING the latest inbound
}): Promise<ConversationTurnOutput & { modelMeta: Record<string, unknown> }> {
  const client = getAnthropic();
  const model = modelFor("conversation");
  const started = Date.now();

  // Map SMS thread onto API roles: seller (inbound) = user, us (outbound) = assistant.
  // The first user turn carries the lead context + the earliest seller message
  // (or a synthetic "[conversation start]" marker when we texted first).
  const contextBlock = buildLeadContextBlock(params.leadContext);

  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of params.history) {
    turns.push({
      role: msg.direction === "inbound" ? "user" : "assistant",
      content: msg.body,
    });
  }
  // API requires the first message to be user role.
  if (turns.length === 0 || turns[0]!.role !== "user") {
    turns.unshift({ role: "user", content: "[conversation start]" });
  }
  // Merge context into the first user turn.
  turns[0] = {
    role: "user",
    content: `${contextBlock}\n\n---\nSeller: ${turns[0]!.content}`,
  };
  // Structured outputs require the last turn to be user; if our own outbound
  // was last (shouldn't happen on inbound processing), append a nudge.
  if (turns[turns.length - 1]!.role !== "user") {
    turns.push({
      role: "user",
      content: "[no new seller message — produce qualification update only, reply must be empty string]",
    });
  }

  // Two attempts. A malformed/degenerate generation must never crash the
  // handler or send garbage — on repeated failure we return a safe result
  // that sends NOTHING and escalates to the human owner.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4_000, // headroom so JSON can't truncate mid-object
        // Thinking OFF for this call: short SMS + extraction doesn't need deep
        // reasoning, and adaptive thinking + JSON structured output was
        // producing degraded/doubled text. The system prompt instructs
        // final-answer-only, per Anthropic's Opus 4.8 guidance.
        thinking: { type: "disabled" },
        system: [
          {
            type: "text",
            text: CONVERSATION_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: turns,
        output_config: {
          format: { type: "json_schema", schema: CONVERSATION_TURN_SCHEMA },
        },
      } as never);

      if (response.stop_reason === "max_tokens") {
        throw new Error("generation hit max_tokens (likely degenerate) — retrying");
      }

      const textBlock = (response.content as Array<{ type: string; text?: string }>).find(
        (b) => b.type === "text",
      );
      if (!textBlock?.text) {
        throw new Error(`no text block (stop_reason=${response.stop_reason})`);
      }

      const parsed = JSON.parse(textBlock.text) as ConversationTurnOutput;

      // Sanity guard: a legit SMS is short. Anything huge or containing our
      // own field labels is a leaked-scratchpad generation — reject and retry.
      const reply = (parsed.reply ?? "").trim();
      if (reply.length > 480 || /\b(reply:|seller:|plan:|redirect to)\b/i.test(reply)) {
        throw new Error("reply failed sanity check (too long or leaked reasoning)");
      }
      parsed.reply = reply;

      const modelMeta = {
        model,
        attempt,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: (response.usage as { cache_read_input_tokens?: number })
          .cache_read_input_tokens,
        latency_ms: Date.now() - started,
        stop_reason: response.stop_reason,
      };
      logger.debug({ modelMeta, intent: parsed.intent }, "conversation turn generated");
      return { ...parsed, modelMeta };
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt }, "conversation turn attempt failed");
    }
  }

  // Both attempts failed. Fail safe: send nothing, escalate to the human.
  logger.error({ err: lastErr }, "conversation generation failed twice — escalating to human");
  return {
    reply: "",
    intent: "other",
    escalate: true,
    end_conversation: false,
    qualification: {
      motivation_level: null, motivation_notes: null, reason_for_selling: null,
      timeline_weeks: null, asking_price_dollars: null, price_flexible: null,
      condition_notes: null, repairs_needed: null, repair_level_guess: null,
      occupancy: null, mortgage_status: null, mortgage_balance_dollars: null,
      best_contact_method: null, best_contact_time: null, callback_at_iso: null,
      new_objections: [],
    },
    conversation_summary: "AI could not generate a reliable reply — handed to human.",
    modelMeta: { model, failed: true, latency_ms: Date.now() - started },
  };
}
