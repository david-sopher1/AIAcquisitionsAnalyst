// Comparable Sales Agent + Repair Estimator + Deal Analyzer — run the full
// underwriting stack for a lead and persist comps, valuation, repairs, and
// the deal analysis.
import { logger, query, queryOne, type RepairLevel } from "@dealengine/shared";
import { attom } from "@dealengine/integrations";
import {
  analyzeDeal,
  computeArv,
  estimateRepairs,
  maoRuleForArv,
  repairLevelFromKeywords,
} from "@dealengine/underwriting";

export async function underwriteLead(leadId: string): Promise<boolean> {
  const row = await queryOne<{
    property_id: string;
    address_line1: string;
    city: string;
    state: string;
    zip: string;
    sqft: number | null;
    year_built: number | null;
    units: number;
    avm_value_cents: string | null;
    market_key: string | null;
    repair_level_guess: RepairLevel | null;
    repairs_needed: string | null;
    condition_notes: string | null;
    asking_price_cents: string | null;
    fire_damage: boolean;
  }>(
    `SELECT p.id AS property_id, p.address_line1, p.city, p.state, p.zip,
            p.sqft, p.year_built, p.units, p.avm_value_cents::text,
            m.key AS market_key,
            q.repair_level_guess, q.repairs_needed, q.condition_notes,
            q.asking_price_cents::text,
            EXISTS (SELECT 1 FROM lead_distress_flags f
                     WHERE f.lead_id = l.id AND f.flag = 'fire_damage') AS fire_damage
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN markets m ON m.id = l.market_id
       LEFT JOIN qualifications q ON q.lead_id = l.id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!row) return false;

  // --- 1. Pull comps -----------------------------------------------------
  const comps = await attom.getSalesComps({
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
  });

  const compIds: string[] = [];
  for (const c of comps.slice(0, 20)) {
    const res = await queryOne<{ id: string }>(
      `INSERT INTO comps (property_id, source, address, sale_date, sale_price_cents,
                          sqft, beds, baths, distance_miles, raw)
       VALUES ($1,'attom',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        row.property_id, c.address, c.saleDate, c.salePriceCents,
        c.sqft, c.beds, c.baths, c.distanceMiles, JSON.stringify(c.raw),
      ],
    );
    if (res) compIds.push(res.id);
  }

  // --- 2. ARV ------------------------------------------------------------
  const avmCents = row.avm_value_cents != null ? parseInt(row.avm_value_cents, 10) : null;
  const arv = computeArv({
    subjectSqft: row.sqft,
    comps: comps.map((c, i) => ({
      id: compIds[i],
      salePriceCents: c.salePriceCents,
      saleDate: c.saleDate,
      sqft: c.sqft,
      distanceMiles: c.distanceMiles,
    })),
    avmCents,
  });
  if (!arv) {
    logger.warn({ leadId }, "underwriting skipped: no comps and no AVM");
    return false;
  }
  await query(
    `INSERT INTO valuations (property_id, arv_cents, arv_low_cents, arv_high_cents,
                             method, confidence, comp_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [row.property_id, arv.arvCents, arv.arvLowCents, arv.arvHighCents,
     arv.method, arv.confidence, arv.usedCompIds],
  );

  // --- 3. Repairs ---------------------------------------------------------
  const level: RepairLevel =
    row.repair_level_guess ??
    repairLevelFromKeywords(`${row.repairs_needed ?? ""} ${row.condition_notes ?? ""}`);
  const repairs = estimateRepairs({
    sqft: row.sqft,
    level,
    marketKey: row.market_key ?? undefined,
    yearBuilt: row.year_built,
    units: row.units,
    fireDamage: row.fire_damage,
  });
  await query(
    `INSERT INTO repair_estimates (property_id, lead_id, level, psf_cents, total_cents, breakdown, source)
     VALUES ($1,$2,$3::repair_level,$4,$5,$6,'heuristic')`,
    [row.property_id, leadId, repairs.level, repairs.psfCents, repairs.totalCents,
     JSON.stringify(repairs.breakdown)],
  );

  // --- 4. Deal analysis ----------------------------------------------------
  // Rent heuristic (0.8% of value monthly, midwest/southeast) until a rental
  // AVM vendor is wired in.
  const rentEstimateCents = Math.round(arv.arvCents * 0.008);
  const analysis = analyzeDeal({
    leadId,
    arvCents: arv.arvCents,
    repairsCents: repairs.totalCents,
    maoRulePct: maoRuleForArv(arv.arvCents),
    rentEstimateCents,
    askingPriceCents: row.asking_price_cents != null ? parseInt(row.asking_price_cents, 10) : null,
  });
  await query(
    `INSERT INTO deal_analyses (lead_id, arv_cents, repairs_cents, mao_cents, mao_rule_pct,
       holding_cents, closing_cents, assignment_fee_cents, wholesale_spread_cents,
       flip_profit_cents, rent_estimate_cents, coc_return, brrrr, strategy, inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      leadId, analysis.arvCents, analysis.repairsCents, analysis.maoCents, analysis.maoRulePct,
      analysis.holdingCents, analysis.closingCents, analysis.assignmentFeeCents,
      analysis.wholesaleSpreadCents, analysis.flipProfitCents, analysis.rentEstimateCents,
      analysis.cocReturn, JSON.stringify(analysis.brrrr), analysis.strategy,
      JSON.stringify({ repairLevel: level, arvMethod: arv.method, arvConfidence: arv.confidence }),
    ],
  );

  logger.info({ leadId, arv: arv.arvCents, mao: analysis.maoCents, strategy: analysis.strategy },
    "underwriting complete");
  return true;
}
