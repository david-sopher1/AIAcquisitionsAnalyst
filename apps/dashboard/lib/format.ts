import { format, formatDistanceToNowStrict, parseISO, isValid } from "date-fns";

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCentsFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat("en-US");

/** Convert integer cents to a formatted USD string. Whole dollars by default. */
export function centsToUsd(
  cents: number | null | undefined,
  opts: { showCents?: boolean; compact?: boolean } = {}
): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const dollars = cents / 100;
  if (opts.compact) {
    const abs = Math.abs(dollars);
    if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
    return usdWhole.format(dollars);
  }
  return opts.showCents ? usdCentsFmt.format(dollars) : usdWhole.format(Math.round(dollars));
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return numberFmt.format(n);
}

export function formatPct(
  value: number | null | undefined,
  opts: { decimals?: number } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(opts.decimals ?? 1)}%`;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? parseISO(iso) : null;
  return d && isValid(d) ? d : null;
}

/** "Mar 4, 2026" */
export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? format(d, "MMM d, yyyy") : "—";
}

/** "Mar 4, 2026 · 2:41 PM" */
export function formatDateTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? format(d, "MMM d, yyyy · h:mm a") : "—";
}

/** "3h ago" / "in 2d" — strict, compact relative time. */
export function relativeTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return "—";
  const suffix = d.getTime() <= Date.now() ? " ago" : "";
  const prefix = d.getTime() > Date.now() ? "in " : "";
  const dist = formatDistanceToNowStrict(d)
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
  return `${prefix}${dist}${suffix}`;
}

/** "Mar 4" — short axis label for chart ticks. */
export function formatShortDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? format(d, "MMM d") : "";
}

/** "in_outreach" → "In Outreach" */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
