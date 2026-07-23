// Lead Scoring Agent — compute + persist the composite score.
import { query, queryOne, type DistressFlag } from "@dealengine/shared";
import { scoreLead } from "@dealengine/scoring";

export async function scoreAndPersist(leadId: string): Promise<number | null> {
  const row = await queryOne<{
    stack_count: number;
    est_equity_pct: string | null;
    last_sale_date: string | null;
    assessed_value_cents: string | null;
    avm_value_cents: string | null;
    units: number;
    year_built: number | null;
    is_entity: boolean | null;
    owner_out_of_state: boolean | null;
    owner_age: number | null;
    property_state: string;
  }>(
    `SELECT l.stack_count, p.est_equity_pct::text, p.last_sale_date::text,
            p.assessed_value_cents::text, p.avm_value_cents::text,
            p.units, p.year_built, o.is_entity, o.age AS owner_age,
            (o.mailing_state IS NOT NULL AND o.mailing_state <> p.state) AS owner_out_of_state,
            p.state AS property_state
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!row) return null;

  const flagsRes = await query<{ flag: DistressFlag }>(
    `SELECT flag FROM lead_distress_flags WHERE lead_id = $1`,
    [leadId],
  );

  const ownershipYears = row.last_sale_date
    ? (Date.now() - new Date(row.last_sale_date).getTime()) / (365.25 * 24 * 3600 * 1000)
    : null;

  const { score, breakdown } = scoreLead({
    flags: flagsRes.rows.map((r) => r.flag),
    stackCount: row.stack_count,
    equityPct: row.est_equity_pct != null ? parseFloat(row.est_equity_pct) : null,
    ownershipYears,
    ownerAge: row.owner_age,
    ownerIsEntity: row.is_entity ?? false,
    ownerOutOfState: row.owner_out_of_state ?? false,
    valueCents:
      row.avm_value_cents != null
        ? parseInt(row.avm_value_cents, 10)
        : row.assessed_value_cents != null
          ? parseInt(row.assessed_value_cents, 10)
          : null,
    units: row.units,
    yearBuilt: row.year_built,
  });

  await query(
    `UPDATE leads SET score = $2, score_breakdown = $3,
            status = CASE WHEN status IN ('new','enriching','skip_traced') THEN 'scored' ELSE status END
      WHERE id = $1`,
    [leadId, score, JSON.stringify(breakdown)],
  );
  return score;
}
