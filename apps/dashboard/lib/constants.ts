export const STATUS_ORDER = [
  "new",
  "in_outreach",
  "conversing",
  "warm",
  "hot",
  "appointment",
  "offer_made",
  "under_contract",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_outreach: "In Outreach",
  conversing: "Conversing",
  warm: "Warm",
  hot: "Hot",
  appointment: "Appointment",
  offer_made: "Offer Made",
  under_contract: "Under Contract",
  dead: "Dead",
  closed: "Closed",
};

export const TEMPERATURE_OPTIONS = ["cold", "warm", "hot"] as const;

/**
 * Assumed assignment-fee yield on total pipeline value, used only for the
 * "Projected assignment fees" overview tile (the API does not expose a
 * fee projection at the KPI level). 6% is the operator-configured target
 * spread for the acquisitions team.
 */
export const PROJECTED_FEE_PCT = 0.06;

/** Chart series colors — blue / green / orange trio, validated for the
 *  slate-950 surface (distinct hue + lightness for CVD readers). */
export const CHART_COLORS = {
  newLeads: "#38bdf8",
  responses: "#34d399",
  warm: "#fbbf24",
  hot: "#f87171",
  grid: "#1e293b",
  axis: "#64748b",
} as const;
