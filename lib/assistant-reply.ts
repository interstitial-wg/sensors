/**
 * Build assistant reply with sensor list and average from readings.
 */

import { getLatestReading } from "./sensors-api";
import type { LatestReadingResponse } from "./sensors-api";
import type { Sensor } from "./types";
import { parseQuery } from "./query-parser";

/** Timeout per reading fetch so we don't hang on slow/unresponsive APIs */
const READING_FETCH_TIMEOUT_MS = 12_000;

/** Measurement keys we can average, grouped by data type */
const MEASUREMENT_BY_DATA_TYPE: Record<string, string[]> = {
  temperature: ["air_temperature_c", "water_temperature_c"],
  aqi: ["aqi", "pm2_5_ug_per_m3", "pm10_ug_per_m3"],
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
  pm2_5_ug_per_m3: "PM2.5",
  pm10_ug_per_m3: "PM10",
  relative_humidity_percent: "humidity",
  wind_speed_mps: "wind speed",
  wave_height_m: "wave height",
  dissolved_oxygen_mg_per_l: "dissolved oxygen",
  turbidity_ntu: "turbidity",
};

/** F→C conversion for PurpleAir temperature_f */
const FAHRENHEIT_TO_CELSIUS = (f: number) => ((f - 32) * 5) / 9;

/** When API returns °C key but value is in °F range (50–120), convert */
const F_OR_C = (v: number) =>
  v >= 50 && v <= 120 ? FAHRENHEIT_TO_CELSIUS(v) : v;

function extractNumericValue(
  measurements: Record<string, unknown>,
  keys: string[],
  conversions?: Record<string, (v: number) => number>,
): number | null {
  for (const key of keys) {
    const v = measurements[key];
    let n: number | null = null;
    if (typeof v === "number" && !Number.isNaN(v)) n = v;
    else if (typeof v === "string") n = parseFloat(v);
    if (n != null && !Number.isNaN(n)) {
      const conv = conversions?.[key];
      return conv ? conv(n) : n;
    }
  }
  return null;
}

/** Alternate keys APIs may use for the same measurement (e.g. pm25 vs pm2_5_ug_per_m3) */
const MEASUREMENT_KEY_ALIASES: Record<string, string[]> = {
  air_temperature_c: [
    "air_temperature_c",
    "temperature_c",
    "temp_c",
    "temperature_f", // PurpleAir: Fahrenheit → convert
    "temperature", // PurpleAir often uses "temperature" for °F
    "temp_f",
  ],
  relative_humidity_percent: [
    "relative_humidity_percent",
    "humidity",
    "humidity_percent",
    "rh",
  ],
  pm2_5_ug_per_m3: [
    "pm2_5_ug_per_m3",
    "pm25",
    "pm2.5",
    "pm2_5",
    "pm2_5_ug_per_m3_10min",
    "pm2_5_ug_per_m3_1hr",
  ],
  pm10_ug_per_m3: [
    "pm10_ug_per_m3",
    "pm10",
    "pm10_ug_per_m3_10min",
    "pm10_ug_per_m3_1hr",
  ],
};

/** Map sensor_type to data type labels for "available" suggestion */
const SENSOR_TYPE_TO_DATA_TYPES: Record<string, string[]> = {
  weather_station: ["temperature", "humidity", "wind"],
  buoy: ["temperature", "wind", "wave height"],
  river_sensor: ["temperature", "water quality"],
  air_quality_monitor: ["AQI", "PM2.5", "PM10", "temperature", "humidity"],
};

/**
 * Build assistant reply: fetch readings for sensors, compute average, return formatted reply.
 * When requestedTypeNotAvailable is true, propose what IS available from nearby sensors.
 * onPhase: optional callback to report progress ("gathering_data" | "computing").
 */
