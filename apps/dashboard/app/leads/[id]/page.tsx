"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchLead, setTakeover } from "@/lib/api";
import type { LeadDetailResponse, Touch } from "@/lib/types";
import {
  centsToUsd,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPct,
  relativeTime,
  titleCase,
} from "@/lib/format";
import { Card, KeyValueRow } from "@/components/Card";
import { StatusBadge, TemperatureBadge, FlagChip, ScorePill } from "@/components/Badge";
import { CardSkeleton, Skeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/EmptyState";
import { ConversationPanel } from "@/components/ConversationPanel";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params?.id ?? "";

  const [data, setData] = useState<LeadDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    try {
      const res = await fetchLead(leadId);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleTakeoverToggle = async () => {
    if (!data || toggling) return;
    const next = !data.lead.humanTakeover;
    setToggling(true);
    setData({ ...data, lead: { ...data.lead, humanTakeover: next } });
    try {
      await setTakeover(data.lead.id, next);
    } catch {
      setData((prev) =>
        prev ? { ...prev, lead: { ...prev.lead, humanTakeover: !next } } : prev
      );
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <CardSkeleton rows={5} />
            <CardSkeleton rows={5} />
          </div>
          <CardSkeleton rows={10} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState
          message={error ?? "Lead not found"}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      </div>
    );
  }

  const { lead, property, owner, contactPoints, flags, qualification, dealAnalysis, touches, conversations } = data;

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              {lead.address}
            </h1>
            <ScorePill score={lead.score} />
            <TemperatureBadge temperature={lead.temperature} />
            <StatusBadge status={lead.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
            <span>
              {lead.city}, {lead.state} {lead.zip}
            </span>
            <span className="text-slate-700">·</span>
            <span>
              Owner: <span className="text-slate-400">{lead.ownerName || "Unknown"}</span>
              {owner?.isEntity && (
                <span className="ml-1.5 rounded bg-slate-800 px-1 py-px text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-slate-700">
                  Entity
                </span>
              )}
            </span>
            <span className="text-slate-700">·</span>
            <span>Created {formatDate(lead.createdAt)}</span>
          </div>
          {flags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {flags.map((flag) => (
                <FlagChip key={flag} flag={flag} />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={handleTakeoverToggle}
          disabled={toggling}
          className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-medium ring-1 ring-inset transition-colors disabled:opacity-60 ${
            lead.humanTakeover
              ? "bg-amber-500/15 text-amber-300 ring-amber-500/40 hover:bg-amber-500/25"
              : "bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800"
          }`}
        >
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
              lead.humanTakeover ? "bg-amber-500/70" : "bg-slate-700"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                lead.humanTakeover ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </span>
          {lead.humanTakeover ? "Human takeover on" : "AI is driving"}
        </button>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {dealAnalysis && (
            <Card title={`Deal analysis — ${titleCase(dealAnalysis.strategy)}`}>
              <div className="grid grid-cols-3 gap-3">
                <BigMoney label="ARV" cents={dealAnalysis.arvCents} />
                <BigMoney label="Repairs" cents={dealAnalysis.repairsCents} />
                <BigMoney
                  label={`MAO (${Math.round(dealAnalysis.maoRulePct * 100)}% rule)`}
                  cents={dealAnalysis.maoCents}
                  emphasized
                />
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <KeyValueRow label="Assignment fee">
                  <span className="font-medium text-emerald-400">
                    {centsToUsd(dealAnalysis.assignmentFeeCents)}
                  </span>
                </KeyValueRow>
                <KeyValueRow label="Flip profit">
                  {centsToUsd(dealAnalysis.flipProfitCents)}
                </KeyValueRow>
                <KeyValueRow label="Rent estimate">
                  {centsToUsd(dealAnalysis.rentEstimateCents)}/mo
                </KeyValueRow>
                <KeyValueRow label="Strategy">{titleCase(dealAnalysis.strategy)}</KeyValueRow>
              </dl>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Property">
              {property ? (
                <dl>
                  <KeyValueRow label="Type">{titleCase(property.propertyType)}</KeyValueRow>
                  <KeyValueRow label="Beds / Baths">
                    {property.beds ?? "—"} bd · {property.baths ?? "—"} ba
                  </KeyValueRow>
                  <KeyValueRow label="Sq ft">
                    {property.sqft ? formatNumber(property.sqft) : "—"}
                  </KeyValueRow>
                  <KeyValueRow label="Year built">{property.yearBuilt ?? "—"}</KeyValueRow>
                  {property.units !== null && property.units > 1 && (
                    <KeyValueRow label="Units">{property.units}</KeyValueRow>
                  )}
                  <KeyValueRow label="Last sale">
                    {property.lastSaleDate
                      ? `${formatDate(property.lastSaleDate)} · ${centsToUsd(property.lastSalePriceCents)}`
                      : "—"}
                  </KeyValueRow>
                  <KeyValueRow label="AVM value">
                    <span className="font-medium">{centsToUsd(property.avmValueCents)}</span>
                  </KeyValueRow>
                  <KeyValueRow label="Est. equity">
                    <span className={property.estEquityPct !== null && property.estEquityPct >= 50 ? "font-medium text-emerald-400" : ""}>
                      {formatPct(property.estEquityPct, { decimals: 0 })}
                    </span>
                  </KeyValueRow>
                  {owner?.mailingAddress && (
                    <KeyValueRow label="Owner mailing">
                      <span className="text-[12px]">{owner.mailingAddress}</span>
                    </KeyValueRow>
                  )}
                </dl>
              ) : (
                <EmptyState compact title="No property data" message="Property details have not been enriched yet." />
              )}
            </Card>

            <Card title="Qualification">
              {qualification ? (
                <div>
                  <dl>
                    <KeyValueRow label="Qualified">
                      {qualification.qualified ? (
                        <span className="font-medium text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-slate-400">Not yet</span>
                      )}
                    </KeyValueRow>
                    <KeyValueRow label="Motivation">
                      {titleCase(qualification.motivationLevel)}
                    </KeyValueRow>
                    <KeyValueRow label="Reason">
                      {qualification.reasonForSelling ?? "—"}
                    </KeyValueRow>
                    <KeyValueRow label="Timeline">
                      {qualification.timelineWeeks !== null
                        ? `${qualification.timelineWeeks} weeks`
                        : "—"}
                    </KeyValueRow>
                    <KeyValueRow label="Asking price">
                      <span className="font-medium">
                        {centsToUsd(qualification.askingPriceCents)}
                      </span>
                    </KeyValueRow>
                    <KeyValueRow label="Occupancy">{titleCase(qualification.occupancy)}</KeyValueRow>
                    <KeyValueRow label="Mortgage">{titleCase(qualification.mortgageStatus)}</KeyValueRow>
                    <KeyValueRow label="Best contact">
                      {titleCase(qualification.bestContactMethod)}
                    </KeyValueRow>
                    {qualification.callbackAt && (
                      <KeyValueRow label="Callback">
                        <span className="text-amber-300">
                          {formatDateTime(qualification.callbackAt)}
                        </span>
                      </KeyValueRow>
                    )}
                  </dl>
                  {qualification.conditionNotes && (
                    <div className="mt-3 rounded-md bg-slate-800/50 p-2.5">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        Condition
                      </div>
                      <p className="text-[12px] leading-relaxed text-slate-300">
                        {qualification.conditionNotes}
                      </p>
                    </div>
                  )}
                  {qualification.objections.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        Objections
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {qualification.objections.map((o) => (
                          <span
                            key={o}
                            className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-300 ring-1 ring-inset ring-red-500/20"
                          >
                            {o}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {qualification.conversationSummary && (
                    <div className="mt-3 rounded-md bg-slate-800/50 p-2.5">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        AI summary
                      </div>
                      <p className="text-[12px] leading-relaxed text-slate-300">
                        {qualification.conversationSummary}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="Not qualified yet"
                  message="Qualification details will fill in as the AI works the conversation."
                />
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Contact points" padded={false}>
              {contactPoints.length === 0 ? (
                <EmptyState
                  compact
                  title="No contact points"
                  message="Skip tracing has not produced any phone numbers or emails yet."
                />
              ) : (
                <ul className="divide-y divide-slate-800/50">
                  {contactPoints.map((cp) => (
                    <li key={cp.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                        {cp.type}
                      </span>
                      <span className="flex-1 truncate font-mono text-[13px] text-slate-200">
                        {cp.value}
                      </span>
                      <span
                        className="text-[11px] tabular-nums text-slate-500"
                        title="Skip-trace confidence"
                      >
                        {Math.round(cp.confidence * 100)}%
                      </span>
                      {cp.dncListed && (
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 ring-1 ring-inset ring-red-500/30">
                          DNC
                        </span>
                      )}
                      {cp.optedOut && (
                        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-inset ring-slate-600/50">
                          Opted out
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Touch history" padded={false}>
              {touches.length === 0 ? (
                <EmptyState
                  compact
                  title="No touches yet"
                  message="Outreach attempts will appear here as the cadence runs."
                />
              ) : (
                <div className="max-h-80 overflow-y-auto px-4 py-3">
                  <TouchTimeline touches={touches} />
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="min-h-[560px] overflow-hidden rounded-lg border border-slate-800/80 bg-slate-900/60 shadow-card xl:sticky xl:top-6 xl:h-[calc(100vh-6rem)]">
          <ConversationPanel
            conversations={conversations}
            humanTakeover={lead.humanTakeover}
          />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/leads"
      className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-slate-300"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      All leads
    </Link>
  );
}

function BigMoney({
  label,
  cents,
  emphasized = false,
}: {
  label: string;
  cents: number;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-md px-3 py-2.5 ${
        emphasized
          ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30"
          : "bg-slate-800/50"
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums tracking-tight ${
          emphasized ? "text-emerald-400" : "text-slate-100"
        }`}
      >
        {centsToUsd(cents)}
      </div>
    </div>
  );
}

const TOUCH_STATUS_COLORS: Record<string, string> = {
  sent: "bg-emerald-400",
  delivered: "bg-emerald-400",
  responded: "bg-sky-400",
  scheduled: "bg-slate-500",
  queued: "bg-slate-500",
  failed: "bg-red-400",
  bounced: "bg-red-400",
  skipped: "bg-slate-600",
};

function TouchTimeline({ touches }: { touches: Touch[] }) {
  return (
    <ol className="relative space-y-4 border-l border-slate-800 pl-4">
      {touches.map((touch) => {
        const dot = TOUCH_STATUS_COLORS[touch.status] ?? "bg-slate-500";
        const when = touch.sentAt ?? touch.scheduledAt;
        return (
          <li key={touch.id} className="relative">
            <span
              className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-slate-900 ${dot}`}
            />
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-medium text-slate-200">
                {titleCase(touch.channel)}
              </span>
              <span className="text-[11px] text-slate-500">{titleCase(touch.status)}</span>
              <span className="ml-auto shrink-0 text-[11px] text-slate-600" title={formatDateTime(when)}>
                {touch.sentAt
                  ? relativeTime(touch.sentAt)
                  : touch.scheduledAt
                    ? `sched. ${relativeTime(touch.scheduledAt)}`
                    : "—"}
              </span>
            </div>
            {touch.bodyPreview && (
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-slate-500">
                {touch.bodyPreview}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
