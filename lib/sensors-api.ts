/**
 * Sensors API client.
 * API spec: demo-atlas apps/api — base path /api/v1/sensors, auth via x-api-key.
 * Routes: GET / (list), GET /types, GET /statuses, GET /registry, GET /:id,
 * GET /:id/readings/latest, POST /:id/mcp, POST /registry/mcp.
 * List params: search, sensor_type, status, provider, page (default 1), limit (default 20).
 */
import type { Sensor, SensorsListResponse } from "./types";
import {
  PLACEHOLDER_SENSORS,
  PLACEHOLDER_SENSOR_TYPES,
} from "./placeholder-sensors";

/** Coerce API lat/long to number | null (PostGIS/node-pg can return strings). */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isNaN(n) ? null : n;
}

function normalizeSensor(s: Record<string, unknown>): Sensor {
  return {
    ...s,
    latitude: toNum(s.latitude),
    longitude: toNum(s.longitude),
  } as Sensor;
}

const USE_PLACEHOLDER =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_USE_PLACEHOLDER_SENSORS === "true" ||
    !process.env.NEXT_PUBLIC_SENSORS_API_URL);

const API_BASE =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001"
    : "http://localhost:3001";

/** API key from .env (NEXT_PUBLIC_SENSORS_API_KEY). Required when calling the real API. */
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

/**
 * Fetch sensors list. Uses placeholder data when NEXT_PUBLIC_USE_PLACEHOLDER_SENSORS=true
 * or NEXT_PUBLIC_SENSORS_API_URL is unset; otherwise calls GET /api/v1/sensors.
 */
export async function getSensors(
  options: GetSensorsOptions = {},
): Promise<SensorsListResponse> {
  if (USE_PLACEHOLDER) {
    return getPlaceholderSensors(options);
  }
  return fetchApiSensors(options);
}

function getPlaceholderSensors(
  options: GetSensorsOptions,
): Promise<SensorsListResponse> {
  const { sensor_type, status, search, page = 1, limit = 100 } = options;
  let list = [...PLACEHOLDER_SENSORS];

  if (sensor_type) {
    list = list.filter((s) => s.sensor_type === sensor_type);
  }
  if (status) {
    list = list.filter((s) => s.status === status);
  }
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false) ||
        s.sensor_type.toLowerCase().includes(q) ||
        s.provider_name?.toLowerCase().includes(q) ||
        s.feed_name?.toLowerCase().includes(q),
    );
  }

  const total = list.length;
  const start = (page - 1) * limit;
  const sensors = list.slice(start, start + limit);

  return Promise.resolve({
    sensors,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 1,
    },
  });
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

  const url = `${API_BASE}/api/v1/sensors?${params.toString()}`;
  const apiKey = getApiKey();

  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
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

/** Mock measurements by sensor type for placeholder mode */
function mockReadingForSensor(sensor: Sensor): LatestReadingResponse {
  const base = {
    sensor_id: sensor.id,
    external_id: sensor.external_id,
    name: sensor.name,
    reading: {
      id: `reading-${sensor.id}`,
      timestamp: sensor.last_reading_at ?? new Date().toISOString(),
      measurements: {} as Record<string, unknown>,
    },
  };
  switch (sensor.sensor_type) {
    case "buoy":
      base.reading.measurements = {
        wave_height_m: 1.2 + Math.random() * 2,
        water_temperature_c: 15 + Math.random() * 10,
        wind_speed_mps: 3 + Math.random() * 8,
      };
      break;
    case "river_sensor":
      base.reading.measurements = {
        water_temperature_c: 12 + Math.random() * 15,
        dissolved_oxygen_mg_per_l: 7 + Math.random() * 4,
        turbidity_ntu: 2 + Math.random() * 20,
      };
      break;
    case "weather_station":
      base.reading.measurements = {
        air_temperature_c: 15 + Math.random() * 20,
        relative_humidity_percent: 40 + Math.random() * 50,
        wind_speed_mps: 1 + Math.random() * 5,
      };
      break;
    case "air_quality_monitor":
      base.reading.measurements = {
        pm2_5_ug_per_m3: 5 + Math.random() * 40,
        pm10_ug_per_m3: 10 + Math.random() * 60,
        aqi: 25 + Math.floor(Math.random() * 100),
      };
      break;
    default:
      base.reading.measurements = { value: 1 + Math.random() * 10 };
  }
  return base;
}

/**
 * Fetch the latest reading for a sensor.
 * GET /api/v1/sensors/:id/readings/latest.
 * Returns null when using placeholder data or when the API returns 404.
 * In placeholder mode, returns mock reading data.
 */
export async function getLatestReading(
  sensorId: string,
): Promise<LatestReadingResponse | null> {
  if (USE_PLACEHOLDER) {
    const sensor = PLACEHOLDER_SENSORS.find((s) => s.id === sensorId);
    return sensor ? mockReadingForSensor(sensor) : null;
  }
  if (noReadingCache.has(sensorId)) {
    return null;
  }
  const url = `${API_BASE}/api/v1/sensors/${encodeURIComponent(sensorId)}/readings/latest`;
  const res = await fetch(url, {
    headers: { "x-api-key": getApiKey() },
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
  return res.json() as Promise<LatestReadingResponse>;
}

/**
 * Fetch distinct sensor types. Uses placeholder list when using placeholder data;
 * otherwise GET /api/v1/sensors/types.
 */
export async function getSensorTypes(): Promise<string[]> {
  if (USE_PLACEHOLDER) {
    return Promise.resolve([...PLACEHOLDER_SENSOR_TYPES]);
  }
  const url = `${API_BASE}/api/v1/sensors/types`;
  const res = await fetch(url, {
    headers: { "x-api-key": getApiKey() },
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
