import { logger } from "@dealengine/shared";

export class VendorError extends Error {
  constructor(
    public vendor: string,
    public status: number,
    public body: string,
  ) {
    super(`${vendor} HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "VendorError";
  }
}

/** Retryable = network error, 429, 5xx. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof VendorError) return err.status === 429 || err.status >= 500;
  return true; // network-level errors
}

export async function httpJson<T = unknown>(
  vendor: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ vendor, url: url.split("?")[0], status: res.status }, "vendor error");
      throw new VendorError(vendor, res.status, text);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function formEncode(data: Record<string, string | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
}
