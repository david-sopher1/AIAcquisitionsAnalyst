export * from "./types.js";
export * from "./config.js";
export * from "./logger.js";
export * from "./db.js";
export * from "./address.js";

/** Format integer cents as "$123,456". */
export function centsToUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
