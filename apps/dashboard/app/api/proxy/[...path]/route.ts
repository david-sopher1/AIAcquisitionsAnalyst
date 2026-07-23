import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE = process.env.API_INTERNAL_URL || "http://localhost:4000";
const API_KEY = process.env.DASHBOARD_API_KEY || "";

interface RouteContext {
  params: { path: string[] };
}

async function forward(
  req: NextRequest,
  context: RouteContext,
  method: "GET" | "POST"
): Promise<NextResponse> {
  const segments = context.params.path ?? [];
  const path = segments.map((s) => encodeURIComponent(s)).join("/");
  const base = API_BASE.replace(/\/+$/, "");
  const url = new URL(`${base}/api/v1/${path}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const init: RequestInit = {
    method,
    headers: {
      "x-api-key": API_KEY,
      accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
  };

  if (method === "POST") {
    const body = await req.text();
    if (body.length > 0) {
      init.body = body;
    }
  }

  try {
    const upstream = await fetch(url.toString(), init);
    const text = await upstream.text();
    let data: unknown;
    try {
      data = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      data = { error: "Upstream returned a non-JSON response" };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Upstream API is unreachable" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return forward(req, context, "GET");
}

export async function POST(req: NextRequest, context: RouteContext) {
  return forward(req, context, "POST");
}
