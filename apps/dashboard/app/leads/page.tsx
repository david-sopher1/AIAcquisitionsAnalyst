"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { fetchLeads, fetchMarkets } from "@/lib/api";
import type { LeadListItem, Market } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/constants";
import { StatusBadge, TemperatureBadge, FlagChip, ScorePill } from "@/components/Badge";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { formatNumber, titleCase } from "@/lib/format";

const PAGE_SIZE = 50;

type SortDir = "desc" | "asc" | null;

export default function LeadsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={10} />}>
      <LeadsPageInner />
    </Suspense>
  );
}

function LeadsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [temperature, setTemperature] = useState(searchParams.get("temperature") ?? "");
  const [market, setMarket] = useState(searchParams.get("market") ?? "");
  const [page, setPage] = useState(1);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [items, setItems] = useState<LeadListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  useEffect(() => {
    fetchMarkets()
      .then((res) => setMarkets((res.items ?? []).filter((m) => m.active)))
      .catch(() => setMarkets([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchLeads({
        q: debouncedQ,
        status,
        temperature,
        market,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, temperature, market, page]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted =
    sortDir === null
      ? items
      : [...items].sort((a, b) =>
          sortDir === "desc" ? b.score - a.score : a.score - b.score
        );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const cycleSort = () => {
    setSortDir((d) => (d === "desc" ? "asc" : d === "asc" ? null : "desc"));
  };

  const selectClass =
    "rounded-md border border-slate-700/80 bg-slate-900 px-2.5 py-1.5 text-[13px] text-slate-200 outline-none transition-colors focus:border-emerald-500/60";

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Leads</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {formatNumber(total)} lead{total === 1 ? "" : "s"} matching filters
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search address, owner, zip…"
            className="w-72 rounded-md border border-slate-700/80 bg-slate-900 py-1.5 pl-8 pr-3 text-[13px] text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-500/60"
          />
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={temperature}
          onChange={(e) => {
            setTemperature(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>

        <select
          value={market}
          onChange={(e) => {
            setMarket(e.target.value);
            setPage(1);
          }}
          className={selectClass}
        >
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.key}>
              {m.city}, {m.state}
            </option>
          ))}
        </select>

        {(q || status || temperature || market) && (
          <button
            onClick={() => {
              setQ("");
              setStatus("");
              setTemperature("");
              setMarket("");
              setPage(1);
            }}
            className="text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-300"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-900/60 shadow-card">
        {loading ? (
          <TableSkeleton rows={10} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : sorted.length === 0 ? (
          <EmptyState
            title="No leads found"
            message={
              q || status || temperature || market
                ? "Try loosening the filters or clearing the search."
                : "No leads in the system yet — they will appear as soon as the engine starts pulling from your sources."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-slate-800/80 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Property</th>
                  <th className="px-3 py-2.5 font-medium">Owner</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Temp</th>
                  <th className="px-3 py-2.5 font-medium">
                    <button
                      onClick={cycleSort}
                      className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-slate-300"
                    >
                      Score
                      <span className="text-[10px]">
                        {sortDir === "desc" ? "▼" : sortDir === "asc" ? "▲" : "↕"}
                      </span>
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Stack</th>
                  <th className="px-3 py-2.5 font-medium">Flags</th>
                  <th className="px-3 py-2.5 font-medium">Last contact</th>
                  <th className="px-4 py-2.5 font-medium">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {sorted.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="text-[13px] font-medium text-slate-200">
                        {lead.address}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {lead.city}, {lead.state} {lead.zip}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-300">
                      {lead.ownerName || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <TemperatureBadge temperature={lead.temperature} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScorePill score={lead.score} />
                    </td>
                    <td className="px-3 py-2.5 text-[13px] tabular-nums text-slate-400">
                      {lead.stackCount > 1 ? `×${lead.stackCount}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex max-w-[180px] flex-wrap gap-1">
                        {(lead.flags ?? []).slice(0, 3).map((flag) => (
                          <FlagChip key={flag} flag={flag} />
                        ))}
                        {(lead.flags ?? []).length > 3 && (
                          <span
                            className="text-[10px] text-slate-500"
                            title={(lead.flags ?? []).slice(3).map(titleCase).join(", ")}
                          >
                            +{(lead.flags ?? []).length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-slate-500">
                      {lead.lastContactAt ? relativeTime(lead.lastContactAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-500">
                      {lead.nextActionAt ? relativeTime(lead.nextActionAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <div className="text-[12px] text-slate-500">
            Page {page} of {totalPages} · showing {sorted.length} of {formatNumber(total)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
