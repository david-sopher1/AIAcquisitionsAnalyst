// ============================================================================
// Comparable Sales Agent — ARV from weighted comps, blended with vendor AVM.
// ============================================================================

export interface CompInput {
  id?: string;
  salePriceCents: number;
  saleDate: string;          // ISO date
  sqft: number | null;
  distanceMiles: number | null;
  beds?: number | null;
  baths?: number | null;
}

export interface ArvResult {
  arvCents: number;
  arvLowCents: number;
  arvHighCents: number;
  method: "comp_weighted" | "avm" | "ai_blend";
  confidence: number; // 0..1
  usedCompIds: string[];
}

/**
 * Weighted price-per-sqft ARV:
 *   weight = recency * proximity * size-similarity
 * Falls back to AVM when fewer than 3 usable comps.
 */
export function computeArv(params: {
  subjectSqft: number | null;
  comps: CompInput[];
  avmCents: number | null;
  now?: Date;
}): ArvResult | null {
  const now = params.now ?? new Date();
  const subjectSqft = params.subjectSqft && params.subjectSqft > 200 ? params.subjectSqft : null;

  const usable = params.comps.filter(
    (c) => c.salePriceCents > 1_000_000 && c.sqft && c.sqft > 200,
  );

  if (usable.length >= 3 && subjectSqft) {
    let weightSum = 0;
    let weightedPsf = 0;
    const psfs: number[] = [];
    const usedIds: string[] = [];

    for (const comp of usable) {
      const ageMonths = monthsBetween(new Date(comp.saleDate), now);
      if (ageMonths > 12) continue;

      const recency = Math.max(0.2, 1 - ageMonths / 12);           // 0.2..1
      const proximity =
        comp.distanceMiles == null
          ? 0.6
          : Math.max(0.2, 1 - Math.min(comp.distanceMiles, 2) / 2); // within 2mi
      const sizeRatio = comp.sqft! / subjectSqft;
      const sizeSim = Math.max(0.2, 1 - Math.abs(1 - sizeRatio));   // penalize size mismatch

      const weight = recency * proximity * sizeSim;
      const psf = comp.salePriceCents / comp.sqft!;
      weightedPsf += psf * weight;
      weightSum += weight;
      psfs.push(psf);
      if (comp.id) usedIds.push(comp.id);
    }

    if (weightSum > 0 && psfs.length >= 3) {
      const avgPsf = weightedPsf / weightSum;
      const compArv = Math.round(avgPsf * subjectSqft);

      // Blend with AVM when available (comps 70% / AVM 30%).
      const arv =
        params.avmCents != null
          ? Math.round(compArv * 0.7 + params.avmCents * 0.3)
          : compArv;

      const spread = stddev(psfs) / mean(psfs); // coefficient of variation
      const confidence = clamp(1 - spread, 0.3, 0.95);

      return {
        arvCents: arv,
        arvLowCents: Math.round(arv * (1 - Math.min(spread, 0.25))),
        arvHighCents: Math.round(arv * (1 + Math.min(spread, 0.25))),
        method: params.avmCents != null ? "ai_blend" : "comp_weighted",
        confidence,
        usedCompIds: usedIds,
      };
    }
  }

  if (params.avmCents != null) {
    return {
      arvCents: params.avmCents,
      arvLowCents: Math.round(params.avmCents * 0.85),
      arvHighCents: Math.round(params.avmCents * 1.15),
      method: "avm",
      confidence: 0.5,
      usedCompIds: [],
    };
  }

  return null;
}

function monthsBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (30.44 * 24 * 3600 * 1000);
}
function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
