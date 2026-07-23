// ============================================================================
// Repair Estimator — $/sqft heuristic by rehab level, with market cost index.
//
// Baselines are national midwest/southeast rehab costs (2025-26). They are a
// screening tool for MAO calculation, not a contractor bid — the AI refines
// the level guess from conversation ("roof is 20 years old", "needs everything")
// and you validate on walkthrough.
// ============================================================================

import type { RepairLevel } from "@dealengine/shared";

/** Base $/sqft by rehab level (cents). */
const BASE_PSF_CENTS: Record<RepairLevel, number> = {
  cosmetic: 1_200,  // paint, carpet, fixtures            ~$12/sqft
  light: 2_500,     // + kitchen/bath refresh, flooring   ~$25/sqft
  medium: 4_500,    // + roof or HVAC or windows, full k&b ~$45/sqft
  heavy: 7_000,     // + systems, structural touch-ups    ~$70/sqft
  gut: 10_500,      // full gut to studs                  ~$105/sqft
};

/** Relative construction-cost index per market (1.0 = national baseline). */
const MARKET_COST_INDEX: Record<string, number> = {
  columbus_oh: 1.0,
  toledo_oh: 0.92,
  san_antonio_tx: 0.97,
  houston_tx: 1.0,
  jacksonville_fl: 1.02,
  orlando_fl: 1.04,
  atlanta_ga: 1.03,
  augusta_ga: 0.93,
  memphis_tn: 0.9,
  knoxville_tn: 0.95,
  indianapolis_in: 0.95,
  baltimore_md: 1.08,
};

export interface RepairEstimate {
  level: RepairLevel;
  psfCents: number;
  totalCents: number;
  breakdown: Record<string, number>;
}

export function estimateRepairs(params: {
  sqft: number | null;
  level: RepairLevel;
  marketKey?: string;
  yearBuilt?: number | null;
  units?: number;
  fireDamage?: boolean;
}): RepairEstimate {
  const sqft = params.sqft && params.sqft > 200 ? params.sqft : 1_300; // conservative default
  const index = params.marketKey ? (MARKET_COST_INDEX[params.marketKey] ?? 1.0) : 1.0;

  let psf = BASE_PSF_CENTS[params.level] * index;

  // Old housing stock carries systems risk (knob & tube, galvanized, cast iron).
  if (params.yearBuilt != null && params.yearBuilt < 1950) psf *= 1.12;
  else if (params.yearBuilt != null && params.yearBuilt < 1978) psf *= 1.06; // lead paint era

  // Fire damage pushes any level toward gut economics.
  if (params.fireDamage) psf = Math.max(psf, BASE_PSF_CENTS.heavy * index);

  // Small multifamily: per-unit kitchens/baths raise cost density slightly.
  const units = params.units ?? 1;
  if (units >= 2) psf *= 1 + Math.min(units - 1, 6) * 0.03;

  const psfCents = Math.round(psf);
  const totalCents = Math.round(psfCents * sqft);

  const breakdown: Record<string, number> = {
    base_psf_cents: BASE_PSF_CENTS[params.level],
    market_index: index,
    effective_psf_cents: psfCents,
    sqft_used: sqft,
  };

  return { level: params.level, psfCents, totalCents, breakdown };
}

/** Map qualitative condition language to a repair level (fallback when AI unavailable). */
export function repairLevelFromKeywords(text: string): RepairLevel {
  const t = text.toLowerCase();
  if (/(gut|to the studs|uninhabitable|condemned|fire)/.test(t)) return "gut";
  if (/(roof|foundation|hvac|furnace|plumbing|electrical|mold|water damage)/.test(t)) return "heavy";
  if (/(kitchen|bath|windows|flooring|full rehab)/.test(t)) return "medium";
  if (/(paint|carpet|cosmetic|clean|dated|older)/.test(t)) return "light";
  return "medium"; // unknown → assume medium, not light
}
