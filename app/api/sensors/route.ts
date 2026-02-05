/**
 * Proxy for GET /api/v1/sensors (list).
 * Proxies from browser to avoid CORS when fetching external Sensors API.
 */

import { NextResponse } from "next/server";

const API_BASE =
  process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_SENSORS_API_KEY?.trim();

export async function GET(request: Request) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_SENSORS_API_KEY not configured" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.toString();
  const url = `${API_BASE}/api/v1/sensors${query ? `?${query}` : ""}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": API_KEY },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: text || `Upstream error: ${res.status}` },
        { status: res.status },
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from upstream" },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    throw err;
  }
}
