"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { KpiRow } from "@/lib/types";
import { CHART_COLORS } from "@/lib/constants";
import { formatShortDate } from "@/lib/format";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyState } from "@/components/EmptyState";

export function KpiTrendChart({ series }: { series: KpiRow[] }) {
  if (!series || series.length === 0) {
    return (
      <EmptyState
        compact
        title="No activity yet"
        message="Daily lead, response, and warm-lead trends will appear here once the engine starts working."
      />
    );
  }

  const data = series.map((row) => ({
    date: row.date,
    "New leads": row.newLeads,
    Responses: row.responses,
    Warm: row.warmLeads,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="fillNewLeads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.newLeads} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.newLeads} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillResponses" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.responses} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.responses} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillWarm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.warm} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.warm} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => formatShortDate(v)}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            content={<ChartTooltip labelRenderer={(l) => formatShortDate(l)} />}
          />
          <Legend iconType="plainline" iconSize={12} />
          <Area
            type="monotone"
            dataKey="New leads"
            stroke={CHART_COLORS.newLeads}
            strokeWidth={2}
            fill="url(#fillNewLeads)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#0b1120" }}
          />
          <Area
            type="monotone"
            dataKey="Responses"
            stroke={CHART_COLORS.responses}
            strokeWidth={2}
            fill="url(#fillResponses)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#0b1120" }}
          />
          <Area
            type="monotone"
            dataKey="Warm"
            stroke={CHART_COLORS.warm}
            strokeWidth={2}
            fill="url(#fillWarm)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#0b1120" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
