/**
 * Build assistant reply with sensor list and average from readings.
 */

import { getLatestReading } from "./sensors-api";
import type { Sensor } from "./types";
import { parseQuery } from "./query-parser";

/** Measurement keys we can average, grouped by data type */
const MEASUREMENT_BY_DATA_TYPE: Record<string, string[]> = {
  temperature: ["air_temperature_c", "water_temperature_c"],
  aqi: ["aqi"],
  humidity: ["relative_humidity_percent"],
  wind: ["wind_speed_mps"],
  wave_height: ["wave_height_m"],
  water_quality: ["dissolved_oxygen_mg_per_l", "turbidity_ntu"],
};

/** Human-readable labels for measurements */
const MEASUREMENT_LABELS: Record<string, string> = {
  air_temperature_c: "temperature",
  water_temperature_c: "water temperature",
  aqi: "AQI",
  relative_humidity_percent: "humidity",
  wind_speed_mps: "wind speed",
  wave_height_m: "wave height",
  dissolved_oxygen_mg_per_l: "dissolved oxygen",
  turbidity_ntu: "turbidity",
};

function extractNumericValue(
  measurements: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const v = measurements[key];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

/** Map sensor_type to data type labels for "available" suggestion */
const SENSOR_TYPE_TO_DATA_TYPES: Record<string, string[]> = {
  weather_station: ["temperature", "humidity", "wind"],
  buoy: ["temperature", "wind", "wave height"],
  river_sensor: ["temperature", "water quality"],
  air_quality_monitor: ["AQI"],
};

/**
 * Build assistant reply: fetch readings for sensors, compute average, return formatted reply.
 * When requestedTypeNotAvailable is true, propose what IS available from nearby sensors.
 */
export async function buildAssistantReply(
  sensors: Sensor[],
  userQuery: string,
  error: string | null,
  options?: {
    requestedTypeNotAvailable?: boolean;
    requestedDataTypes?: Set<string>;
  },
): Promise<string> {
  if (error) {
    return `Sorry, something went wrong: ${error}`;
  }
  const count = sensors.length;
  if (count === 0) {
    return `No sensors found${userQuery ? ` for "${userQuery}"` : ""}. Try a different location or filter.`;
  }

  const requestedTypeNotAvailable = options?.requestedTypeNotAvailable ?? false;
  const requestedDataTypes = options?.requestedDataTypes;
  if (requestedTypeNotAvailable && requestedDataTypes && requestedDataTypes.size > 0) {
    const requestedLabels = [...requestedDataTypes]
      .map((id) => {
        const f = { aqi: "AQI", temperature: "temperature", humidity: "humidity", wind: "wind", wave_height: "wave height", water_quality: "water quality" }[id];
        return f ?? id;
      })
      .join(", ");
    const sensorTypes = new Set(sensors.map((s) => s.sensor_type));
    const available: string[] = [];
    for (const st of sensorTypes) {
      const types = SENSOR_TYPE_TO_DATA_TYPES[st];
      if (types) available.push(...types);
    }
    const uniqueAvailable = [...new Set(available)];
    const availableStr = uniqueAvailable.length > 0 ? uniqueAvailable.join(", ") : "various measurements";
    const lines: string[] = [
      `No ${requestedLabels} sensors in this area.`,
      `Nearby sensors (${count} found) measure: ${availableStr}.`,
      "",
      ...sensors.slice(0, 5).map((s) => `• ${s.name} — ${s.sensor_type.replace(/_/g, " ")}`),
    ];
    if (count > 5) lines.push(`… and ${count - 5} more on the map`);
    return lines.join("\n");
  }

  const parsed = parseQuery(userQuery);
  let dataTypeIds = parsed.dataTypeIds;
  if (dataTypeIds.size === 0) {
    const sensorTypes = new Set(sensors.map((s) => s.sensor_type));
    const inferred = new Set<string>();
    if (sensorTypes.has("weather_station"))
      ["temperature", "humidity", "wind"].forEach((id) => inferred.add(id));
    if (sensorTypes.has("air_quality_monitor")) inferred.add("aqi");
    if (sensorTypes.has("buoy"))
      ["temperature", "wind", "wave_height"].forEach((id) => inferred.add(id));
    if (sensorTypes.has("river_sensor"))
      ["temperature", "water_quality"].forEach((id) => inferred.add(id));
    dataTypeIds =
      inferred.size > 0
        ? inferred
        : new Set(["temperature", "aqi", "humidity", "wind"]);
  }
  const measurementKeys: string[] = [];
  for (const id of dataTypeIds) {
    const keys = MEASUREMENT_BY_DATA_TYPE[id];
    if (keys) measurementKeys.push(...keys);
  }
  const uniqueKeys = [...new Set(measurementKeys)];

  const topSensors = sensors.slice(0, 10);
  const readings = await Promise.all(
    topSensors.map((s) => getLatestReading(s.id)),
  );

  const valuesByKey: Record<
    string,
    { sum: number; count: number; sensorNames: string[] }
  > = {};
  for (const key of uniqueKeys) {
    valuesByKey[key] = { sum: 0, count: 0, sensorNames: [] };
  }

  for (let i = 0; i < topSensors.length; i++) {
    const sensor = topSensors[i];
    const reading = readings[i];
    if (!reading?.reading?.measurements) continue;
    const m = reading.reading.measurements as Record<string, unknown>;
    for (const key of uniqueKeys) {
      const val = extractNumericValue(m, [key]);
      if (val != null) {
        valuesByKey[key].sum += val;
        valuesByKey[key].count += 1;
        valuesByKey[key].sensorNames.push(sensor.name);
      }
    }
  }

  const averages: {
    label: string;
    value: number;
    unit: string;
    sensorNames: string[];
  }[] = [];
  const unitByKey: Record<string, string> = {
    air_temperature_c: "°C",
    water_temperature_c: "°C",
    aqi: "",
    relative_humidity_percent: "%",
    wind_speed_mps: " m/s",
    wave_height_m: " m",
    dissolved_oxygen_mg_per_l: " mg/L",
    turbidity_ntu: " NTU",
  };
  for (const key of uniqueKeys) {
    const { sum, count, sensorNames } = valuesByKey[key];
    if (count > 0) {
      const avg = sum / count;
      const label = MEASUREMENT_LABELS[key] ?? key;
      const unit = unitByKey[key] ?? "";
      averages.push({ label, value: avg, unit, sensorNames });
    }
  }

  const lines: string[] = [];
  lines.push(
    `Found ${count} sensor${count === 1 ? "" : "s"}${userQuery ? ` for "${userQuery}"` : ""}.`,
  );
  lines.push("");

  if (averages.length > 0) {
    for (const { label, value, unit, sensorNames } of averages) {
      const formatted = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1);
      const uniqueNames = [...new Set(sensorNames)];
      lines.push(
        `Based on ${uniqueNames.slice(0, 5).join(", ")}${uniqueNames.length > 5 ? ` and ${uniqueNames.length - 5} more` : ""}, the average ${label} appears to be ${formatted}${unit}.`,
      );
    }
    lines.push("");
  }

  const toList = sensors.slice(0, 5);
  lines.push(
    ...toList.map((s) => `• ${s.name} — ${s.sensor_type.replace(/_/g, " ")}`),
  );
  if (count > 5) {
    lines.push(`… and ${count - 5} more on the map`);
  }

  return lines.join("\n");
}
