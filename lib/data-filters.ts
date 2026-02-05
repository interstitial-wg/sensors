/**
 * Data type filters: users filter by what measurements they care about,
 * not by sensor hardware type. Each data type maps to sensor types that provide it.
 */

export interface DataTypeFilter {
  id: string;
  label: string;
  /** Sensor types that typically provide this measurement */
  sensorTypes: string[];
}

/** Data-centric filters: AQI, temp, humidity, wave height, wind, etc. */
export const DATA_TYPE_FILTERS: DataTypeFilter[] = [
  { id: "aqi", label: "AQI", sensorTypes: ["air_quality_monitor"] },
  {
    id: "temperature",
    label: "Temperature",
    sensorTypes: [
      "weather_station",
      "buoy",
      "river_sensor",
      "air_quality_monitor",
    ],
  },
  {
    id: "humidity",
    label: "Humidity",
    sensorTypes: ["weather_station", "air_quality_monitor"],
  },
  {
    id: "wave_height",
    label: "Wave height",
    sensorTypes: ["buoy"],
  },
  {
    id: "wind",
    label: "Wind",
    sensorTypes: ["buoy", "weather_station"],
  },
  {
    id: "water_quality",
    label: "Water quality",
    sensorTypes: ["river_sensor"],
  },
];

/** All valid data type ids for URL/state */
export const DATA_TYPE_IDS = new Set(DATA_TYPE_FILTERS.map((f) => f.id));

/** Map selected data type ids to sensor types for API fetch (union of all) */
export function dataTypesToSensorTypes(
  selectedDataTypes: Set<string>,
): string[] {
  if (selectedDataTypes.size === 0) return [];
  const sensorTypes = new Set<string>();
  for (const id of selectedDataTypes) {
    const filter = DATA_TYPE_FILTERS.find((f) => f.id === id);
    if (filter) {
      for (const st of filter.sensorTypes) sensorTypes.add(st);
    }
  }
  return [...sensorTypes].sort();
}

/** Check if a sensor type provides any of the selected data types */
export function sensorMatchesDataTypes(
  sensorType: string,
  selectedDataTypes: Set<string>,
): boolean {
  if (selectedDataTypes.size === 0) return true;
  for (const id of selectedDataTypes) {
    const filter = DATA_TYPE_FILTERS.find((f) => f.id === id);
    if (filter?.sensorTypes.includes(sensorType)) return true;
  }
  return false;
}
