interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "default" | "positive" | "hot" | "warm";
}

const VALUE_COLORS: Record<NonNullable<StatTileProps["accent"]>, string> = {
  default: "text-slate-100",
  positive: "text-emerald-400",
  hot: "text-red-400",
  warm: "text-amber-400",
};

export function StatTile({ label, value, sub, accent = "default" }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-900/60 px-4 py-3 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${VALUE_COLORS[accent]}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
