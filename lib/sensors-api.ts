/**
 * Sensors API client.
 * API spec: demo-atlas apps/api — base path /api/v1/sensors, auth via x-api-key.
 * Routes: GET / (list), GET /types, GET /statuses, GET /registry, GET /:id,
 * GET /:id/readings/latest, POST /:id/mcp, POST /registry/mcp.
 * List params: search, sensor_type, status, provider, page (default 1), limit (default 20).
 */
import type { Sensor, SensorsListResponse } from "./types";

/** Coerce API lat/long to number | null (PostGIS/node-pg can return strings). */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isNaN(n) ? null : n;
}

function normalizeSensor(s: Record<string, unknown>): Sensor {
  const lat =
    toNum(s.latitude) ??
    toNum(s.lat) ??
    toNum(
      (s as { geometry?: { coordinates?: unknown[] } }).geometry
        ?.coordinates?.[1],
    );
  const lon =
    toNum(s.longitude) ??
    toNum(s.lon) ??
    toNum(s.lng) ??
    toNum(
      (s as { geometry?: { coordinates?: unknown[] } }).geometry
        ?.coordinates?.[0],
    );
  return {
    ...s,
    latitude: lat,
    longitude: lon,
  } as Sensor;
}

const API_BASE =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001"
    : "http://localhost:3001";

/** API key from .env (NEXT_PUBLIC_SENSORS_API_KEY). Required when calling the Sensors API. */
const getApiKey = (): string => {
  const key =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_SENSORS_API_KEY
      : undefined;
  if (!key?.trim()) {
    throw new Error(
      "NEXT_PUBLIC_SENSORS_API_KEY is not set. Add it to your .env when using the sensors API.",
    );
  }
  return key.trim();
};

/** Map viewport bbox: only sensors inside this box are returned. */
export interface BboxParams {
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}

/** Center + radius: only sensors within radius_km of (lat, lon). radius_km default 50, max 1000. */
export interface CenterRadiusParams {
  lat: number;
  lon: number;
  radius_km?: number;
}

export interface GetSensorsOptions {
  sensor_type?: string;
  status?: string;
  provider?: string;
  search?: string;
  page?: number;
  limit?: number;
  /** Bounding box (map viewport). If set, center+radius is ignored. */
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  /** Center + radius (sensors near point). Ignored if bbox params are set. */
  lat?: number;
  lon?: number;
  radius_km?: number;
}

/** Fetch sensors list. Calls GET /api/v1/sensors. */
export async function getSensors(
  options: GetSensorsOptions = {},
): Promise<SensorsListResponse> {
  return fetchApiSensors(options);
}

