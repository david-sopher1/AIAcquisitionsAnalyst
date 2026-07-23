// ============================================================================
// Data Cleaning Agent + list stacking — normalize, dedupe, upsert.
// Every raw record from any source flows through here exactly once.
// ============================================================================

import {
  audit,
  logger,
  normalizeAddress,
  parseOwnerName,
  query,
  queryOne,
  withTransaction,
  type RawLeadInput,
} from "@dealengine/shared";

export interface IngestResult {
  leadId: string;
  propertyId: string;
  isNew: boolean;
  stackCount: number;
}

export async function ingestRawLead(input: RawLeadInput): Promise<IngestResult | null> {
  const normalized = normalizeAddress(
    input.address.line1,
    input.address.city,
    input.address.state,
    input.address.zip,
  );

  return withTransaction(async (tx) => {
    const market = await tx.query<{ id: string }>(
      `SELECT id FROM markets WHERE key = $1`,
      [input.marketKey],
    );
    const marketId = market.rows[0]?.id ?? null;

    // --- Property upsert -------------------------------------------------
    const propRes = await tx.query<{ id: string; inserted: boolean }>(
      `INSERT INTO properties (
         market_id, apn, address_line1, address_line2, city, state, zip, county,
         normalized_address, property_type, beds, baths, sqft, year_built, units,
         last_sale_date, last_sale_price_cents, assessed_value_cents,
         avm_value_cents, est_equity_pct, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (normalized_address) DO UPDATE SET
         apn = COALESCE(EXCLUDED.apn, properties.apn),
         beds = COALESCE(EXCLUDED.beds, properties.beds),
         baths = COALESCE(EXCLUDED.baths, properties.baths),
         sqft = COALESCE(EXCLUDED.sqft, properties.sqft),
         year_built = COALESCE(EXCLUDED.year_built, properties.year_built),
         last_sale_date = COALESCE(EXCLUDED.last_sale_date, properties.last_sale_date),
         last_sale_price_cents = COALESCE(EXCLUDED.last_sale_price_cents, properties.last_sale_price_cents),
         assessed_value_cents = COALESCE(EXCLUDED.assessed_value_cents, properties.assessed_value_cents),
         est_equity_pct = COALESCE(EXCLUDED.est_equity_pct, properties.est_equity_pct),
         data = properties.data || EXCLUDED.data
       RETURNING id, (xmax = 0) AS inserted`,
      [
        marketId,
        input.apn ?? null,
        input.address.line1,
        input.address.line2 ?? null,
        input.address.city,
        input.address.state.toUpperCase(),
        input.address.zip,
        input.address.county ?? null,
        normalized,
        input.propertyType ?? "other",
        input.beds ?? null,
        input.baths ?? null,
        input.sqft ?? null,
        input.yearBuilt ?? null,
        input.units ?? 1,
        input.lastSaleDate ?? null,
        input.lastSalePriceCents ?? null,
        input.assessedValueCents ?? null,
        input.avmValueCents ?? null,
        input.estEquityPct ?? null,
        JSON.stringify({ [input.sourceKey]: input.raw ?? {} }),
      ],
    );
    const propertyId = propRes.rows[0]!.id;

    // --- Owner upsert ----------------------------------------------------
    let ownerId: string | null = null;
    if (input.ownerName) {
      const parsed = parseOwnerName(input.ownerName);
      const ownerRes = await tx.query<{ id: string }>(
        `INSERT INTO owners (name_raw, first_name, last_name, is_entity,
                             mailing_line1, mailing_city, mailing_state, mailing_zip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          input.ownerName,
          parsed.firstName,
          parsed.lastName,
          parsed.isEntity,
          input.ownerMailing?.line1 ?? null,
          input.ownerMailing?.city ?? null,
          input.ownerMailing?.state ?? null,
          input.ownerMailing?.zip ?? null,
        ],
      );
      ownerId = ownerRes.rows[0]!.id;
      await tx.query(
        `INSERT INTO property_owners (property_id, owner_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [propertyId, ownerId],
      );
    }

    // --- Lead upsert -----------------------------------------------------
    const leadRes = await tx.query<{ id: string; inserted: boolean }>(
      `INSERT INTO leads (property_id, owner_id, market_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (property_id) DO UPDATE SET
         owner_id = COALESCE(leads.owner_id, EXCLUDED.owner_id)
       RETURNING id, (xmax = 0) AS inserted`,
      [propertyId, ownerId, marketId],
    );
    const leadId = leadRes.rows[0]!.id;
    const isNew = leadRes.rows[0]!.inserted;

    // --- Source hit (list stacking) --------------------------------------
    const source = await tx.query<{ id: string }>(
      `INSERT INTO lead_sources (key, name) VALUES ($1, $1)
       ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
       RETURNING id`,
      [input.sourceKey],
    );
    await tx.query(
      `INSERT INTO lead_source_hits (lead_id, source_id, raw)
       VALUES ($1,$2,$3)
       ON CONFLICT (lead_id, source_id) DO UPDATE SET last_seen = now()`,
      [leadId, source.rows[0]!.id, JSON.stringify(input.raw ?? {})],
    );
    const stack = await tx.query<{ n: string }>(
      `SELECT count(DISTINCT source_id)::text AS n FROM lead_source_hits WHERE lead_id = $1`,
      [leadId],
    );
    const stackCount = parseInt(stack.rows[0]?.n ?? "1", 10);
    await tx.query(`UPDATE leads SET stack_count = $2 WHERE id = $1`, [leadId, stackCount]);

    // --- Distress flags --------------------------------------------------
    for (const flag of input.flags) {
      await tx.query(
        `INSERT INTO lead_distress_flags (lead_id, flag, source_key)
         VALUES ($1, $2::distress_flag, $3)
         ON CONFLICT (lead_id, flag) DO NOTHING`,
        [leadId, flag, input.sourceKey],
      );
    }

    return { leadId, propertyId, isNew, stackCount };
  }).then(async (result) => {
    if (result?.isNew) {
      await audit("system:ingest", "lead_created", "lead", result.leadId, null, {
        source: input.sourceKey,
      });
    }
    return result;
  }).catch((err) => {
    logger.error({ err, address: input.address }, "ingest failed for record");
    return null;
  });
}
