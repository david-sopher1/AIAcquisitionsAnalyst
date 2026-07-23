// ============================================================================
// Per-state outreach rules for the active markets.
//
// These encode the STRICTER of federal (TCPA/TSR) and state requirements as
// configurable defaults. They are a floor, not legal advice — review with a
// TCPA attorney before launch and keep this file updated as laws change.
// ============================================================================

import type { Channel } from "@dealengine/shared";

export interface StateRules {
  state: string;
  /** Local-time hour outbound may start (inclusive), 24h clock. */
  quietStartHour: number;
  /** Local-time hour outbound must stop (exclusive). */
  quietEndHour: number;
  /** Max call/SMS attempts to the same person per rolling 24h. null = federal default. */
  maxContactsPer24h: number | null;
  /** Max attempts per rolling 30 days about the same subject. */
  maxContactsPer30d: number | null;
  /** Channels requiring prior express written consent in this state beyond federal rules. */
  consentRequiredChannels: Channel[];
  /** Sunday restrictions (some mini-TCPAs prohibit Sunday solicitation). */
  noSunday: boolean;
  notes: string;
}

const FEDERAL_DEFAULT: Omit<StateRules, "state"> = {
  quietStartHour: 8,
  quietEndHour: 21, // TCPA: 8am–9pm local time of the recipient
  maxContactsPer24h: null,
  maxContactsPer30d: null,
  // Federal floor: prerecorded/artificial voice (RVM, AI voice) to cell phones
  // requires prior express written consent. Treat AI voice + RVM as consent-gated.
  consentRequiredChannels: ["rvm", "ai_voice"],
  noSunday: false,
  notes: "Federal TCPA/TSR defaults.",
};

const RULES: Record<string, Partial<Omit<StateRules, "state">>> = {
  // Florida FTSA (Mini-TCPA): 8am–8pm local, max 3 sales calls per 24h on the
  // same subject, applies to text messages as well.
  FL: {
    quietEndHour: 20,
    maxContactsPer24h: 3,
    notes: "FL FTSA: 8am–8pm; max 3 attempts/24h; texts covered; private right of action.",
  },
  // Oklahoma-style rules don't apply to our markets, but Maryland has specific
  // foreclosure-solicitation restrictions (Protection of Homeowners in
  // Foreclosure Act) — treat pre-foreclosure leads in MD conservatively.
  MD: {
    notes:
      "MD PHIFA regulates contact with owners in foreclosure. Pre-foreclosure leads in MD " +
      "should use mail-first outreach; no purchase agreements without PHIFA-compliant disclosures.",
  },
  // Texas: telephone solicitation registration (Ch. 302) may apply; quiet hours
  // 9pm; Sunday calling restricted to noon–9pm under Texas Bus. & Com. Code 305.
  TX: {
    notes: "TX: verify solicitation-registration applicability; Sunday calls only 12pm–9pm.",
  },
  OH: { notes: "OH: follows federal defaults; honor state DNC via national scrub." },
  GA: { notes: "GA: follows federal defaults; GA has its own DNC provisions for residential lines." },
  TN: { notes: "TN: state DNC list; solicitors may need registration with TRA." },
  IN: { notes: "IN: strict state DNC list (quarterly updated); scrub against Indiana DNC." },
};

export function rulesForState(state: string): StateRules {
  const overrides = RULES[state.toUpperCase()] ?? {};
  return { state: state.toUpperCase(), ...FEDERAL_DEFAULT, ...overrides };
}

/** Opt-out keywords honored across all channels (case-insensitive, standalone). */
export const OPT_OUT_KEYWORDS = [
  "stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit",
  "remove me", "take me off", "do not contact", "don't contact", "dont contact",
  "do not text", "do not call", "wrong number, stop", "leave me alone",
];

/** Returns true when an inbound message is an opt-out request. */
export function isOptOutMessage(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[!.]+$/, "");
  if (OPT_OUT_KEYWORDS.includes(t)) return true;
  // Short messages containing an unambiguous opt-out phrase
  if (t.length <= 80) {
    return OPT_OUT_KEYWORDS.some(
      (k) => k.length > 4 && t.includes(k),
    );
  }
  return false;
}

/** Compute the current hour-of-day and weekday in an IANA timezone. */
export function localTimeParts(tz: string, at: Date = new Date()): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(at);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "12";
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hour: parseInt(hourStr, 10) % 24, weekday: weekdays.indexOf(weekdayStr) };
}
