"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchPipeline } from "@/lib/api";
import type { PipelineColumn } from "@/lib/types";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/constants";
import { formatNumber, relativeTime, titleCase } from "@/lib/format";
import { ScorePill, TemperatureBadge } from "@/components/Badge";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

const COLUMN_ACCENTS: Record<string, string> = {
  new: "border-t-slate-500",
  in_outreach: "border-t-sky-500",
  conversing: "border-t-cyan-500",
  warm: "border-t-amber-500",
  hot: "border-t-red-500",
  appointment: "border-t-emerald-500",
  offer_made: "border-t-emerald-500",
  under_contract: "border-t-emerald-400",
};

function orderColumns(columns: PipelineColumn[]): PipelineColumn[] {
  const byStatus = new Map(columns.map((c) => [c.status, c]));
  const known = STATUS_ORDER.map(
    (status) => byStatus.get(status) ?? { status, count: 0, leads: [] }
  );
  const extras = columns.filter(
    (c) => !(STATUS_ORDER as readonly string[]).includes(c.status)
  );
  return [...known, ...extras];
}

export default function PipelinePage() {
  const [columns, setColumns] = useState<PipelineColumn[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchPipeline();
      setColumns(res.columns ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ordered = columns ? orderColumns(columns) : [];
  const totalLeads = ordered.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="flex h-full flex-col space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Pipeline</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {loading ? "Loading…" : `${formatNumber(totalLeads)} leads across ${ordered.length} stages`}
        </p>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-64 shrink-0 space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : totalLeads === 0 ? (
        <EmptyState
          title="Pipeline is empty"
          message="As leads move through outreach and qualification, they will appear in their stage columns here."
        />
      ) : (
        <div className="-mx-2 flex flex-1 gap-3 overflow-x-auto px-2 pb-4">
          {ordered.map((column) => (
            <div
              key={column.status}
              className={`flex w-64 shrink-0 flex-col rounded-lg border border-t-2 border-slate-800/80 bg-slate-900/40 ${
                COLUMN_ACCENTS[column.status] ?? "border-t-slate-600"
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[12px] font-semibold tracking-tight text-slate-200">
                  {STATUS_LABELS[column.status] ?? titleCase(column.status)}
                </span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                  {formatNumber(column.count)}
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {column.leads.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-800 px-3 py-6 text-center text-[11px] text-slate-600">
                    No leads in this stage
                  </div>
                ) : (
                  <>
                    {column.leads.map((lead) => (
                      <Link
                        key={lead.id}
                        href={`/leads/${lead.id}`}
                        className="block rounded-md border border-slate-800/80 bg-slate-900 p-2.5 transition-colors hover:border-slate-700 hover:bg-slate-800/60"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-slate-200">
                              {lead.address}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">
                              {lead.city}, {lead.state}
                            </div>
                          </div>
                          <ScorePill score={lead.score} />
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <TemperatureBadge temperature={lead.temperature} />
                          <span className="text-[10px] text-slate-600">
                            {lead.lastContactAt ? relativeTime(lead.lastContactAt) : ""}
                          </span>
                        </div>
                      </Link>
                    ))}
                    {column.count > column.leads.length && (
                      <Link
                        href={`/leads?status=${column.status}`}
                        className="block rounded-md px-3 py-2 text-center text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-800/50 hover:text-slate-300"
                      >
                        +{formatNumber(column.count - column.leads.length)} more
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
