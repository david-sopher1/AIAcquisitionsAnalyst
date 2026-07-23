// ============================================================================
// Disposition Prep Agent — builds the human-facing deal summary when a lead
// goes warm/hot, combining qualification, underwriting, and the conversation.
// ============================================================================

import { centsToUsd, logger, modelFor } from "@dealengine/shared";
import { getAnthropic } from "./client.js";
import { DEAL_SUMMARY_SCHEMA, type DealSummaryOutput } from "./schemas.js";

export async function generateDealSummary(params: {
  address: string;
  ownerName: string;
  flags: string[];
  qualification: Record<string, unknown>;
  arvCents: number | null;
  repairsCents: number | null;
  maoCents: number | null;
  strategy: string | null;
  conversationTranscript: string; // formatted "Seller: ... / Us: ..." lines
}): Promise<DealSummaryOutput> {
  const client = getAnthropic();
  const model = modelFor("extraction");

  const prompt = `You are the acquisitions analyst preparing a handoff brief for the company owner, who is about to personally call this seller and negotiate. Be concrete, skeptical, and useful — this brief decides how he opens the call.

# Property & numbers
- Address: ${params.address}
- Owner: ${params.ownerName}
- Distress signals (public records): ${params.flags.join(", ") || "none"}
- Estimated ARV: ${params.arvCents != null ? centsToUsd(params.arvCents) : "unknown"}
- Estimated repairs: ${params.repairsCents != null ? centsToUsd(params.repairsCents) : "unknown"}
- Suggested MAO (max offer): ${params.maoCents != null ? centsToUsd(params.maoCents) : "unknown"}
- Recommended strategy: ${params.strategy ?? "unknown"}

# Qualification (extracted from conversation)
${JSON.stringify(params.qualification, null, 2)}

# Full conversation transcript
${params.conversationTranscript}

Produce the handoff brief as JSON per the schema.`;

  const response = await client.messages.create({
    model,
    max_tokens: 1_500,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt }],
    output_config: {
      format: { type: "json_schema", schema: DEAL_SUMMARY_SCHEMA },
    },
  } as never);

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find(
    (b) => b.type === "text",
  );
  if (!textBlock?.text) {
    throw new Error(`Summary model returned no text (stop_reason=${response.stop_reason})`);
  }
  const parsed = JSON.parse(textBlock.text) as DealSummaryOutput;
  logger.debug({ address: params.address }, "deal summary generated");
  return parsed;
}
