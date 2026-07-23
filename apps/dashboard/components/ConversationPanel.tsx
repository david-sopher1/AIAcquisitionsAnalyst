"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMessages, sendMessage } from "@/lib/api";
import type { ConversationSummary, Message } from "@/lib/types";
import { formatDateTime, relativeTime, titleCase } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

interface ConversationPanelProps {
  conversations: ConversationSummary[];
  humanTakeover: boolean;
}

function sortByRecency(conversations: ConversationSummary[]): ConversationSummary[] {
  return [...conversations].sort((a, b) => {
    const ta = a.lastInboundAt ? Date.parse(a.lastInboundAt) : 0;
    const tb = b.lastInboundAt ? Date.parse(b.lastInboundAt) : 0;
    return tb - ta;
  });
}

export function ConversationPanel({ conversations, humanTakeover }: ConversationPanelProps) {
  const ordered = sortByRecency(conversations);
  const [selectedId, setSelectedId] = useState<string | null>(
    ordered.length > 0 ? ordered[0].id : null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (conversationId: string) => {
    setLoading(true);
    try {
      const res = await fetchMessages(conversationId);
      setMessages(res.messages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) load(selectedId);
  }, [selectedId, load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !selectedId || !humanTakeover || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(selectedId, body);
      setDraft("");
      await load(selectedId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader />
        <EmptyState
          title="No conversations yet"
          message="Once outreach lands and the seller replies, the full thread will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader />

      {ordered.length > 1 && (
        <div className="flex gap-1.5 border-b border-slate-800/60 px-4 py-2">
          {ordered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                c.id === selectedId
                  ? "bg-slate-800 text-slate-200"
                  : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"
              }`}
            >
              {titleCase(c.channel)}
              {c.lastInboundAt && (
                <span className="ml-1.5 text-slate-600">{relativeTime(c.lastInboundAt)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="ml-auto h-14 w-2/3" />
            <Skeleton className="h-14 w-1/2" />
          </div>
        ) : error ? (
          <EmptyState compact title="Could not load messages" message={error} />
        ) : messages.length === 0 ? (
          <EmptyState
            compact
            title="Empty thread"
            message="No messages have been exchanged on this conversation yet."
          />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      <div className="border-t border-slate-800/60 p-3">
        {!humanTakeover && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-slate-800/50 px-3 py-2 text-[12px] text-slate-400">
            <svg
              className="h-3.5 w-3.5 shrink-0 text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            The AI is handling this conversation. Turn on Takeover to reply manually.
          </div>
        )}
        {sendError && (
          <div className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-300 ring-1 ring-inset ring-red-500/30">
            {sendError}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={!humanTakeover || sending}
            rows={2}
            placeholder={
              humanTakeover ? "Type a reply… (Enter to send)" : "Takeover required to reply"
            }
            className="flex-1 resize-none rounded-md border border-slate-700/80 bg-slate-900 px-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!humanTakeover || sending || draft.trim().length === 0}
            className="rounded-md bg-emerald-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <header className="flex items-center justify-between border-b border-slate-800/60 px-4 py-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-slate-200">
        Conversation
      </h2>
    </header>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const inbound = message.direction === "inbound";
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          inbound
            ? "bg-slate-800/80 text-slate-200"
            : "bg-emerald-600/20 text-emerald-50 ring-1 ring-inset ring-emerald-500/20"
        }`}
      >
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {message.body}
        </div>
        <div
          className={`mt-1 flex items-center gap-2 text-[10px] ${
            inbound ? "text-slate-500" : "text-emerald-300/60"
          }`}
        >
          <span title={formatDateTime(message.sentAt)}>{relativeTime(message.sentAt)}</span>
          <span>·</span>
          <span>{titleCase(message.channel)}</span>
          {message.intent && (
            <>
              <span>·</span>
              <span>{titleCase(message.intent)}</span>
            </>
          )}
          {!inbound && message.aiGenerated && (
            <span className="ml-1 rounded bg-emerald-500/15 px-1 py-px font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              AI
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
