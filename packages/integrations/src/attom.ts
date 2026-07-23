// Property Intelligence Agent — ATTOM Data: property detail, AVM, sales comps.
import { getConfig, logger } from "@dealengine/shared";
import { httpJson } from "./http.js";

const BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

function headers() {
  const cfg = getConfig();
  if (!cfg.ATTOM_API_KEY) throw new Error("ATTOM not configured");
  return { apikey: cfg.ATTOM_API_KEY, Accept: "application/json" };
}

export interface AttomDetail {
  avmCents: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lastSaleDate: string | null;
  lastSalePriceCents: number | null;
  assessedValueCents: number | null;
  raw: Record<string, unknown>;
}

export async function getPropertyDetail(params: {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
}): Promise<AttomDetail | null> {
  const address1 = encodeURIComponent(params.addressLine1);
  const address2 = encodeURIComponent(`${params.city}, ${params.state} ${params.zip}`);
  try {
    const res = await httpJson<{ property?: Array<Record<string, any>> }>(
      "attom",
      `${BASE}/allevents/detail?address1=${address1}&address2=${address2}`,
      { headers: headers() },
    );
    const p = res.property?.[0];
    if (!p) return null;
    return {
      avmCents: dollarsToCents(p.avm?.amount?.value),
      beds: numOrNull(p.building?.rooms?.beds),
      baths: numOrNull(p.building?.rooms?.bathstotal),
      sqft: numOrNull(p.building?.size?.universalsize),
      yearBuilt: numOrNull(p.summary?.yearbuilt),
      lastSaleDate: p.sale?.salesearchdate ?? null,
      lastSalePriceCents: dollarsToCents(p.sale?.amount?.saleamt),
      assessedValueCents: dollarsToCents(p.assessment?.assessed?.assdttlvalue),
      raw: p,
    };
  } catch (err) {
    logger.warn({ err, address: params.addressLine1 }, "attom detail failed");
    return null;
  }
}

export interface AttomComp {
  address: string;
  salePriceCents: number;
  saleDate: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  distanceMiles: number | null;
  raw: Record<string, unknown>;
}

/** Recent nearby sales for ARV computation. */
export async function getSalesComps(params: {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  radiusMiles?: number;
  monthsBack?: number;
}): Promise<AttomComp[]> {
  const address1 = encodeURIComponent(params.addressLine1);
  const address2 = encodeURIComponent(`${params.city}, ${params.state} ${params.zip}`);
  try {
    const res = await httpJson<{ property?: Array<Record<string, any>> }>(
      "attom",
      `${BASE}/sale/snapshot?address1=${address1}&address2=${address2}` +
        `&radius=${params.radiusMiles ?? 0.75}&startsalesearchdate=${monthsAgoIso(params.monthsBack ?? 9)}`,
      { headers: headers(), timeoutMs: 45_000 },
    );
    return (res.property ?? [])
      .map((p): AttomComp | null => {
        const price = dollarsToCents(p.sale?.amount?.saleamt);
        const date = p.sale?.salesearchdate ?? p.sale?.saleTransDate;
        if (!price || !date) return null;
        return {
          address: [p.address?.line1, p.address?.line2].filter(Boolean).join(", "),
          salePriceCents: price,
          saleDate: date,
          sqft: numOrNull(p.building?.size?.universalsize),
          beds: numOrNull(p.building?.rooms?.beds),
          baths: numOrNull(p.building?.rooms?.bathstotal),
          distanceMiles: numOrNull(p.location?.distance),
          raw: p,
        };
      })
      .filter((c): c is AttomComp => c !== null);
  } catch (err) {
    logger.warn({ err, address: params.addressLine1 }, "attom comps failed");
    return [];
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function dollarsToCents(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
