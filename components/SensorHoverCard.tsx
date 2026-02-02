"use client";

import { useEffect, useState } from "react";
import {
  getLatestReading,
  type LatestReadingResponse,
} from "@/lib/sensors-api";
import type { Sensor } from "@/lib/types";

/** Format measurement key for display (e.g. pm2_5_ug_per_m3 → PM2.5) */
function formatMeasurementKey(key: string): string {
  const known: Record<string, string> = {
    pm2_5_ug_per_m3: "PM2.5",
    pm10_ug_per_m3: "PM10",
    air_temperature_c: "Temp",
    relative_humidity_percent: "Humidity",
    wind_speed_mps: "Wind",
    wind_direction_deg: "Wind dir",
    aqi: "AQI",
  };
  return known[key] ?? key.replace(/_/g, " ");
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

  const lastReadingDisplay = loadingReading ? (
    <span className="inline-flex items-center gap-1.5">
      {lastReadingTimestamp ? (
        <>
          <span>{formatTimestamp(lastReadingTimestamp)}</span>
          <span
            className="size-2 animate-pulse rounded-full bg-amber-500"
            aria-hidden
          />
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
          <span className="size-2 animate-pulse rounded-full bg-current" />
          Loading…
        </span>
      )}
    </span>
  ) : notAvailable ? (
    <span className="inline-flex rounded-full bg-zinc-200/80 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-700/80 dark:text-zinc-400">
      Not available
    </span>
  ) : lastReadingTimestamp ? (
    formatTimestamp(lastReadingTimestamp)
  ) : (
    "—"
  );

  return (
    <div className="flex min-w-48 max-w-56 flex-col rounded-lg border border-zinc-200/80 bg-white/95 p-4 shadow-lg backdrop-blur-sm dark:border-zinc-700/60 dark:bg-zinc-900/95">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Sensor details
      </h3>
      <div className="mt-3 grid flex-1 grid-cols-1 gap-3">
        <div>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Name
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {sensor.name}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Location
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {formatLocation(sensor)}
          </div>
        </div>
        {hasMeasurements && (
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Reading
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {Object.entries(measurements).map(([key, value]) => (
                <span
                  key={key}
                  className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {formatMeasurementKey(key)}: {formatMeasurementValue(value)}
                </span>
              ))}
            </div>
          </div>
        )}
        {(sensor.provider_name ||
          sensor.feed_name ||
          sensor.connected_service) && (
          <div>
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Data source
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">
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
      <div className="mt-3 flex items-center justify-between border-t border-zinc-200/60 pt-3 dark:border-zinc-700/50">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Last reading
        </span>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {lastReadingDisplay}
        </span>
      </div>
    </div>
  );
}
