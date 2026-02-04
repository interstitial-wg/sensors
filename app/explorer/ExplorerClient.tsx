"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SensorMap from "@/components/SensorMap";
import ExplorerChatPanel from "@/components/ExplorerChatPanel";
import { NavDropdown } from "@/components/NavDropdown";
import { getSensors, getSensorTypes, getSensor } from "@/lib/sensors-api";
import { dataTypesToSensorTypes, DATA_TYPE_IDS } from "@/lib/data-filters";
import { getLocationGeocodeFallback } from "@/lib/query-parser";
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

/** Default bounds matching map initialViewState (SF Bay: -122.27, 37.8, zoom 8) so we fetch immediately before map reports. */
const INITIAL_BOUNDS: Bounds = {
  west: -126,
  south: 35,
  east: -118,
  north: 41,
};
const BBOX_CACHE_MAX_ENTRIES = 20;
const PROGRESSIVE_CHUNK_MS = 50;
const PROGRESSIVE_CHUNK_SIZE = 200;
/** Max concurrent bbox fetches (type × segment tasks). */
const BBOX_CONCURRENCY = 4;
/** Cap radius pagination so we don't run unbounded requests. */
const RADIUS_MAX_PAGES = 5;
/** Radius (km) when searching by location from query (e.g. "Oakland") */
const LOCATION_RADIUS_KM = 80;

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("q")?.trim() ?? "";
  const focusSensorIdParam = searchParams.get("sensor")?.trim() ?? null;
  const typeParam = searchParams.get("type")?.trim() ?? null;
  const providerParam = searchParams.get("provider")?.trim() ?? null;
  const locationLatParam = searchParams.get("lat");
  const locationLonParam = searchParams.get("lon");
  const hasLocationCoords =
    locationLatParam != null &&
    locationLonParam != null &&
    !Number.isNaN(parseFloat(locationLatParam)) &&
    !Number.isNaN(parseFloat(locationLonParam));
  const locationLat =
    locationLatParam != null ? parseFloat(locationLatParam) : null;
  const locationLon =
    locationLonParam != null ? parseFloat(locationLonParam) : null;
  const initialTypes = useMemo(() => {
    if (!typeParam) return new Set<string>();
    return new Set(
      typeParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => DATA_TYPE_IDS.has(t)),
    );
  }, [typeParam]);
  const [sensorTypes, setSensorTypes] = useState<string[]>([]);
  const [selectedDataTypes, setSelectedDataTypes] =
    useState<Set<string>>(initialTypes);

  useEffect(() => {
    setSelectedDataTypes(initialTypes);
  }, [initialTypes]);

  useEffect(() => {
    if (!hasLocationCoords) setLocationFetchUsedFallback(false);
  }, [hasLocationCoords]);
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
  const [locationFetchUsedFallback, setLocationFetchUsedFallback] =
    useState(false);
  const [focusSensor, setFocusSensor] = useState<Sensor | null>(null);
  const [progressiveVisibleCount, setProgressiveVisibleCount] = useState(0);
  const boundsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoundsKeyRef = useRef<string | null>(null);
  const boundsForFetchRef = useRef<Bounds | null>(null);
  const lastFetchedBboxRef = useRef<Bounds | null>(null);
  const lastSelectedTypesKeyRef = useRef<string>("");
  const bboxCacheRef = useRef<Map<string, Sensor[]>>(new Map());
  const locationCacheFallbackRef = useRef<Map<string, boolean>>(new Map());
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
    const selectedTypesKey = [...selectedDataTypes].sort().join(",");
    const providerFilter = providerParam || undefined;

    // Location-based fetch: when lat/lon in URL (from geocoded query), fetch by center+radius
    // Do NOT pass search param - lat/lon defines the area; full query would filter out all sensors
    if (hasLocationCoords && locationLat != null && locationLon != null) {
      const cacheKey = `loc_${locationLat}_${locationLon}_${selectedTypesKey}_${providerFilter ?? ""}`;
      const cached = bboxCacheRef.current.get(cacheKey);
      if (cached !== undefined) {
        setAllSensors(cached);
        setProgressiveVisibleCount(cached.length);
        setLoadingSensors(false);
        setSensorsError(null);
        setRadiusError(null);
        setLocationFetchUsedFallback(
          locationCacheFallbackRef.current.get(cacheKey) ?? false,
        );
        setFitToSensorsTrigger((t) => t + 1);
        return;
      }

      setLoadingSensors(true);
      setSensorsError(null);
      setRadiusError(null);
      const myFetchId = ++fetchIdRef.current;
      const sensorTypesToFetch = dataTypesToSensorTypes(selectedDataTypes);
      const typesToFetch =
        sensorTypesToFetch.length === 0
          ? [null as string | null]
          : sensorTypesToFetch;

      (async () => {
        const accumulated: Sensor[] = [];
        const seenIds = new Set<string>();
        try {
          for (const sensorType of typesToFetch) {
            let page = 1;
            while (page <= RADIUS_MAX_PAGES) {
              const res = await getSensors({
                limit: 500,
                lat: locationLat,
                lon: locationLon,
                radius_km: LOCATION_RADIUS_KM,
                page,
                ...(sensorType != null && { sensor_type: sensorType }),
                ...(providerFilter && { provider: providerFilter }),
              });
              if (cancelled || myFetchId !== fetchIdRef.current) return;
              for (const s of res.sensors) {
                if (!seenIds.has(s.id)) {
                  seenIds.add(s.id);
                  accumulated.push(s);
                }
              }
              const hasMore =
                res.sensors.length === 500 && page < res.pagination.total_pages;
              if (!hasMore) break;
              page += 1;
            }
          }
          let finalSensors = accumulated;
          let usedFallback = false;
          if (accumulated.length === 0 && typesToFetch.some((t) => t != null)) {
            usedFallback = true;
            const fallbackAcc: Sensor[] = [];
            let page = 1;
            while (page <= RADIUS_MAX_PAGES) {
              const res = await getSensors({
                limit: 500,
                lat: locationLat,
                lon: locationLon,
                radius_km: LOCATION_RADIUS_KM,
                page,
                ...(providerFilter && { provider: providerFilter }),
              });
              if (cancelled || myFetchId !== fetchIdRef.current) return;
              for (const s of res.sensors) {
                if (!fallbackAcc.some((x) => x.id === s.id)) fallbackAcc.push(s);
              }
              const hasMore =
                res.sensors.length === 500 && page < res.pagination.total_pages;
              if (!hasMore) break;
              page += 1;
            }
            finalSensors = fallbackAcc;
          }
          if (myFetchId !== fetchIdRef.current) return;
          const sorted = sortSensorsByCenter(finalSensors, {
            lat: locationLat,
            lon: locationLon,
          });
          setAllSensors(sorted);
          setProgressiveVisibleCount(sorted.length);
          setLocationFetchUsedFallback(usedFallback);
          bboxCacheRef.current.set(cacheKey, sorted);
          locationCacheFallbackRef.current.set(cacheKey, usedFallback);
          if (bboxCacheRef.current.size > BBOX_CACHE_MAX_ENTRIES) {
            const firstKey = bboxCacheRef.current.keys().next().value;
            if (firstKey != null) bboxCacheRef.current.delete(firstKey);
          }
          setFitToSensorsTrigger((t) => t + 1);
        } catch (err) {
          if (myFetchId === fetchIdRef.current) {
            setSensorsError(
              err instanceof Error ? err.message : "Failed to load sensors",
            );
          }
        } finally {
          if (myFetchId === fetchIdRef.current) setLoadingSensors(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // Viewport-based fetch (original logic)
    if (selectedTypesKey !== lastSelectedTypesKeyRef.current) {
      lastFetchedBboxRef.current = null;
      lastSelectedTypesKeyRef.current = selectedTypesKey;
    }

    const sensorTypesToFetch = dataTypesToSensorTypes(selectedDataTypes);
    const typesToFetch =
      sensorTypesToFetch.length === 0
        ? [null as string | null]
        : sensorTypesToFetch;
    const bbox =
      debouncedBoundsKey != null ? boundsForFetchRef.current : INITIAL_BOUNDS;

    if (
      bbox != null &&
      lastFetchedBboxRef.current != null &&
      boundsContained(bbox, lastFetchedBboxRef.current)
    ) {
      setLoadingSensors(false);
      return;
    }

    const cacheKey =
      debouncedBoundsKey != null
        ? `${debouncedBoundsKey}_${selectedTypesKey}_${providerFilter ?? ""}`
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
            ...(providerFilter && { provider: providerFilter }),
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
                  ...(providerFilter && { provider: providerFilter }),
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
  }, [
    selectedDataTypes,
    debouncedBoundsKey,
    initialSearch,
    providerParam,
    hasLocationCoords,
    locationLat,
    locationLon,
  ]);

  const filteredByType = useMemo(() => {
    if (locationFetchUsedFallback) return allSensors;
    if (selectedDataTypes.size === 0) return allSensors;
    const sensorTypesToFetch = dataTypesToSensorTypes(selectedDataTypes);
    return allSensors.filter((s) => sensorTypesToFetch.includes(s.sensor_type));
  }, [allSensors, selectedDataTypes, locationFetchUsedFallback]);

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

  const handleSearchSubmit = useCallback(
    async (query: string, selectedTypes: Set<string>) => {
      const q = query.trim();
      let parsed: { location?: string; dataTypeIds: string[] };
      try {
        const res = await fetch("/api/parse-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q || "Show sensors" }),
        });
        parsed = await res.json();
      } catch {
        parsed = { dataTypeIds: [] };
      }
      const mergedTypes = new Set(selectedTypes);
      for (const id of parsed.dataTypeIds ?? []) {
        if (DATA_TYPE_IDS.has(id)) mergedTypes.add(id);
      }
      const params = new URLSearchParams(searchParams.toString());
      params.delete("q");
      params.delete("type");
      params.delete("lat");
      params.delete("lon");
      if (q) params.set("q", q);
      if (mergedTypes.size > 0 && mergedTypes.size < DATA_TYPE_IDS.size) {
        params.set("type", [...mergedTypes].sort().join(","));
      }
      const location = parsed.location?.trim();
      if (location) {
        const toTry = [
          location,
          getLocationGeocodeFallback(location),
        ].filter(Boolean) as string[];
        for (const loc of toTry) {
          try {
            const res = await fetch(
              `/api/geocode?q=${encodeURIComponent(loc)}&countrycodes=us`,
            );
            if (res.ok) {
              const data = (await res.json()) as {
                lat: number;
                lon: number;
                display_name?: string;
              } | null;
              if (data?.lat != null && data?.lon != null) {
                params.set("lat", String(data.lat));
                params.set("lon", String(data.lon));
                break;
              }
            }
          } catch {
            // Try next fallback
          }
        }
      }
      router.push(
        `/explorer${params.toString() ? `?${params.toString()}` : ""}`,
      );
    },
    [router, searchParams],
  );

  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Map - full viewport, extends under bottom panel */}
      <div className="absolute inset-0">
        <SensorMap
          sensors={sensorsToShow}
          onBoundsChange={handleBoundsChange}
          fitToSensorsTrigger={fitToSensorsTrigger}
          focusSensorId={focusSensor?.id ?? null}
        />
      </div>

      {/* Nav pill in upper left */}
      <div className="pointer-events-none absolute left-0 top-0 z-20 p-3">
        <div className="pointer-events-auto">
          <NavDropdown />
        </div>
      </div>

      {/* Left panel: floats over map, transparent except input bar */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex w-96 max-w-[85vw] shrink-0 flex-col p-4 pt-20">
        <ExplorerChatPanel
          focusSensor={focusSensor}
          sensorCount={sensorsToShow.length}
          loadingSensors={loadingSensors}
          sensorsError={sensorsError}
          sensors={sensorsToShow}
          locationFetchUsedFallback={locationFetchUsedFallback}
          requestedDataTypes={selectedDataTypes}
          onSearchSubmit={handleSearchSubmit}
        />
      </div>
    </div>
  );
}
