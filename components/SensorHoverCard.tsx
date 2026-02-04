"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getLatestReading,
  type LatestReadingResponse,
} from "@/lib/sensors-api";
import type { Sensor } from "@/lib/types";

/** Time period suffixes in measurement keys (e.g. pm2_5_ug_per_m3_10min) */
const TIME_PERIOD_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /_10min|_10m|_10_min$/i, label: "10 min" },
  { pattern: /_30min|_30m|_30_min$/i, label: "30 min" },
  { pattern: /_1h|_1hour|_60min|_60m$/i, label: "1 hour" },
  { pattern: /_6h|_6hour|_360min$/i, label: "6 hours" },
  { pattern: /_24h|_24hour|_1d|_1440min$/i, label: "24 hours" },
];

function parseTimePeriod(key: string): {
  baseKey: string;
  periodLabel: string;
} {
  for (const { pattern, label } of TIME_PERIOD_PATTERNS) {
    if (pattern.test(key)) {
      const baseKey = key.replace(pattern, "");
      return { baseKey, periodLabel: label };
    }
  }
  return { baseKey: key, periodLabel: "Current" };
}

/** Format measurement key for display (e.g. pm2_5_ug_per_m3 → PM2.5). Strips time suffix for lookup. */
function formatMeasurementKey(key: string): string {
  const { baseKey } = parseTimePeriod(key);
  const known: Record<string, string> = {
    pm2_5_ug_per_m3: "PM2.5",
    pm10_ug_per_m3: "PM10",
    air_temperature_c: "Temp",
    relative_humidity_percent: "Humidity",
    wind_speed_mps: "Wind",
    wind_direction_deg: "Wind dir",
    aqi: "AQI",
    wave_height_m: "Wave height",
    water_temperature_c: "Water temp",
    dissolved_oxygen_mg_per_l: "Dissolved O₂",
    turbidity_ntu: "Turbidity",
  };
  return known[baseKey] ?? baseKey.replace(/_/g, " ");
}

/** Group measurements by time period when suffixes are present */
function groupMeasurementsByPeriod(
  measurements: Record<string, unknown>,
): Map<string, { key: string; value: unknown }[]> {
  const byPeriod = new Map<string, { key: string; value: unknown }[]>();
  for (const [key, value] of Object.entries(measurements)) {
    const { periodLabel } = parseTimePeriod(key);
    const entry = { key, value };
    const list = byPeriod.get(periodLabel) ?? [];
    list.push(entry);
    byPeriod.set(periodLabel, list);
  }
  return byPeriod;
}

/** Sort period labels: Current first, then 10 min, 30 min, 1 hour, 6 hours, 24 hours */
function sortPeriodLabels(labels: string[]): string[] {
  const orderMap: Record<string, number> = {
    Current: 0,
    "10 min": 1,
    "30 min": 2,
    "1 hour": 3,
    "6 hours": 4,
    "24 hours": 5,
  };
  return [...labels].sort((a, b) => (orderMap[a] ?? 99) - (orderMap[b] ?? 99));
}

/** Format measurement value for display */
function formatMeasurementValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

function formatLocation(sensor: Sensor): string {
  if (sensor.latitude == null || sensor.longitude == null) return "—";
  const lat = sensor.latitude.toFixed(2);
  const lon = sensor.longitude.toFixed(2);
  const latDir = sensor.latitude >= 0 ? "N" : "S";
  const lonDir = sensor.longitude >= 0 ? "E" : "W";
  return `${Math.abs(parseFloat(lat))}°${latDir}, ${Math.abs(parseFloat(lon))}°${lonDir}`;
}

function formatTimestamp(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "1d ago";
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  } catch {
    return timestamp;
  }
}

export interface SensorHoverCardProps {
  sensor: Sensor;
  /** When true, fetches latest reading from API. Only set when sensor is clicked. */
  shouldFetchReading?: boolean;
}

