"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import FilterPanel from "@/components/FilterPanel";
import SensorMap from "@/components/SensorMap";
import { getSensors, getSensorTypes, getSensor } from "@/lib/sensors-api";
import {
  boundsContained,
  boundsToFetchSegments,
  centerFromBounds,
  expandBounds,
  normalizeBounds,
  sortSensorsByCenter,
} from "@/lib/map-utils";
import type { Sensor } from "@/lib/types";
import type { Bounds } from "@/lib/types";

const BOUNDS_DEBOUNCE_MS = 600;
const VIEWPORT_CUSHION = 0.15; // 15% margin so we overfetch and skip refetch when panning within margin
const BBOX_CACHE_MAX_ENTRIES = 20;
const PROGRESSIVE_CHUNK_MS = 50;
const PROGRESSIVE_CHUNK_SIZE = 200;
/** Max concurrent bbox fetches (type × segment tasks). */
const BBOX_CONCURRENCY = 4;
/** Cap radius pagination so we don't run unbounded requests. */
const RADIUS_MAX_PAGES = 5;

/** Run async tasks with a concurrency limit; returns results in task order. */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function runNext(): Promise<void> {
    const i = index++;
    if (i >= tasks.length) return;
    results[i] = await tasks[i]();
    await runNext();
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    runNext(),
  );
  await Promise.all(workers);
  return results;
}

