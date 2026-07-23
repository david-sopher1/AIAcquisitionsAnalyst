import type {
  KpisResponse,
  LeadsResponse,
  LeadDetailResponse,
  MessagesResponse,
  PipelineResponse,
  NotificationsResponse,
  SourcesResponse,
  MarketsResponse,
  OkResponse,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, params?: QueryParams): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
  }
  const query = qs.toString();
  return `/api/proxy/${path}${query ? `?${query}` : ""}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  return request<T>(buildUrl(path, params), { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(buildUrl(path), {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---- Typed endpoint helpers -------------------------------------------------

export function fetchKpis(days = 30): Promise<KpisResponse> {
  return apiGet<KpisResponse>("kpis", { days });
}

export interface LeadFilters {
  status?: string;
  temperature?: string;
  market?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function fetchLeads(filters: LeadFilters = {}): Promise<LeadsResponse> {
  return apiGet<LeadsResponse>("leads", {
    status: filters.status,
    temperature: filters.temperature,
    market: filters.market,
    q: filters.q,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 50,
  });
}

export function fetchLead(id: string): Promise<LeadDetailResponse> {
  return apiGet<LeadDetailResponse>(`leads/${encodeURIComponent(id)}`);
}

export function fetchMessages(conversationId: string): Promise<MessagesResponse> {
  return apiGet<MessagesResponse>(
    `conversations/${encodeURIComponent(conversationId)}/messages`
  );
}

export function sendMessage(conversationId: string, body: string): Promise<OkResponse> {
  return apiPost<OkResponse>(
    `conversations/${encodeURIComponent(conversationId)}/messages`,
    { body }
  );
}

export function setTakeover(leadId: string, on: boolean): Promise<OkResponse> {
  return apiPost<OkResponse>(`leads/${encodeURIComponent(leadId)}/takeover`, { on });
}

export function fetchPipeline(): Promise<PipelineResponse> {
  return apiGet<PipelineResponse>("pipeline");
}

export function fetchNotifications(unreadOnly = false): Promise<NotificationsResponse> {
  return apiGet<NotificationsResponse>(
    "notifications",
    unreadOnly ? { unread: 1 } : undefined
  );
}

export function markNotificationRead(id: string): Promise<OkResponse> {
  return apiPost<OkResponse>(`notifications/${encodeURIComponent(id)}/read`);
}

export function fetchSourcePerformance(): Promise<SourcesResponse> {
  return apiGet<SourcesResponse>("sources/performance");
}

export function fetchMarkets(): Promise<MarketsResponse> {
  return apiGet<MarketsResponse>("markets");
}
