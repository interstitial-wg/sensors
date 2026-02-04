/**
 * Proxy for GET /api/v1/sensors/:id/readings/latest.
 * Returns 200 + null when the upstream API returns 404 (avoids client console spam).
 */

import { NextResponse } from "next/server";

const API_BASE =
  process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_SENSORS_API_KEY?.trim();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing sensor id" }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json(
      { error: "SENSORS_API_KEY not configured" },
      { status: 500 },
    );
  }

  const url = `${API_BASE}/api/v1/sensors/${encodeURIComponent(id)}/readings/latest`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": API_KEY },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 404) {
      return NextResponse.json(null);
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: text || `Upstream error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(null);
    }
    throw err;
  }
}