export default function ExplorerClient() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("q")?.trim() ?? "";
  const focusSensorIdParam = searchParams.get("sensor")?.trim() ?? null;
  const [sensorTypes, setSensorTypes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [allSensors, setAllSensors] = useState<Sensor[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingSensors, setLoadingSensors] = useState(true);
  const [sensorsError, setSensorsError] = useState<string | null>(null);
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [debouncedBounds, setDebouncedBounds] = useState<Bounds | null>(null);
  const [debouncedBoundsKey, setDebouncedBoundsKey] = useState<string | null>(
    null,
  );
  const [fitToSensorsTrigger, setFitToSensorsTrigger] = useState(0);
  const [focusSensor, setFocusSensor] = useState<Sensor | null>(null);
  const [progressiveVisibleCount, setProgressiveVisibleCount] = useState(0);
  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsKeyRef = useRef<string | null>(null);
  const boundsForFetchRef = useRef<Bounds | null>(null);
  const lastFetchedBboxRef = useRef<Bounds | null>(null);
  const lastSelectedTypesKeyRef = useRef<string>("");
  const bboxCacheRef = useRef<Map<string, Sensor[]>>(new Map());
  const fetchIdRef = useRef(0);

  // Fetch focus sensor when ?sensor=id is in URL (e.g. from DotGrid "View sensor" link)
  useEffect(() => {
    if (!focusSensorIdParam) {
      setFocusSensor(null);
      return;
    }
    let cancelled = false;
    getSensor(focusSensorIdParam)
      .then((s) => {
        if (!cancelled && s) setFocusSensor(s);
        else if (!cancelled) setFocusSensor(null);
      })
      .catch(() => {
        if (!cancelled) setFocusSensor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [focusSensorIdParam]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTypes(true);
    getSensorTypes()
      .then((types) => {
        if (!cancelled) setSensorTypes(types);
      })
      .catch(() => {
        if (!cancelled) setSensorTypes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce map bounds and only update when viewport has meaningfully changed (avoids refetch loop).
  // Normalize bounds so west/east are in [-180, 180]; map can return west=-193 (167°E) which would send invalid min_lon to the API.
  useEffect(() => {
    if (bounds == null) {
      lastBoundsKeyRef.current = null;
      boundsForFetchRef.current = null;
      setDebouncedBoundsKey(null);
      setDebouncedBounds(null);
      return;
    }
    const norm = normalizeBounds(bounds);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const boundsKey = `${round2(norm.west)}_${round2(norm.south)}_${round2(norm.east)}_${round2(norm.north)}`;
    if (boundsKey === lastBoundsKeyRef.current) return;

    if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
    boundsDebounceRef.current = setTimeout(() => {
      lastBoundsKeyRef.current = boundsKey;
      boundsForFetchRef.current = norm;
      setDebouncedBoundsKey(boundsKey);
      setDebouncedBounds(norm);
      boundsDebounceRef.current = null;
    }, BOUNDS_DEBOUNCE_MS);
    return () => {
      if (boundsDebounceRef.current) clearTimeout(boundsDebounceRef.current);
    };
  }, [bounds]);

  // When using bbox (viewport), paginate through all pages (up to a cap) so zoomed-out view gets more than 500 sensors
  const BBOX_PAGE_LIMIT = 500;
  const BBOX_MAX_PAGES = 10; // cap at 5000 sensors per viewport to avoid runaway requests
  // Center+radius fetch (like MCP list_sensors) so we include buoys and other sensors near viewport center (e.g. offshore)
  const CENTER_RADIUS_KM = 150;

  useEffect(() => {
    let cancelled = false;
    const selectedTypesKey = [...selectedTypes].sort().join(",");
    if (selectedTypesKey !== lastSelectedTypesKeyRef.current) {
      lastFetchedBboxRef.current = null;
      lastSelectedTypesKeyRef.current = selectedTypesKey;
    }

    // When 2+ types selected, fetch each type and merge so we don't lose one type to the "all" 5000 cap.
    const typesToFetch =
      selectedTypes.size === 0
        ? [null as string | null]
        : [...selectedTypes].sort();
    const bbox = debouncedBoundsKey != null ? boundsForFetchRef.current : null;
    const searchQuery = initialSearch || undefined;

    // Viewport cushion: skip refetch if current viewport is still inside the last fetched (expanded) bbox
    if (
      bbox != null &&
      lastFetchedBboxRef.current != null &&
      boundsContained(bbox, lastFetchedBboxRef.current)
    ) {
      setLoadingSensors(false);
      return;
    }

    // Client cache: show cached data immediately for this viewport+filter+search, then revalidate in background
    const cacheKey =
      debouncedBoundsKey != null
        ? `${debouncedBoundsKey}_${selectedTypesKey}_${searchQuery ?? ""}`
        : null;
    const cached = cacheKey ? bboxCacheRef.current.get(cacheKey) : undefined;
    if (cached !== undefined) {
      setAllSensors(cached);
      setProgressiveVisibleCount(cached.length);
      setLoadingSensors(false);
      setSensorsError(null);
      setRadiusError(null);
      return;
    }

    setLoadingSensors(true);
    setSensorsError(null);
    setRadiusError(null);
    const expandedBbox =
      bbox != null ? expandBounds(bbox, VIEWPORT_CUSHION) : null;
    if (bbox != null && expandedBbox != null) {
      lastFetchedBboxRef.current = expandedBbox;
    }

    const segments =
      expandedBbox != null ? boundsToFetchSegments(expandedBbox) : [null];

    const myFetchId = ++fetchIdRef.current;

    async function fetchAllPages() {
      const accumulated: Sensor[] = [];
      const seenIds = new Set<string>();
      try {
        // Build one bbox task per (type, segment); run with concurrency limit so types load in parallel.
        const bboxTasks: (() => Promise<Sensor[]>)[] = [];
        for (const type of typesToFetch) {
          const baseOpts = {
            limit: BBOX_PAGE_LIMIT,
            ...(type != null && { sensor_type: type }),
            ...(searchQuery && { search: searchQuery }),
          };
          for (let segIndex = 0; segIndex < segments.length; segIndex++) {
            const seg = segments[segIndex];
            const fetchOpts =
              seg != null
                ? {
                    ...baseOpts,
                    min_lat: seg.south,
                    min_lon: seg.west,
                    max_lat: seg.north,
                    max_lon: seg.east,
                  }
                : baseOpts;
            bboxTasks.push(async () => {
              const chunk: Sensor[] = [];
              let page = 1;
              while (true) {
                const res = await getSensors({ ...fetchOpts, page });
                if (cancelled) return chunk;
                for (const s of res.sensors) chunk.push(s);
                const hasMore =
                  res.sensors.length === BBOX_PAGE_LIMIT &&
                  page < res.pagination.total_pages &&
                  page < BBOX_MAX_PAGES;
                if (!hasMore) break;
                page += 1;
              }
              return chunk;
            });
          }
        }
        const bboxResults = await runWithConcurrency(
          bboxTasks,
          BBOX_CONCURRENCY,
        );
        if (cancelled || myFetchId !== fetchIdRef.current) return;
        for (const chunk of bboxResults) {
          for (const s of chunk) {
            if (!seenIds.has(s.id)) {
              seenIds.add(s.id);
              accumulated.push(s);
            }
          }
        }

        // When we have a viewport, also fetch by center+radius so we get buoys and offshore sensors.
        // Paginate radius; when 2+ types selected, run one radius pass per type so we don't truncate one type at 500.
        if (bbox != null && !cancelled && myFetchId === fetchIdRef.current) {
          const center = centerFromBounds(bbox);
          const radiusLimit = 500;
          const typesForRadius =
            typesToFetch.length >= 2
              ? typesToFetch.filter((t): t is string => t != null)
              : typesToFetch.length === 1 && typesToFetch[0] != null
                ? [typesToFetch[0]]
                : [null as string | null];
          let radiusFailed = false;
          for (const sensorType of typesForRadius) {
            try {
              let page = 1;
              while (page <= RADIUS_MAX_PAGES) {
                const radiusRes = await getSensors({
                  limit: radiusLimit,
                  lat: center.lat,
                  lon: center.lon,
                  radius_km: CENTER_RADIUS_KM,
                  page,
                  ...(sensorType != null && { sensor_type: sensorType }),
                  ...(searchQuery && { search: searchQuery }),
                });
                if (cancelled || myFetchId !== fetchIdRef.current) return;
                const byId = new Map(accumulated.map((s) => [s.id, s]));
                for (const s of radiusRes.sensors) {
                  if (!byId.has(s.id)) byId.set(s.id, s);
                }
                accumulated.length = 0;
                accumulated.push(...byId.values());
                const hasMore =
                  radiusRes.sensors.length === radiusLimit &&
                  page < radiusRes.pagination.total_pages;
                if (!hasMore) break;
                page += 1;
              }
            } catch (err) {
              radiusFailed = true;
            }
          }
          if (radiusFailed && myFetchId === fetchIdRef.current) {
            setRadiusError("Offshore sensors may be incomplete.");
          }
        }

        if (myFetchId !== fetchIdRef.current) return;
        const centerBbox = bbox ?? expandedBbox ?? null;
        const sorted =
          centerBbox != null
            ? sortSensorsByCenter(accumulated, centerFromBounds(centerBbox))
            : accumulated;
        setAllSensors(sorted);
        setProgressiveVisibleCount(bbox == null ? sorted.length : 0);
        if (cacheKey) {
          bboxCacheRef.current.set(cacheKey, sorted);
          if (bboxCacheRef.current.size > BBOX_CACHE_MAX_ENTRIES) {
            const firstKey = bboxCacheRef.current.keys().next().value;
            if (firstKey != null) bboxCacheRef.current.delete(firstKey);
          }
        }
      } catch (err) {
        if (myFetchId === fetchIdRef.current) {
          setSensorsError(
            err instanceof Error ? err.message : "Failed to load sensors",
          );
        }
      } finally {
        if (myFetchId === fetchIdRef.current) setLoadingSensors(false);
      }
    }

    fetchAllPages();
    return () => {
      cancelled = true;
    };
  }, [selectedTypes, debouncedBoundsKey, initialSearch]);

  const filteredByType = useMemo(() => {
    if (selectedTypes.size === 0) return allSensors;
    return allSensors.filter((s) => selectedTypes.has(s.sensor_type));
  }, [allSensors, selectedTypes]);

  // Show all filtered sensors on the globe; include focus sensor from ?sensor=id if not already in list
  const sensorsToShow = useMemo(() => {
    if (
      !focusSensor ||
      focusSensor.latitude == null ||
      focusSensor.longitude == null
    )
      return filteredByType;
    const hasFocus = filteredByType.some((s) => s.id === focusSensor.id);
    return hasFocus ? filteredByType : [focusSensor, ...filteredByType];
  }, [filteredByType, focusSensor]);

  // Progressive display: reveal sensors center-out in chunks (data is already sorted by distance from center)
  const displaySensors = useMemo(
    () => sensorsToShow.slice(0, progressiveVisibleCount),
    [sensorsToShow, progressiveVisibleCount],
  );
  useEffect(() => {
    if (progressiveVisibleCount >= sensorsToShow.length) return;
    const t = setTimeout(() => {
      setProgressiveVisibleCount((n) =>
        Math.min(n + PROGRESSIVE_CHUNK_SIZE, sensorsToShow.length),
      );
    }, PROGRESSIVE_CHUNK_MS);
    return () => clearTimeout(t);
  }, [progressiveVisibleCount, sensorsToShow.length]);

  // When filtered list shrinks, cap visible count so we don't show more than we have
  useEffect(() => {
    if (progressiveVisibleCount > sensorsToShow.length) {
      setProgressiveVisibleCount(sensorsToShow.length);
    }
  }, [progressiveVisibleCount, sensorsToShow.length]);

  const handleBoundsChange = useCallback((b: Bounds) => {
    setBounds(b);
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <div className="absolute inset-0">
        <SensorMap
          sensors={sensorsToShow}
          onBoundsChange={handleBoundsChange}
          fitToSensorsTrigger={fitToSensorsTrigger}
          focusSensorId={focusSensor?.id ?? null}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-zinc-200/60 bg-white/90 backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-900/90">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Sensors
          </span>
          {initialSearch && (
            <span
              className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
              title="Preloaded from home page search"
            >
              &quot;{initialSearch}&quot;
            </span>
          )}
          {loadingSensors ? (
            <span className="text-xs text-zinc-500">Loading…</span>
          ) : sensorsError ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {sensorsError}
            </span>
          ) : (
            <>
              <span
                data-status="sensor-count"
                className="text-xs text-zinc-500 dark:text-zinc-400"
              >
                {sensorsToShow.length} shown
              </span>
              {radiusError && (
                <span
                  className="text-xs text-amber-600 dark:text-amber-400"
                  title={radiusError}
                >
                  {radiusError}
                </span>
              )}
              <button
                type="button"
                onClick={() => setFitToSensorsTrigger((t) => t + 1)}
                disabled={
                  sensorsToShow.filter(
                    (s) => s.latitude != null && s.longitude != null,
                  ).length === 0
                }
                className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Fit view
              </button>
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <FilterPanel
              sensorTypes={sensorTypes}
              selectedTypes={selectedTypes}
              onSelectedTypesChange={setSelectedTypes}
              isLoading={loadingTypes}
              variant="toolbar"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
