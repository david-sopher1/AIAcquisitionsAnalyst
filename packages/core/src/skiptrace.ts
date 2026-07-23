// Skip Trace Agent — waterfall: BatchData primary; premium vendor hook.
import { logger, query, queryOne } from "@dealengine/shared";
import { batchdata } from "@dealengine/integrations";

export async function skipTraceLead(leadId: string): Promise<{ phones: number; emails: number }> {
  const row = await queryOne<{
    owner_id: string | null;
    first_name: string | null;
    last_name: string | null;
    address_line1: string;
    city: string;
    state: string;
    zip: string;
  }>(
    `SELECT l.owner_id, o.first_name, o.last_name,
            p.address_line1, p.city, p.state, p.zip
       FROM leads l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN owners o ON o.id = l.owner_id
      WHERE l.id = $1`,
    [leadId],
  );
  if (!row) return { phones: 0, emails: 0 };

  const traceRow = await queryOne<{ id: string }>(
    `INSERT INTO skip_traces (lead_id, vendor) VALUES ($1, 'batchdata') RETURNING id`,
    [leadId],
  );

  let hit: Awaited<ReturnType<typeof batchdata.skipTrace>> = null;
  try {
    hit = await batchdata.skipTrace({
      firstName: row.first_name ?? undefined,
      lastName: row.last_name ?? undefined,
      addressLine1: row.address_line1,
      city: row.city,
      state: row.state,
      zip: row.zip,
    });
  } catch (err) {
    await query(`UPDATE skip_traces SET status = 'failed', completed_at = now() WHERE id = $1`, [
      traceRow!.id,
    ]);
    throw err;
  }

  if (!hit || (hit.phones.length === 0 && hit.emails.length === 0)) {
    await query(
      `UPDATE skip_traces SET status = 'no_hit', completed_at = now(), raw = $2 WHERE id = $1`,
      [traceRow!.id, JSON.stringify(hit?.raw ?? {})],
    );
    return { phones: 0, emails: 0 };
  }

  let phones = 0;
  let emails = 0;
  for (const p of hit.phones) {
    const type =
      p.type === "mobile" ? "phone_mobile"
      : p.type === "landline" ? "phone_landline"
      : p.type === "voip" ? "phone_voip"
      : "phone_unknown";
    const res = await query(
      `INSERT INTO contact_points (owner_id, lead_id, type, value, confidence, dnc_listed, source, preferred)
       VALUES ($1, $2, $3::contact_point_type, $4, $5, $6, 'batchdata', $7)
       ON CONFLICT (owner_id, type, value) DO UPDATE SET
         confidence = GREATEST(contact_points.confidence, EXCLUDED.confidence),
         dnc_listed = contact_points.dnc_listed OR EXCLUDED.dnc_listed`,
      [
        row.owner_id,
        leadId,
        type,
        p.number,
        p.score != null ? Math.min(p.score / 100, 1) : null,
        p.dnc,
        phones === 0 && p.type === "mobile", // first mobile = preferred
      ],
    );
    phones += res.rowCount ?? 0;
  }
  for (const email of hit.emails) {
    const res = await query(
      `INSERT INTO contact_points (owner_id, lead_id, type, value, source)
       VALUES ($1, $2, 'email', $3, 'batchdata')
       ON CONFLICT (owner_id, type, value) DO NOTHING`,
      [row.owner_id, leadId, email],
    );
    emails += res.rowCount ?? 0;
  }

  await query(
    `UPDATE skip_traces SET status = 'completed', completed_at = now(), raw = $2, cost_cents = 12
      WHERE id = $1`,
    [traceRow!.id, JSON.stringify(hit.raw)],
  );
  await query(
    `UPDATE leads SET status = 'skip_traced' WHERE id = $1 AND status IN ('new','enriching')`,
    [leadId],
  );
  logger.info({ leadId, phones, emails }, "skip trace stored");
  return { phones, emails };
}
