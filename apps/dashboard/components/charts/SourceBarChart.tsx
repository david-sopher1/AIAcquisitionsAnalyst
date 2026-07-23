"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { SourcePerformance } from "@/lib/types";
import { CHART_COLORS } from "@/lib/constants";
import { titleCase } from "@/lib/format";
import { ChartTooltip } from "./ChartTooltip";
import { EmptyState } from "@/components/EmptyState";

export function SourceBarChart({ items }: { items: SourcePerformance[] }) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        compact
        title="No source data yet"
        message="Lead-source performance will populate once leads start flowing in from your configured sources."
      />
    );
  }

  const data = items.map((s) => ({
    source: titleCase(s.source),
    Leads: s.leads,
    Responses: s.responses,
    Hot: s.hot,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="source"
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Legend iconType="square" iconSize={10} />
          <Bar dataKey="Leads" fill={CHART_COLORS.newLeads} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Responses" fill={CHART_COLORS.responses} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Hot" fill={CHART_COLORS.hot} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
