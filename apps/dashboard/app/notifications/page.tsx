"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchNotifications, markNotificationRead } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { relativeTime, titleCase } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

const ICON_PATHS: Record<string, { paths: string[]; color: string }> = {
  flame: {
    paths: [
      "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
    ],
    color: "text-red-400",
  },
  sun: {
    paths: [
      "M12 3v2 M12 19v2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M3 12h2 M19 12h2 M5.6 18.4 7 17 M17 7l1.4-1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    ],
    color: "text-amber-400",
  },
  calendar: {
    paths: [
      "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    ],
    color: "text-emerald-400",
  },
  document: {
    paths: [
      "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
      "M14 2v6h6 M9 13h6 M9 17h6",
    ],
    color: "text-emerald-400",
  },
  phone: {
    paths: [
      "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z",
    ],
    color: "text-sky-400",
  },
  bell: {
    paths: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
    color: "text-slate-400",
  },
};

const KIND_TO_ICON: Record<string, keyof typeof ICON_PATHS> = {
  hot_lead: "flame",
  warm_lead: "sun",
  appointment: "calendar",
  offer: "document",
  offer_made: "document",
  contract: "document",
  under_contract: "document",
  callback: "phone",
  response: "phone",
};

function KindIcon({ kind }: { kind: string }) {
  const conf = ICON_PATHS[KIND_TO_ICON[kind] ?? "bell"];
  return (
    <svg
      className={`h-4 w-4 ${conf.color}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {conf.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async (isInitial: boolean) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetchNotifications(false);
      setItems(res.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleMarkRead = async (id: string) => {
    if (markingIds.has(id)) return;
    setMarkingIds((prev) => new Set(prev).add(id));
    const readAt = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
    try {
      await markNotificationRead(id);
    } catch {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: null } : n)));
    } finally {
      setMarkingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const unread = items.filter((n) => !n.readAt);
  const visible = filter === "unread" ? unread : items;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Notifications
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {unread.length > 0
              ? `${unread.length} unread — refreshes every 30 seconds`
              : "All caught up — refreshes every 30 seconds"}
          </p>
        </div>
        <div className="flex rounded-md border border-slate-700/80 bg-slate-900 p-0.5">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
                filter === f
                  ? "bg-slate-800 text-slate-200"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {f === "all" ? "All" : `Unread${unread.length > 0 ? ` (${unread.length})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-900/60 shadow-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => load(true)} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
            message={
              filter === "unread"
                ? "You are fully caught up."
                : "Hot leads, appointments, and contract events will land here as the engine works."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-800/50">
            {visible.map((n) => {
              const isUnread = !n.readAt;
              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                    isUnread ? "bg-slate-800/25" : ""
                  }`}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800/80 ring-1 ring-inset ring-slate-700/60">
                    <KindIcon kind={n.kind} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isUnread && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      )}
                      <span
                        className={`truncate text-[13px] font-medium ${
                          isUnread ? "text-slate-100" : "text-slate-400"
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-500 ring-1 ring-inset ring-slate-700/60">
                        {titleCase(n.kind)}
                      </span>
                    </div>
                    <p
                      className={`mt-0.5 text-[12px] leading-relaxed ${
                        isUnread ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {n.body}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-600">
                      <span>{relativeTime(n.createdAt)}</span>
                      {n.leadId && (
                        <Link
                          href={`/leads/${n.leadId}`}
                          className="font-medium text-emerald-500 transition-colors hover:text-emerald-400"
                        >
                          View lead →
                        </Link>
                      )}
                    </div>
                  </div>
                  {isUnread && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      disabled={markingIds.has(n.id)}
                      className="shrink-0 rounded-md border border-slate-700/80 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
