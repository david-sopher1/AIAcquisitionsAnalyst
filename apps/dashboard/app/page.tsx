"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchKpis, fetchLeads, fetchSourcePerformance } from "@/lib/api";
import type { KpisResponse, LeadListItem, SourcePerformance } from "@/lib/types";
import { centsToUsd, formatNumber, formatPct, relativeTime } from "@/lib/format";
import { PROJECTED_FEE_PCT } from "@/lib/constants";
import { StatTile } from "@/components/StatTile";
import { Card } from "@/components/Card";
import { StatTileSkeleton, CardSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { ScorePill, TemperatureBadge } from "@/components/Badge";
import { KpiTrendChart } from "@/components/charts/KpiTrendChart";
import { SourceBarChart } from "@/components/charts/SourceBarChart";

export default function OverviewPage() {
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [sources, setSources] = useState<SourcePerformance[]>([]);
  const [hotLeads, setHotLeads] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isInitial: boolean) => {
    if (isInitial) setLoading(true);
    try {
      const [kpiRes, sourceRes, hotRes] = await Promise.all([
        fetchKpis(30),
        fetchSourcePerformance(),
        fetchLeads({ temperature: "hot", pageSize: 8 }),
      ]);
      setKpis(kpiRes);
      setSources(sourceRes.items ?? []);
      setHotLeads(
        [...(hotRes.items ?? [])].sort((a, b) => b.score - a.score).slice(0, 8)
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <StatTileSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={6} />
          <CardSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (error && !kpis) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ErrorState message={error} onRetry={() => load(true)} />
      </div>
    );
  }

  const today = kpis?.today;
  const totals = kpis?.totals;
  const responseRate =
    totals && totals.touchesSent > 0
      ? (totals.responses / totals.touchesSent) * 100
      : null;
  const projectedFeesCents = totals
    ? Math.round(totals.pipelineValueCents * PROJECTED_FEE_PCT)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="New leads today" value={formatNumber(today?.newLeads)} />
        <StatTile
          label="Warm leads"
          value={formatNumber(today?.warmLeads)}
          accent="warm"
          sub={`${formatNumber(totals?.warmLeads)} in last 30d`}
        />
        <StatTile
          label="Hot leads"
          value={formatNumber(today?.hotLeads)}
          accent="hot"
          sub={`${formatNumber(totals?.hotLeads)} in last 30d`}
        />
        <StatTile
          label="Conversations"
          value={formatNumber(today?.responses)}
          sub="responses today"
        />
        <StatTile
          label="Response rate"
          value={formatPct(responseRate)}
          sub={`${formatNumber(totals?.responses)} / ${formatNumber(totals?.touchesSent)} touches (30d)`}
        />
        <StatTile
          label="Offers pending"
          value={formatNumber(today?.offersMade)}
          sub={`${formatNumber(totals?.offersMade)} made in 30d`}
        />
        <StatTile
          label="Contracts"
          value={formatNumber(totals?.contracts)}
          accent="positive"
          sub="last 30 days"
        />
        <StatTile
          label="Pipeline value"
          value={centsToUsd(totals?.pipelineValueCents, { compact: true })}
          accent="positive"
        />
        <StatTile
          label="Projected fees"
          value={centsToUsd(projectedFeesCents, { compact: true })}
          accent="positive"
          sub={`${Math.round(PROJECTED_FEE_PCT * 100)}% of pipeline value`}
        />
        <StatTile
          label="Spend (30d)"
          value={centsToUsd(totals?.spendCents, { compact: true })}
          sub={
            totals && totals.newLeads > 0 && totals.spendCents > 0
              ? `${centsToUsd(Math.round(totals.spendCents / totals.newLeads))} / lead`
              : undefined
          }
        />
      </div>

      {error && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
          Live refresh failed ({error}) — showing last loaded data.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="30-day activity">
          <KpiTrendChart series={kpis?.series ?? []} />
        </Card>
        <Card title="Lead-source performance">
          <SourceBarChart items={sources} />
        </Card>
      </div>

      <Card title="Hot right now" padded={false}>
        {hotLeads.length === 0 ? (
          <EmptyState
            compact
            title="No hot leads yet"
            message="When the AI qualifies a lead as hot, it will surface here for immediate action."
          />
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {hotLeads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-800/40"
                >
                  <ScorePill score={lead.score} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-200">
                      {lead.address}, {lead.city}, {lead.state} {lead.zip}
                    </div>
                    <div className="truncate text-[12px] text-slate-500">
                      {lead.ownerName}
                    </div>
                  </div>
                  <TemperatureBadge temperature={lead.temperature} />
                  <div className="hidden w-24 text-right text-[12px] text-slate-500 sm:block">
                    {lead.lastContactAt ? relativeTime(lead.lastContactAt) : "no contact"}
                  </div>
                  <svg
                    className="h-4 w-4 shrink-0 text-slate-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-100">Overview</h1>
      <p className="mt-0.5 text-[13px] text-slate-500">
        Acquisition engine performance — refreshes every 30 seconds
      </p>
    </div>
  );
}