async function fetchApiSensors(
  options: GetSensorsOptions,
): Promise<SensorsListResponse> {
  const params = new URLSearchParams();
  if (options.sensor_type) params.set("sensor_type", options.sensor_type);
  if (options.status) params.set("status", options.status);
  if (options.provider) params.set("provider", options.provider);
  if (options.search) params.set("search", options.search);
  params.set("page", String(options.page ?? 1));
  params.set("limit", String(options.limit ?? 20));

  // Map/region filters: bbox takes precedence over center+radius
  const hasBbox =
    options.min_lat != null &&
    options.min_lon != null &&
    options.max_lat != null &&
    options.max_lon != null;
  if (hasBbox) {
    params.set("min_lat", String(options.min_lat));
    params.set("min_lon", String(options.min_lon));
    params.set("max_lat", String(options.max_lat));
    params.set("max_lon", String(options.max_lon));
  } else if (options.lat != null && options.lon != null) {
    params.set("lat", String(options.lat));
    params.set("lon", String(options.lon));
    if (options.radius_km != null)
      params.set(
        "radius_km",
        String(Math.min(1000, Math.max(0, options.radius_km))),
      );
  }

  const inBrowser = typeof window !== "undefined";
  const url = inBrowser
    ? `/api/sensors?${params.toString()}`
    : `${API_BASE}/api/v1/sensors?${params.toString()}`;

  const res = await fetch(url, {
    headers: inBrowser ? {} : { "x-api-key": getApiKey() },
    cache: "no-store",
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Sensors API error: ${res.status}`);
  }

  let data: SensorsListResponse;
  try {
    data = JSON.parse(responseText) as SensorsListResponse;
  } catch (e) {
    throw e;
  }

  const raw = data.sensors as unknown as Record<string, unknown>[];
  const sensors = raw.map(normalizeSensor);
  return { ...data, sensors };
}

/**
 * Fetch a single sensor by ID. GET /api/v1/sensors/:id.
 * Returns null when not found (404).
 */
export async function getSensor(id: string): Promise<Sensor | null> {
  const inBrowser = typeof window !== "undefined";
  const url = inBrowser
    ? `/api/sensors/${encodeURIComponent(id)}`
    : `${API_BASE}/api/v1/sensors/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: inBrowser ? {} : { "x-api-key": getApiKey() },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sensors API error: ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeSensor(raw);
}

/**
 * Latest reading from GET /api/v1/sensors/:id/readings/latest.
 * Returns null when sensor has no feed or no readings (404).
 */
export interface LatestReadingResponse {
  sensor_id: string;
  external_id: string;
  name: string;
  reading: {
    id: string;
    timestamp: string;
    measurements: Record<string, unknown>;
    location?: unknown;
  };
}

/** Cache for sensors with no readings (404) to avoid repeated fetches and console noise. */
const noReadingCache = new Set<string>();
const MAX_NO_READING_CACHE = 500;

/**
 * Fetch the latest reading for a sensor.
 * In the browser, uses our proxy (/api/sensors/:id/readings/latest) to avoid 404 console spam
 * when the upstream API does not support readings. Returns null when no reading is available.
 */
export async function getLatestReading(
  sensorId: string,
): Promise<LatestReadingResponse | null> {
  if (noReadingCache.has(sensorId)) {
    return null;
  }

  const inBrowser = typeof window !== "undefined";
  const url = inBrowser
    ? `/api/sensors/${encodeURIComponent(sensorId)}/readings/latest`
    : `${API_BASE}/api/v1/sensors/${encodeURIComponent(sensorId)}/readings/latest`;

  const res = await fetch(url, {
    headers: inBrowser ? {} : { "x-api-key": getApiKey() },
    cache: "no-store",
  });

  if (res.status === 404) {
    if (noReadingCache.size >= MAX_NO_READING_CACHE) {
      noReadingCache.clear();
    }
    noReadingCache.add(sensorId);
    return null;
  }
  if (!res.ok) throw new Error(`Sensors API error: ${res.status}`);

  const data = await res.json();
  if (data == null) {
    if (noReadingCache.size >= MAX_NO_READING_CACHE) {
      noReadingCache.clear();
    }
    noReadingCache.add(sensorId);
    return null;
  }
  return data as LatestReadingResponse;
}

/** Fetch distinct sensor types. GET /api/v1/sensors/types. */
export async function getSensorTypes(): Promise<string[]> {
  const inBrowser = typeof window !== "undefined";
  const url = inBrowser
    ? "/api/sensors/types"
    : `${API_BASE}/api/v1/sensors/types`;
  const res = await fetch(url, {
    headers: inBrowser ? {} : { "x-api-key": getApiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Sensors types API error: ${res.status}`);
  }
  const data = (await res.json()) as string[];
  return data;
}

/**
 * Filter sensors that have valid lat/lng and lie within the given bounds.
 * Handles bounds that cross the International Date Line (west > east or span > 180°).
 */
export function filterSensorsByBounds(
  sensors: Sensor[],
  bounds: { west: number; south: number; east: number; north: number },
): Sensor[] {
  const crossesDateline =
    bounds.west > bounds.east || bounds.east - bounds.west > 180;
  return sensors.filter((s) => {
    if (s.latitude == null || s.longitude == null) return false;
    if (s.latitude < bounds.south || s.latitude > bounds.north) return false;
    if (crossesDateline) {
      return (
        (s.longitude >= bounds.west && s.longitude <= 180) ||
        (s.longitude >= -180 && s.longitude <= bounds.east)
      );
    }
    return s.longitude >= bounds.west && s.longitude <= bounds.east;
  });
}
