"use client";

import type { TooltipProps } from "recharts";

interface ChartTooltipExtraProps {
  /** Formats the tooltip heading. Named to avoid colliding with the
   *  `labelFormatter` prop Recharts injects when cloning the content element. */
  labelRenderer?: (label: string) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelRenderer,
}: TooltipProps<number, string> & ChartTooltipExtraProps) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = labelRenderer ? labelRenderer(String(label)) : String(label);
  return (
    <div className="rounded-md border border-slate-700/80 bg-slate-900/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="mb-1.5 text-[11px] font-medium text-slate-400">{heading}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-slate-400">{entry.name}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums text-slate-200">
              {typeof entry.value === "number"
                ? entry.value.toLocaleString("en-US")
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
