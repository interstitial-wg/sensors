"use client";

import { useCallback } from "react";

export interface FilterPanelProps {
  sensorTypes: string[];
  selectedTypes: Set<string>;
  onSelectedTypesChange: (selected: Set<string>) => void;
  isLoading?: boolean;
  variant?: "default" | "toolbar";
}

const SENSOR_TYPE_LABELS: Record<string, string> = {
  buoy: "Ocean buoys",
  river_sensor: "River / hydrology",
  weather_station: "Farm / weather stations",
  air_quality_monitor: "Air quality",
};

function labelForType(type: string): string {
  return SENSOR_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

export default function FilterPanel({
  sensorTypes,
  selectedTypes,
  onSelectedTypesChange,
  isLoading = false,
  variant = "default",
}: FilterPanelProps) {
  const toggle = useCallback(
    (type: string) => {
      const next = new Set(selectedTypes);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      onSelectedTypesChange(next);
    },
    [selectedTypes, onSelectedTypesChange]
  );

  const selectAll = useCallback(() => {
    onSelectedTypesChange(new Set(sensorTypes));
  }, [sensorTypes, onSelectedTypesChange]);

  const clearAll = useCallback(() => {
    onSelectedTypesChange(new Set());
  }, [onSelectedTypesChange]);

  const isToolbar = variant === "toolbar";

  if (isToolbar) {
    return (
      <aside className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Filter by sensor type
        </span>
        {isLoading ? (
          <span className="text-xs text-zinc-500">Loading types…</span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {sensorTypes.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(type)}
                    onChange={() => toggle(type)}
                    className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {labelForType(type)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={selectAll}
                className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                All
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Filter by sensor type
      </h2>
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading types…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {sensorTypes.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.has(type)}
                  onChange={() => toggle(type)}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
                />
                <span className="text-zinc-800 dark:text-zinc-200">
                  {labelForType(type)}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            >
              All
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            >
              Clear
            </button>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
        Sensors in the current map view are shown. Pan or zoom to change the
        area.
      </p>
    </aside>
  );
}
