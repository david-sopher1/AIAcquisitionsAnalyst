// Property Intelligence Agent — ATTOM enrichment for a lead's property.
import { logger, query, queryOne } from "@dealengine/shared";
import { attom } from "@dealengine/integrations";

export async function enrichLead(leadId: string): Promise<boolean> {
  const row = await queryOne<{
    property_id: string;
    address_line1: string;
    city: string;
    state: string;
    zip: string;
  }>(
    `SELECT p.id AS property_id, p.address_line1, p.city, p.state, p.zip
       FROM leads l JOIN properties p ON p.id = l.property_id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!row) return false;

  const detail = await attom.getPropertyDetail({
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
  });
  if (!detail) {
    logger.info({ leadId }, "no ATTOM detail; keeping source data");
    return false;
  }

  await query(
    `UPDATE properties SET
       beds = COALESCE(beds, $2),
       baths = COALESCE(baths, $3),
       sqft = COALESCE(sqft, $4),
       year_built = COALESCE(year_built, $5),
       last_sale_date = COALESCE(last_sale_date, $6),
       last_sale_price_cents = COALESCE(last_sale_price_cents, $7),
       assessed_value_cents = COALESCE(assessed_value_cents, $8),
       avm_value_cents = COALESCE($9, avm_value_cents),
       avm_source = CASE WHEN $9 IS NOT NULL THEN 'attom' ELSE avm_source END,
       avm_updated_at = CASE WHEN $9 IS NOT NULL THEN now() ELSE avm_updated_at END,
       data = data || $10
     WHERE id = $1`,
    [
      row.property_id,
      detail.beds,
      detail.baths,
      detail.sqft,
      detail.yearBuilt,
      detail.lastSaleDate,
      detail.lastSalePriceCents,
      detail.assessedValueCents,
      detail.avmCents,
      JSON.stringify({ attom: detail.raw }),
    ],
  );

  // Derive equity when we have AVM but no vendor equity estimate.
  await query(
    `UPDATE properties SET est_equity_pct =
       CASE
         WHEN est_equity_pct IS NOT NULL THEN est_equity_pct
         WHEN avm_value_cents IS NOT NULL AND est_mortgage_balance_cents IS NOT NULL AND avm_value_cents > 0
           THEN GREATEST(0, LEAST(1, 1 - est_mortgage_balance_cents::numeric / avm_value_cents))
         ELSE est_equity_pct
       END
     WHERE id = $1`,
    [row.property_id],
  );
  return true;
}
