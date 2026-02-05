/**
 * LLM-based query parsing. Extracts location and data types from natural language.
 * POST /api/parse-query { "query": "What is the air quality in San Francisco?" }
 * Returns { location?: string, dataTypeIds: string[] }
 *
 * Requires ANTHROPIC_API_KEY in .env. Falls back to keyword parsing if not set.
 */

import { NextResponse } from "next/server";
import { parseQuery } from "@/lib/query-parser";
import { DATA_TYPE_IDS } from "@/lib/data-filters";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();

const DATA_TYPE_OPTIONS = [
  "aqi",
  "temperature",
  "humidity",
  "wind",
  "wave_height",
  "water_quality",
];

const SYSTEM_PROMPT = `You extract structured data from sensor search queries. Reply with JSON only, no other text:
{
  "location": "place name to geocode, or null if no location",
  "dataTypeIds": ["aqi", "temperature", ...]
}
Location rules: Correct misspellings to the intended place (e.g. San Franicsco→San Francisco, Los Angelas→Los Angeles). Return the properly spelled name for geocoding. Include state/country when obvious (e.g. "San Francisco, CA").
Valid dataTypeIds: ${DATA_TYPE_OPTIONS.join(", ")}. Use only these. Infer from query:
- aqi: air quality, air pollution, AQI, pm2.5, pm2, PM2.5, particulate, pm10, PurpleAir, AirNow, smoke, wildfire
- temperature: temp, temperature, heat, cold, weather, weather station, farm
- humidity: humidity, relative humidity, RH, moisture, dew point
- wave_height: waves, wave height, swell, sea, surf, buoy, buoys, ocean, marine, NDBC
- wind: wind, wind speed, breeze, gusts, anemometer
- water_quality: water quality, dissolved oxygen, DO, turbidity, river, stream, hydrology, USGS, WQP
Return empty array if no types inferred.`;

function fallbackResponse(query: string) {
  const parsed = parseQuery(query);
  return NextResponse.json({
    location: parsed.location,
    dataTypeIds: [...parsed.dataTypeIds].filter((id) => DATA_TYPE_IDS.has(id)),
  });
}

export async function POST(request: Request) {
  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  if (!ANTHROPIC_API_KEY) {
    return fallbackResponse(query);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: query }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Anthropic error: ${res.status}`);
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const textBlock = data.content?.find((b) => b.type === "text");
    const content = textBlock?.text;
    if (!content) throw new Error("No content in response");

    const parsed = JSON.parse(content) as {
      location?: string | null;
      dataTypeIds?: string[];
    };
    const location =
      parsed.location && typeof parsed.location === "string"
        ? parsed.location.trim() || undefined
        : undefined;
    const dataTypeIds = Array.isArray(parsed.dataTypeIds)
      ? parsed.dataTypeIds.filter(
          (id): id is string => typeof id === "string" && DATA_TYPE_IDS.has(id),
        )
      : [];

    return NextResponse.json({ location, dataTypeIds });
  } catch {
    return fallbackResponse(query);
  }
}