export async function buildAssistantReply(
  sensors: Sensor[],
  userQuery: string,
  error: string | null,
  options?: {
    requestedTypeNotAvailable?: boolean;
    requestedDataTypes?: Set<string>;
    onPhase?: (phase: "gathering_data" | "computing") => void;
  },
): Promise<string> {
  console.log("[buildAssistantReply] start", {
    sensorCount: sensors.length,
    userQuery,
    hasError: !!error,
  });
  if (error) {
    return `Sorry, something went wrong: ${error}`;
  }
  // Use only sensors with coordinates - matches what the map displays (dots)
  const sensorsWithCoords = sensors.filter(
    (s): s is Sensor & { latitude: number; longitude: number } =>
      s.latitude != null && s.longitude != null,
  );
  const count = sensorsWithCoords.length;
  if (count === 0) {
    console.log("[buildAssistantReply] early return: no sensors");
    return `No sensors found${userQuery ? ` for "${userQuery}"` : ""}. Try a different location or filter.`;
  }

  const requestedTypeNotAvailable = options?.requestedTypeNotAvailable ?? false;
  const requestedDataTypes = options?.requestedDataTypes;
  if (
    requestedTypeNotAvailable &&
    requestedDataTypes &&
    requestedDataTypes.size > 0
  ) {
    const requestedLabels = [...requestedDataTypes]
      .map((id) => {
        const f = {
          aqi: "AQI",
          temperature: "temperature",
          humidity: "humidity",
          wind: "wind",
          wave_height: "wave height",
          water_quality: "water quality",
        }[id];
        return f ?? id;
      })
      .join(", ");
    const sensorTypes = new Set(sensorsWithCoords.map((s) => s.sensor_type));
    const available: string[] = [];
    for (const st of sensorTypes) {
      const types = SENSOR_TYPE_TO_DATA_TYPES[st];
      if (types) available.push(...types);
    }
    const uniqueAvailable = [...new Set(available)];
    const availableStr =
      uniqueAvailable.length > 0
        ? uniqueAvailable.join(", ")
        : "various measurements";
    console.log(
      "[buildAssistantReply] early return: requested type not available, suggesting alternatives",
    );
    const lines: string[] = [
      `No ${requestedLabels} sensors in this area.`,
      `Nearby sensors (${count} found) measure: ${availableStr}.`,
      "",
      ...sensorsWithCoords
        .slice(0, 5)
        .map((s) => `• ${s.name} — ${s.sensor_type.replace(/_/g, " ")}`),
    ];
    if (count > 5) lines.push(`… and ${count - 5} more on the map`);
    return lines.join("\n");
  }

  const parsed = parseQuery(userQuery);
  const requestedFromQuery = new Set(parsed.dataTypeIds);
  let dataTypeIds = parsed.dataTypeIds;
  if (dataTypeIds.size === 0) {
    const sensorTypes = new Set(sensorsWithCoords.map((s) => s.sensor_type));
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

  options?.onPhase?.("gathering_data");
  const sensorsToQuery = sensorsWithCoords;
  console.log(
    "[buildAssistantReply] phase: gathering_data, fetching readings for",
    sensorsToQuery.length,
    "sensors",
  );
  const fetchWithTimeout = (sensorId: string) =>
    Promise.race([
      getLatestReading(sensorId),
      new Promise<LatestReadingResponse | null>((resolve) =>
        setTimeout(() => resolve(null), READING_FETCH_TIMEOUT_MS),
      ),
    ]);
  const readings = await Promise.all(
    sensorsToQuery.map((s) => fetchWithTimeout(s.id)),
  );

  const respondedCount = readings.filter(
    (r) => r?.reading?.measurements != null,
  ).length;
  console.log("[buildAssistantReply] readings fetched", {
    queried: sensorsToQuery.length,
    respondedWithData: respondedCount,
  });

  options?.onPhase?.("computing");

  const unitByKey: Record<string, string> = {
    air_temperature_c: "°C",
    water_temperature_c: "°C",
    aqi: "",
    pm2_5_ug_per_m3: " µg/m³",
    pm10_ug_per_m3: " µg/m³",
    relative_humidity_percent: "%",
    wind_speed_mps: " m/s",
    wave_height_m: " m",
    dissolved_oxygen_mg_per_l: " mg/L",
    turbidity_ntu: " NTU",
  };

  const allMeasurementKeys = [
    "air_temperature_c",
    "water_temperature_c",
    "aqi",
    "pm2_5_ug_per_m3",
    "pm10_ug_per_m3",
    "relative_humidity_percent",
    "wind_speed_mps",
    "wave_height_m",
    "dissolved_oxygen_mg_per_l",
    "turbidity_ntu",
  ];

  const valuesByKey: Record<
    string,
    { sum: number; count: number; sensorNames: string[] }
  > = {};
  for (const key of allMeasurementKeys) {
    valuesByKey[key] = { sum: 0, count: 0, sensorNames: [] };
  }

  for (let i = 0; i < sensorsToQuery.length; i++) {
    const sensor = sensorsToQuery[i];
    const reading = readings[i];
    if (!reading?.reading?.measurements) continue;
    const m = reading.reading.measurements as Record<string, unknown>;
    for (const key of allMeasurementKeys) {
      const keysToTry = MEASUREMENT_KEY_ALIASES[key] ?? [key];
      // PurpleAir uses °F; some APIs mislabel °F as air_temperature_c
      const conversions =
        key === "air_temperature_c"
          ? {
              temperature_f: FAHRENHEIT_TO_CELSIUS,
              temperature: FAHRENHEIT_TO_CELSIUS,
              temp_f: FAHRENHEIT_TO_CELSIUS,
              air_temperature_c: F_OR_C,
              temperature_c: F_OR_C,
              temp_c: F_OR_C,
            }
          : undefined;
      const val = extractNumericValue(m, keysToTry, conversions);
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
    key: string;
    sensorCount: number;
  }[] = [];
  for (const key of uniqueKeys) {
    const { sum, count } = valuesByKey[key];
    if (count > 0) {
      const avg = sum / count;
      const label = MEASUREMENT_LABELS[key] ?? key;
      const unit = unitByKey[key] ?? "";
      averages.push({ label, value: avg, unit, key, sensorCount: count });
    }
  }

  const availableAverages: {
    label: string;
    value: number;
    unit: string;
    sensorCount: number;
  }[] = [];
  for (const key of allMeasurementKeys) {
    const { sum, count } = valuesByKey[key];
    if (count > 0) {
      const avg = sum / count;
      const label = MEASUREMENT_LABELS[key] ?? key;
      const unit = unitByKey[key] ?? "";
      availableAverages.push({ label, value: avg, unit, sensorCount: count });
    }
  }

  const requestedLabels = [...requestedFromQuery]
    .map(
      (id) =>
        ({
          aqi: "air quality (AQI / PM2.5)",
          temperature: "temperature",
          humidity: "humidity",
          wind: "wind",
          wave_height: "wave height",
          water_quality: "water quality",
        })[id] ?? id,
    )
    .filter(Boolean);

  const requestedButNotAvailable =
    requestedFromQuery.size > 0 &&
    averages.length === 0 &&
    availableAverages.length > 0;

  const locationPhrase = parsed.location
    ? ` in ${parsed.location}`
    : " in this area";

  const lines: string[] = [];

  const totalSensorsLine = `We found **${count}** sensors in the area (shown on map).`;
  const respondedLine = `**${respondedCount}** returned readings we could use.`;

  if (requestedButNotAvailable) {
    lines.push(
      `No ${requestedLabels.join(" or ")} sensors${locationPhrase}. The sensors here measure ${availableAverages.map((a) => a.label).join(", ")}.`,
    );
    lines.push("");
    lines.push(totalSensorsLine);
    lines.push(respondedLine);
    for (const { label, value, unit, sensorCount } of availableAverages) {
      const formatted = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1);
      lines.push(
        `**${sensorCount}** had **${label}** data — average: **${formatted}${unit}**`,
      );
    }
  } else if (averages.length > 0) {
    lines.push(totalSensorsLine);
    lines.push(respondedLine);
    for (const { label, value, unit, sensorCount } of averages) {
      const formatted = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1);
      lines.push(
        `**${sensorCount}** had **${label}** data — average: **${formatted}${unit}**`,
      );
    }
  } else if (respondedCount === 0) {
    lines.push(totalSensorsLine);
    lines.push(
      "None returned usable readings. The sensors API may not expose /readings/latest for these sensors.",
    );
  } else {
    lines.push(totalSensorsLine);
    lines.push(respondedLine);
    lines.push("None had data for the requested measurements.");
  }

  const result = lines.join("\n");
  console.log("[buildAssistantReply] done", {
    lineCount: lines.length,
    resultPreview: result.slice(0, 100),
  });
  return result;
}
