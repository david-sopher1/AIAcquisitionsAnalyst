import { STATUS_LABELS } from "@/lib/constants";
import { titleCase } from "@/lib/format";

const badgeBase =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-slate-500/10 text-slate-300 ring-slate-500/30",
  in_outreach: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  conversing: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
  warm: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  hot: "bg-red-500/10 text-red-300 ring-red-500/30",
  appointment: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  offer_made: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  under_contract: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  dead: "bg-slate-700/30 text-slate-500 ring-slate-600/30",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-500/10 text-slate-300 ring-slate-500/30";
  const label = STATUS_LABELS[status] ?? titleCase(status);
  return <span className={`${badgeBase} ${style}`}>{label}</span>;
}

const TEMP_STYLES: Record<string, { style: string; dot: string }> = {
  hot: { style: "bg-red-500/10 text-red-300 ring-red-500/30", dot: "bg-red-400" },
  warm: { style: "bg-amber-500/10 text-amber-300 ring-amber-500/30", dot: "bg-amber-400" },
  cold: { style: "bg-slate-500/10 text-slate-400 ring-slate-500/30", dot: "bg-slate-500" },
};

export function TemperatureBadge({ temperature }: { temperature: string }) {
  const conf =
    TEMP_STYLES[temperature] ?? {
      style: "bg-slate-500/10 text-slate-400 ring-slate-500/30",
      dot: "bg-slate-500",
    };
  return (
    <span className={`${badgeBase} ${conf.style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
      {titleCase(temperature)}
    </span>
  );
}

export function FlagChip({ flag }: { flag: string }) {
  return (
    <span className="inline-flex items-center rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-slate-700/60 whitespace-nowrap">
      {titleCase(flag)}
    </span>
  );
}

export function ScorePill({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-red-300 bg-red-500/10 ring-red-500/30"
      : score >= 60
        ? "text-amber-300 bg-amber-500/10 ring-amber-500/30"
        : "text-slate-300 bg-slate-500/10 ring-slate-500/30";
  return (
    <span className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${color}`}>
      {score}
    </span>
  );
}
