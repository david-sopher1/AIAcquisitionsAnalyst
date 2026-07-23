// USPS-style address normalization for deduplication.
// Deterministic and dependency-free: uppercase, strip punctuation, expand or
// collapse common suffixes/directionals, collapse whitespace.

const SUFFIXES: Record<string, string> = {
  AVENUE: "AVE", AV: "AVE",
  BOULEVARD: "BLVD", BOUL: "BLVD",
  CIRCLE: "CIR", CRCLE: "CIR",
  COURT: "CT", CRT: "CT",
  DRIVE: "DR", DRV: "DR",
  EXPRESSWAY: "EXPY",
  HIGHWAY: "HWY",
  LANE: "LN",
  PARKWAY: "PKWY", PKWAY: "PKWY",
  PLACE: "PL",
  ROAD: "RD",
  SQUARE: "SQ",
  STREET: "ST", STR: "ST",
  TERRACE: "TER", TERR: "TER",
  TRAIL: "TRL",
  WAY: "WAY",
  ALLEY: "ALY",
  CROSSING: "XING",
  EXTENSION: "EXT",
  GROVE: "GRV",
  HEIGHTS: "HTS",
  JUNCTION: "JCT",
  LOOP: "LOOP",
  PIKE: "PIKE",
  POINT: "PT",
  RIDGE: "RDG",
  RUN: "RUN",
};

const DIRECTIONALS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

const UNIT_WORDS = new Set(["APT", "UNIT", "STE", "SUITE", "FL", "FLOOR", "#"]);

export function normalizeAddress(
  line1: string,
  city: string,
  state: string,
  zip: string,
  opts: { includeUnit?: boolean } = {},
): string {
  const cleaned = line1
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned.split(" ");
  const out: string[] = [];
  let inUnit = false;

  for (const token of tokens) {
    if (UNIT_WORDS.has(token)) {
      inUnit = true;
      if (!opts.includeUnit) break;
      out.push("UNIT");
      continue;
    }
    if (inUnit && !opts.includeUnit) break;
    const mapped = SUFFIXES[token] ?? DIRECTIONALS[token] ?? token;
    out.push(mapped);
  }

  const zip5 = zip.replace(/\D/g, "").slice(0, 5);
  return [
    out.join(" "),
    city.toUpperCase().replace(/\s+/g, " ").trim(),
    state.toUpperCase().trim(),
    zip5,
  ].join("|");
}

/** Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11) return `+${digits}`;
  return null;
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Parse "LAST FIRST M" / "FIRST LAST" / entity names from county records. */
export function parseOwnerName(raw: string): {
  firstName: string | null;
  lastName: string | null;
  isEntity: boolean;
} {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const entityMarkers = /\b(LLC|L\.L\.C|INC|CORP|TRUST|TRUSTEE|ESTATE|BANK|LP|LLP|LTD|COMPANY|CO|HOLDINGS|PROPERTIES|INVESTMENTS|PARTNERS|HOA|CHURCH|CITY OF|COUNTY OF)\b/i;
  if (entityMarkers.test(cleaned)) {
    return { firstName: null, lastName: null, isEntity: true };
  }
  // County records are commonly "LAST FIRST MIDDLE"
  const parts = cleaned.split(" ");
  if (parts.length >= 2 && cleaned === cleaned.toUpperCase()) {
    return { firstName: parts[1] ?? null, lastName: parts[0] ?? null, isEntity: false };
  }
  // Otherwise assume "First Last"
  const first = parts[0] ?? null;
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? null) : null;
  return { firstName: first, lastName: last, isEntity: false };
}
