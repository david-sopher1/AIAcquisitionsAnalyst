// Lead Generation + Skip Trace — BatchData API.
// Docs: https://developer.batchdata.com — property search, property lookup,
// and skip tracing under one key. Endpoint shapes verified at integration
// time; response mapping is defensive.
import {
  getConfig,
  logger,
  type DistressFlag,
  type RawLeadInput,
} from "@dealengine/shared";
import { httpJson } from "./http.js";

const BASE = "https://api.batchdata.com/api/v1";

function headers() {
  const cfg = getConfig();
  if (!cfg.BATCHDATA_API_KEY) throw new Error("BatchData not configured");
  return {
    Authorization: `Bearer ${cfg.BATCHDATA_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Map BatchData quicklist names to our distress flags. */
const QUICKLIST_TO_FLAG: Record<string, DistressFlag> = {
  "vacant": "vacant",
  "absentee-owner": "absentee_owner",
  "out-of-state-owner": "out_of_state_owner",
  "tax-default": "tax_delinquent",
  "preforeclosure": "pre_foreclosure",
  "inherited": "inherited",
  "tired-landlord": "tired_landlord",
  "high-equity": "high_equity",
  "free-and-clear": "free_and_clear",
};

export interface BatchSearchParams {
  city: string;
  state: string;
  zips?: string[];
  quicklists: string[];        // e.g. ["preforeclosure","vacant"]
  take?: number;               // page size
  skip?: number;
  marketKey: string;
}

/** Pull distressed-property records for a market. */
export async function searchProperties(params: BatchSearchParams): Promise<RawLeadInput[]> {
  const body = {
    searchCriteria: {
      query: `${params.city}, ${params.state}`,
      ...(params.zips?.length ? { zip: params.zips } : {}),
      quickLists: params.quicklists,
    },
    options: { take: params.take ?? 250, skip: params.skip ?? 0 },
  };

  const res = await httpJson<{
    results?: { properties?: Array<Record<string, any>> };
  }>("batchdata", `${BASE}/property/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    timeoutMs: 60_000,
  });

  const properties = res.results?.properties ?? [];
  const out: RawLeadInput[] = [];

  for (const p of properties) {
    const addr = p.address ?? {};
    if (!addr.street || !addr.city || !addr.state || !addr.zip) continue;

    const flags: DistressFlag[] = [];
    for (const [ql, flag] of Object.entries(QUICKLIST_TO_FLAG)) {
      if (p.quickLists?.includes?.(ql) || params.quicklists.includes(ql)) {
        if (params.quicklists.includes(ql) && !flags.includes(flag)) flags.push(flag);
      }
    }

    out.push({
      sourceKey: "batchdata",
      marketKey: params.marketKey,
      address: {
        line1: addr.street,
        city: addr.city,
        state: addr.state,
        zip: String(addr.zip),
        county: addr.county,
      },
      apn: p.assessment?.apn ?? p.apn,
      ownerName: p.owner?.fullName ?? p.owner?.name,
      ownerMailing: p.owner?.mailingAddress
        ? {
            line1: p.owner.mailingAddress.street,
            city: p.owner.mailingAddress.city,
            state: p.owner.mailingAddress.state,
            zip: p.owner.mailingAddress.zip ? String(p.owner.mailingAddress.zip) : undefined,
          }
        : undefined,
      beds: numOrUndef(p.building?.bedroomCount),
      baths: numOrUndef(p.building?.bathroomCount),
      sqft: numOrUndef(p.building?.totalBuildingAreaSquareFeet),
      yearBuilt: numOrUndef(p.building?.yearBuilt),
      units: numOrUndef(p.building?.unitCount) ?? 1,
      lastSaleDate: p.sale?.lastSaleDate,
      lastSalePriceCents: dollarsToCents(p.sale?.lastSalePrice),
      assessedValueCents: dollarsToCents(p.assessment?.totalMarketValue),
      avmCents: undefined,
      estEquityPct: fractionOrUndef(p.valuation?.equityPercent),
      flags,
      raw: p,
    } as RawLeadInput & { avmCents?: number });
  }

  logger.info({ market: params.marketKey, count: out.length }, "batchdata search complete");
  return out;
}

export interface SkipTraceHit {
  phones: Array<{ number: string; type: "mobile" | "landline" | "voip" | "unknown"; dnc: boolean; score: number | null }>;
  emails: string[];
  raw: Record<string, unknown>;
}

/** Skip trace one owner/property. */
export async function skipTrace(params: {
  firstName?: string;
  lastName?: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
}): Promise<SkipTraceHit | null> {
  const res = await httpJson<{
    results?: {
      persons?: Array<{
        phoneNumbers?: Array<{ number: string; type?: string; dnc?: boolean; score?: number; reachable?: boolean }>;
        emails?: Array<{ email: string }>;
      }>;
    };
  }>("batchdata", `${BASE}/property/skip-trace`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      requests: [
        {
          propertyAddress: {
            street: params.addressLine1,
            city: params.city,
            state: params.state,
            zip: params.zip,
          },
          ...(params.firstName || params.lastName
            ? { name: { first: params.firstName, last: params.lastName } }
            : {}),
        },
      ],
    }),
    timeoutMs: 60_000,
  });

  const person = res.results?.persons?.[0];
  if (!person) return null;

  const phones = (person.phoneNumbers ?? []).map((p) => ({
    number: p.number.startsWith("+") ? p.number : `+1${p.number.replace(/\D/g, "").slice(-10)}`,
    type: (["mobile", "landline", "voip"].includes(p.type ?? "") ? p.type : "unknown") as
      | "mobile" | "landline" | "voip" | "unknown",
    dnc: p.dnc ?? false,
    score: p.score ?? null,
  }));
  const emails = (person.emails ?? []).map((e) => e.email.toLowerCase());
  return { phones, emails, raw: person as Record<string, unknown> };
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function dollarsToCents(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}
function fractionOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n > 1 ? n / 100 : n;
}