export default function SensorHoverCard({
  sensor,
  shouldFetchReading = false,
}: SensorHoverCardProps) {
  const [lastReadingTimestamp, setLastReadingTimestamp] = useState<
    string | null
  >(sensor.last_reading_at ?? null);
  const [reading, setReading] = useState<LatestReadingResponse | null>(null);
  const [loadingReading, setLoadingReading] = useState(false);
  const [notAvailable, setNotAvailable] = useState(false);

  useEffect(() => {
    const sensorId = sensor.id;
    setLastReadingTimestamp(sensor.last_reading_at ?? null);
    setReading(null);
    setNotAvailable(false);
    if (!shouldFetchReading) {
      setLoadingReading(false);
      return;
    }
    setLoadingReading(true);
    let ignored = false;
    getLatestReading(sensorId)
      .then((res) => {
        if (ignored) return;
        if (res?.reading?.timestamp) {
          setLastReadingTimestamp(res.reading.timestamp);
          setReading(res);
          setNotAvailable(false);
        } else {
          setNotAvailable(true);
        }
      })
      .catch(() => {
        if (ignored) return;
        setNotAvailable(true);
      })
      .finally(() => {
        if (!ignored) setLoadingReading(false);
      });
    return () => {
      ignored = true;
    };
  }, [sensor.id, sensor.last_reading_at, shouldFetchReading]);

  const measurements = reading?.reading?.measurements;
  const hasMeasurements =
    measurements &&
    typeof measurements === "object" &&
    Object.keys(measurements).length > 0;
  const measurementsByPeriod = useMemo(
    () =>
      hasMeasurements && measurements
        ? groupMeasurementsByPeriod(measurements)
        : null,
    [measurements, hasMeasurements],
  );

  const lastReadingDisplay = loadingReading ? (
    <span className="inline-flex items-center gap-1.5">
      {lastReadingTimestamp ? (
        <>
          <span>{formatTimestamp(lastReadingTimestamp)}</span>
          <span
            className="size-2 animate-pulse rounded-full bg-amber-400"
            aria-hidden
          />
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-foreground/60 dark:text-white/60">
          <span className="size-2 animate-pulse rounded-full bg-current" />
          Loading…
        </span>
      )}
    </span>
  ) : notAvailable ? (
    <span className="inline-flex rounded-md bg-black/15 px-2 py-0.5 text-xs font-medium text-foreground/70 dark:bg-white/15 dark:text-white/70">
      Not available
    </span>
  ) : lastReadingTimestamp ? (
    formatTimestamp(lastReadingTimestamp)
  ) : (
    "—"
  );

  return (
    <div className="flex min-w-64 max-w-80 flex-col rounded-xl border border-black/10 bg-white/95 p-5 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#1a1a1a]/95">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/50 dark:text-white/50">
        Sensor details
      </h3>
      <div className="mt-4 grid flex-1 grid-cols-1 gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-foreground/40 dark:text-white/40">
            Name
          </div>
          <div className="mt-1 truncate text-base font-semibold text-foreground/95 dark:text-white/95">
            {sensor.name}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-foreground/40 dark:text-white/40">
            Location
          </div>
          <div className="mt-1 truncate text-sm font-medium text-emerald-400">
            {formatLocation(sensor)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-foreground/40 dark:text-white/40">
            Reading
          </div>
          {loadingReading && shouldFetchReading ? (
            <div className="mt-2 space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-5 animate-pulse rounded bg-black/10 dark:bg-white/10"
                  aria-hidden
                />
              ))}
            </div>
          ) : hasMeasurements && measurementsByPeriod ? (
            <div className="mt-2 space-y-3">
              {sortPeriodLabels(Array.from(measurementsByPeriod.keys())).map(
                (periodLabel) => {
                  const entries = measurementsByPeriod.get(periodLabel) ?? [];
                  return (
                    <div
                      key={periodLabel}
                      className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
                    >
                      <div className="border-b border-black/10 bg-black/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/50 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                        {periodLabel}
                      </div>
                      <table className="w-full text-left text-xs">
                        <tbody>
                          {entries.map(({ key, value }) => (
                            <tr
                              key={key}
                              className="border-b border-black/5 last:border-b-0 dark:border-white/5"
                            >
                              <td className="py-1.5 pl-3 pr-2 font-medium text-foreground/60 dark:text-white/60">
                                {formatMeasurementKey(key)}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-semibold text-foreground/95 dark:text-white/95">
                                {formatMeasurementValue(value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                },
              )}
            </div>
          ) : notAvailable ? (
            <div className="mt-2 text-xs text-foreground/50 dark:text-white/50">
              Not available
            </div>
          ) : (
            <div className="mt-2 text-xs text-foreground/50 dark:text-white/50">
              —
            </div>
          )}
        </div>
        {(sensor.provider_name ||
          sensor.feed_name ||
          sensor.connected_service) && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-foreground/40 dark:text-white/40">
              Data source
            </div>
            <div className="mt-1 truncate text-sm text-foreground/70 dark:text-white/70">
              {[
                sensor.provider_name,
                sensor.feed_name,
                sensor.connected_service,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/10">
        <span className="text-xs text-foreground/50 dark:text-white/50">
          Last reading
        </span>
        <span className="text-xs font-semibold text-foreground/95 dark:text-white/95">
          {lastReadingDisplay}
        </span>
      </div>
    </div>
  );
}
