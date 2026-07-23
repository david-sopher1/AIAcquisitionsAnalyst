// ============================================================================
// Lead Scoring Agent — deterministic, explainable 0–100 composite score.
//
// Design goals:
//   * Explainable: score_breakdown stores every component so the dashboard
//     (and you) can see WHY a lead ranks where it does.
//   * Stable: same inputs → same score. AI adjustments happen separately
//     (conversation-based temperature), never silently inside this number.
//   * Tunable: all weights in one table below. When you have outcome data
//     (contracts closed), re-fit these weights; the shape won't change.
// ============================================================================

import type { DistressFlag, LeadTemperature } from "@dealengine/shared";

export interface ScoringInput {
  flags: DistressFlag[];
  /** Distinct lead sources this property appeared on (list stacking). */
  stackCount: number;
  /** 0..1 — estimated equity as a fraction of value. */
  equityPct: number | null;
  /** Years the current owner has held the property. */
  ownershipYears: number | null;
  /** Owner age if known. */
  ownerAge: number | null;
  ownerIsEntity: boolean;
  ownerOutOfState: boolean;
  /** Assessed or AVM value in cents — used for market-fit banding. */
  valueCents: number | null;
  /** Units (1–20). */
  units: number;
  yearBuilt: number | null;
}

/** Points per distress flag. Multiple flags compound (capped). */
const FLAG_WEIGHTS: Record<DistressFlag, number> = {
  pre_foreclosure: 14,
  tax_delinquent: 12,
  probate: 13,
  inherited: 11,
  estate_sale: 11,
  vacant: 12,
  vacant_rental: 10,
  usps_vacancy: 9,
  code_violation: 10,
  water_shutoff: 11,
  utility_disconnect: 10,
  fire_damage: 12,
  eviction_filing: 9,
  divorce: 8,
  bankruptcy: 8,
  lien: 7,
  tired_landlord: 9,
  expired_listing: 7,
  high_equity: 6,
  free_and_clear: 7,
  absentee_owner: 5,
  out_of_state_owner: 6,
  driving_for_dollars: 8,
  senior_owner: 4,
  long_ownership: 4,
};

const MAX_FLAG_POINTS = 45;
const MAX_STACK_POINTS = 15;
const MAX_EQUITY_POINTS = 15;
const MAX_PROFILE_POINTS = 15;
const MAX_FIT_POINTS = 10;

export interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
}

export function scoreLead(input: ScoringInput): ScoreResult {
  const breakdown: Record<string, number> = {};

  // --- Distress flags (0–45) ---------------------------------------------
  let flagPoints = 0;
  for (const flag of input.flags) flagPoints += FLAG_WEIGHTS[flag] ?? 0;
  flagPoints = Math.min(flagPoints, MAX_FLAG_POINTS);
  breakdown.distress_flags = round1(flagPoints);

  // --- List stacking (0–15): appearing on N lists is the single best
  //     predictor of motivation in most wholesaling datasets. -------------
  const stackPoints = Math.min((input.stackCount - 1) * 5, MAX_STACK_POINTS);
  breakdown.list_stacking = round1(Math.max(0, stackPoints));

  // --- Equity (0–15): sellers need equity to accept a discounted cash
  //     offer. <20% equity usually can't transact below retail. -----------
  let equityPoints = 0;
  if (input.equityPct != null) {
    if (input.equityPct >= 0.7) equityPoints = 15;
    else if (input.equityPct >= 0.5) equityPoints = 12;
    else if (input.equityPct >= 0.35) equityPoints = 8;
    else if (input.equityPct >= 0.2) equityPoints = 4;
    else equityPoints = 0;
  } else {
    equityPoints = 6; // unknown — neutral prior
  }
  breakdown.equity = round1(equityPoints);

  // --- Owner profile (0–15) ----------------------------------------------
  let profilePoints = 0;
  if (input.ownerOutOfState) profilePoints += 5;
  if (!input.ownerIsEntity) profilePoints += 3; // individuals convert better than LLCs
  if (input.ownershipYears != null && input.ownershipYears >= 15) profilePoints += 4;
  else if (input.ownershipYears != null && input.ownershipYears >= 8) profilePoints += 2;
  if (input.ownerAge != null && input.ownerAge >= 65) profilePoints += 3;
  profilePoints = Math.min(profilePoints, MAX_PROFILE_POINTS);
  breakdown.owner_profile = round1(profilePoints);

  // --- Deal fit (0–10): value band + age + units -------------------------
  let fitPoints = 0;
  if (input.valueCents != null) {
    const v = input.valueCents / 100;
    // Sweet spot for wholesale/flip in these markets: $60k–$400k
    if (v >= 60_000 && v <= 400_000) fitPoints += 5;
    else if (v > 400_000 && v <= 650_000) fitPoints += 2;
  } else {
    fitPoints += 2;
  }
  if (input.yearBuilt != null && input.yearBuilt < 1990) fitPoints += 3;
  if (input.units >= 2 && input.units <= 20) fitPoints += 2;
  else if (input.units === 1) fitPoints += 2;
  fitPoints = Math.min(fitPoints, MAX_FIT_POINTS);
  breakdown.deal_fit = round1(fitPoints);

  const score = Math.min(
    100,
    round1(flagPoints + Math.max(0, stackPoints) + equityPoints + profilePoints + fitPoints),
  );
  return { score, breakdown };
}

/**
 * Temperature from conversation behavior — separate from the static score.
 * Called by the Conversation Agent after each inbound message.
 */
export function deriveTemperature(params: {
  intent: string;
  motivationLevel: string | null;
  timelineWeeks: number | null;
  askingPriceGiven: boolean;
  qualified: boolean;
}): LeadTemperature {
  if (params.qualified) return "hot";
  if (params.intent === "interested" || params.intent === "price_given") {
    if (
      params.askingPriceGiven &&
      params.timelineWeeks != null &&
      params.timelineWeeks <= 13
    ) {
      return "hot";
    }
    return "warm";
  }
  if (params.intent === "callback_request" || params.intent === "question") return "warming";
  if (params.motivationLevel === "high" || params.motivationLevel === "urgent") return "warm";
  if (params.intent === "maybe_later") return "warming";
  return "cold";
}

/** Priority tiers used by the outreach scheduler. */
export function scoreTier(score: number): "A" | "B" | "C" | "D" {
  if (score >= 70) return "A";
  if (score >= 50) return "B";
  if (score >= 30) return "C";
  return "D";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
