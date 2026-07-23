// JSON Schemas for Claude structured outputs (output_config.format).
// additionalProperties:false + required on every object per API requirements.

export const CONVERSATION_TURN_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "The SMS reply to send to the seller. Short, human, per the style rules. Empty string ONLY when no reply should be sent at all.",
    },
    intent: {
      type: "string",
      enum: [
        "interested",
        "maybe_later",
        "question",
        "callback_request",
        "price_given",
        "not_interested",
        "wrong_number",
        "opt_out",
        "hostile",
        "other",
      ],
      description: "Classification of the seller's LAST inbound message.",
    },
    escalate: {
      type: "boolean",
      description: "True when the human owner should be notified now per escalation rules.",
    },
    end_conversation: {
      type: "boolean",
      description: "True when the conversation should be closed after this reply.",
    },
    qualification: {
      type: "object",
      description:
        "Fields learned or updated THIS turn. Null for anything not learned.",
      properties: {
        motivation_level: {
          anyOf: [
            { type: "string", enum: ["none", "low", "medium", "high", "urgent"] },
            { type: "null" },
          ],
        },
        motivation_notes: { type: ["string", "null"] },
        reason_for_selling: { type: ["string", "null"] },
        timeline_weeks: { type: ["integer", "null"] },
        asking_price_dollars: { type: ["integer", "null"] },
        price_flexible: { type: ["boolean", "null"] },
        condition_notes: { type: ["string", "null"] },
        repairs_needed: { type: ["string", "null"] },
        repair_level_guess: {
          anyOf: [
            { type: "string", enum: ["cosmetic", "light", "medium", "heavy", "gut"] },
            { type: "null" },
          ],
        },
        occupancy: {
          anyOf: [
            { type: "string", enum: ["owner_occupied", "tenant_occupied", "vacant", "unknown"] },
            { type: "null" },
          ],
        },
        mortgage_status: {
          anyOf: [
            { type: "string", enum: ["free_and_clear", "current", "behind", "in_foreclosure", "unknown"] },
            { type: "null" },
          ],
        },
        mortgage_balance_dollars: { type: ["integer", "null"] },
        best_contact_method: {
          anyOf: [
            { type: "string", enum: ["sms", "email", "cold_call"] },
            { type: "null" },
          ],
        },
        best_contact_time: { type: ["string", "null"] },
        callback_at_iso: {
          type: ["string", "null"],
          description: "ISO 8601 datetime if the seller named a callback time.",
        },
        new_objections: {
          type: "array",
          items: { type: "string" },
          description: "New objections raised this turn, short phrases.",
        },
      },
      required: [
        "motivation_level",
        "motivation_notes",
        "reason_for_selling",
        "timeline_weeks",
        "asking_price_dollars",
        "price_flexible",
        "condition_notes",
        "repairs_needed",
        "repair_level_guess",
        "occupancy",
        "mortgage_status",
        "mortgage_balance_dollars",
        "best_contact_method",
        "best_contact_time",
        "callback_at_iso",
        "new_objections",
      ],
      additionalProperties: false,
    },
    conversation_summary: {
      type: "string",
      description: "1–3 sentence running summary of the whole conversation so far.",
    },
  },
  required: [
    "reply",
    "intent",
    "escalate",
    "end_conversation",
    "qualification",
    "conversation_summary",
  ],
  additionalProperties: false,
} as const;

export interface ConversationTurnOutput {
  reply: string;
  intent:
    | "interested"
    | "maybe_later"
    | "question"
    | "callback_request"
    | "price_given"
    | "not_interested"
    | "wrong_number"
    | "opt_out"
    | "hostile"
    | "other";
  escalate: boolean;
  end_conversation: boolean;
  qualification: {
    motivation_level: "none" | "low" | "medium" | "high" | "urgent" | null;
    motivation_notes: string | null;
    reason_for_selling: string | null;
    timeline_weeks: number | null;
    asking_price_dollars: number | null;
    price_flexible: boolean | null;
    condition_notes: string | null;
    repairs_needed: string | null;
    repair_level_guess: "cosmetic" | "light" | "medium" | "heavy" | "gut" | null;
    occupancy: "owner_occupied" | "tenant_occupied" | "vacant" | "unknown" | null;
    mortgage_status: "free_and_clear" | "current" | "behind" | "in_foreclosure" | "unknown" | null;
    mortgage_balance_dollars: number | null;
    best_contact_method: "sms" | "email" | "cold_call" | null;
    best_contact_time: string | null;
    callback_at_iso: string | null;
    new_objections: string[];
  };
  conversation_summary: string;
}

export const DEAL_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One-line hook, e.g. 'Motivated probate seller, vacant 3/1, wants out in 30 days'." },
    motivation: { type: "string" },
    timeline: { type: "string" },
    price_expectation: { type: "string" },
    condition: { type: "string" },
    negotiation_angle: {
      type: "string",
      description: "Concrete advice for the human closer: leverage points, tone, what to anchor on.",
    },
    risk_factors: { type: "array", items: { type: "string" } },
    recommended_next_action: { type: "string" },
  },
  required: [
    "headline",
    "motivation",
    "timeline",
    "price_expectation",
    "condition",
    "negotiation_angle",
    "risk_factors",
    "recommended_next_action",
  ],
  additionalProperties: false,
} as const;

export interface DealSummaryOutput {
  headline: string;
  motivation: string;
  timeline: string;
  price_expectation: string;
  condition: string;
  negotiation_angle: string;
  risk_factors: string[];
  recommended_next_action: string;
}
