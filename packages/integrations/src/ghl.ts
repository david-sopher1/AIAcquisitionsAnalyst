// CRM Manager — optional one-way sync to GoHighLevel.
// Postgres remains the system of record; GHL mirrors contacts/opportunities
// for users who want its mobile app + pipeline UI.
import { getConfig, logger } from "@dealengine/shared";
import { httpJson } from "./http.js";

const BASE = "https://services.leadconnectorhq.com";

function headers() {
  const cfg = getConfig();
  if (!cfg.GHL_API_KEY) throw new Error("GoHighLevel not configured");
  return {
    Authorization: `Bearer ${cfg.GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

export function ghlEnabled(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.GHL_API_KEY && cfg.GHL_LOCATION_ID);
}

export async function upsertContact(params: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  tags: string[];
}): Promise<string | null> {
  if (!ghlEnabled()) return null;
  const cfg = getConfig();
  try {
    const res = await httpJson<{ contact?: { id: string } }>(
      "ghl",
      `${BASE}/contacts/upsert`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          locationId: cfg.GHL_LOCATION_ID,
          firstName: params.firstName ?? undefined,
          lastName: params.lastName ?? undefined,
          phone: params.phone ?? undefined,
          email: params.email ?? undefined,
          address1: params.address,
          city: params.city,
          state: params.state,
          tags: params.tags,
        }),
      },
    );
    return res.contact?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "ghl upsert failed (non-fatal)");
    return null;
  }
}
