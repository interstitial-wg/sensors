"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SensorMap from "@/components/SensorMap";
import ExplorerChatPanel from "@/components/ExplorerChatPanel";
import { NavDropdown } from "@/components/NavDropdown";
import { getSensors, getSensorTypes, getSensor } from "@/lib/sensors-api";
import { dataTypesToSensorTypes, DATA_TYPE_IDS } from "@/lib/data-filters";
import {
  boundsContained,
  boundsToFetchSegments,
  centerFromBounds,
  expandBounds,
  normalizeBounds,
  sensorsToBounds,
  sortSensorsByCenter,
} from "@/lib/map-utils";
import { filterSensorsByBounds } from "@/lib/sensors-api";
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
/** Radius tiers for location search: start with city scale, expand if no sensors. */
const LOCATION_RADIUS_INITIAL_KM = 8; // City scale (Oakland ~10km, SF ~11km)
const LOCATION_RADIUS_TIER2_KM = 25; // Metro area
const LOCATION_RADIUS_TIER3_KM = 80; // Regional (e.g. Bay Area)

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
  const locationMinLatParam = searchParams.get("min_lat");
  const locationMaxLatParam = searchParams.get("max_lat");
  const locationMinLonParam = searchParams.get("min_lon");
  const locationMaxLonParam = searchParams.get("max_lon");
  const hasLocationCoords =
    locationLatParam != null &&
    locationLonParam != null &&
    !Number.isNaN(parseFloat(locationLatParam)) &&
    !Number.isNaN(parseFloat(locationLonParam));
  const locationLat =
    locationLatParam != null ? parseFloat(locationLatParam) : null;
  const locationLon =
    locationLonParam != null ? parseFloat(locationLonParam) : null;
  const hasLocationBbox =
    locationMinLatParam != null &&
    locationMaxLatParam != null &&
    locationMinLonParam != null &&
    locationMaxLonParam != null &&
    !Number.isNaN(parseFloat(locationMinLatParam)) &&
    !Number.isNaN(parseFloat(locationMaxLatParam)) &&
    !Number.isNaN(parseFloat(locationMinLonParam)) &&
    !Number.isNaN(parseFloat(locationMaxLonParam));
  const locationBbox = hasLocationBbox
    ? {
        min_lat: parseFloat(locationMinLatParam!),
        max_lat: parseFloat(locationMaxLatParam!),
        min_lon: parseFloat(locationMinLonParam!),
        max_lon: parseFloat(locationMaxLonParam!),
      }
    : null;
  const locationBboxKey = locationBbox
    ? `${locationBbox.min_lat}_${locationBbox.max_lat}_${locationBbox.min_lon}_${locationBbox.max_lon}`
    : "";
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
    if (!hasLocationCoords) {
      setLocationFetchUsedFallback(false);
      setLocationDataReady(true);
      setSensorsLocationKey(null);
    }
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
  const [locationDataReady, setLocationDataReady] = useState(true);
  const [sensorsLocationKey, setSensorsLocationKey] = useState<string | null>(
    null,
  );
  const [isFindingLocation, setIsFindingLocation] = useState(false);
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

    // Location-based fetch: start with city boundaries (bbox) or small radius, expand if no sensors
    if (hasLocationCoords && locationLat != null && locationLon != null) {
      // Set loading immediately to prevent assistant from building with stale viewport data
      setLoadingSensors(true);
      setLocationDataReady(false); // Block build until fetch completes
      setAllSensors([]); // Clear stale sensors from previous city so we don't show wrong results
      const cacheKey = `loc_${locationLat}_${locationLon}_${locationBboxKey}_${selectedTypesKey}_${providerFilter ?? ""}`;
      const cached = bboxCacheRef.current.get(cacheKey);
      // Don't use cache for empty results — may have been transient; retry to get sensors
      if (cached !== undefined && cached.length > 0) {
        setAllSensors(cached);
        setProgressiveVisibleCount(cached.length);
        setLoadingSensors(false);
        setLocationDataReady(true);
        setSensorsLocationKey(`${locationLat}_${locationLon}`);
        setSensorsError(null);
        setRadiusError(null);
        setLocationFetchUsedFallback(
          locationCacheFallbackRef.current.get(cacheKey) ?? false,
        );
        return;
      }

      setSensorsError(null);
      setRadiusError(null);
      const myFetchId = ++fetchIdRef.current;
      const sensorTypesToFetch = dataTypesToSensorTypes(selectedDataTypes);
      const typesToFetch =
        sensorTypesToFetch.length === 0
          ? [null as string | null]
          : sensorTypesToFetch;

      async function fetchWithOpts(opts: {
        min_lat?: number;
        max_lat?: number;
        min_lon?: number;
        max_lon?: number;
        lat?: number;
        lon?: number;
        radius_km?: number;
      }): Promise<Sensor[]> {
        const acc: Sensor[] = [];
        const seen = new Set<string>();
        for (const sensorType of typesToFetch) {
          let page = 1;
          while (page <= RADIUS_MAX_PAGES) {
            const res = await getSensors({
              limit: 500,
              page,
              ...opts,
              ...(sensorType != null && { sensor_type: sensorType }),
              ...(providerFilter && { provider: providerFilter }),
            });
            if (cancelled || myFetchId !== fetchIdRef.current) return [];
            for (const s of res.sensors) {
              if (!seen.has(s.id)) {
                seen.add(s.id);
                acc.push(s);
              }
            }
            const hasMore =
              res.sensors.length === 500 && page < res.pagination.total_pages;
            if (!hasMore) break;
            page += 1;
          }
        }
        return acc;
      }

      (async () => {
        try {
          let accumulated: Sensor[] = [];
          let usedFallback = false;

          // Tier 1a: if we have bbox from geocoding, try it first (some APIs prefer bbox)
          if (locationBbox) {
            accumulated = await fetchWithOpts({
              min_lat: locationBbox.min_lat,
              max_lat: locationBbox.max_lat,
              min_lon: locationBbox.min_lon,
              max_lon: locationBbox.max_lon,
            });
          }

          // Tier 1b: radius from center
          if (accumulated.length === 0) {
            accumulated = await fetchWithOpts({
              lat: locationLat,
              lon: locationLon,
              radius_km: LOCATION_RADIUS_INITIAL_KM,
            });
          }

          // Tier 2: expand to 25km if no sensors
          if (accumulated.length === 0) {
            accumulated = await fetchWithOpts({
              lat: locationLat,
              lon: locationLon,
              radius_km: LOCATION_RADIUS_TIER2_KM,
            });
            usedFallback = true;
          }

          // Tier 3: expand to 80km if still none
          if (accumulated.length === 0) {
            accumulated = await fetchWithOpts({
              lat: locationLat,
              lon: locationLon,
              radius_km: LOCATION_RADIUS_TIER3_KM,
            });
          }

          // Type fallback: if we had type filter and still 0, show all types in area
          if (accumulated.length === 0 && typesToFetch.some((t) => t != null)) {
            const fallbackAcc: Sensor[] = [];
            const fallbackSeen = new Set<string>();
            let page = 1;
            while (page <= RADIUS_MAX_PAGES) {
              const res = await getSensors({
                limit: 500,
                lat: locationLat,
                lon: locationLon,
                radius_km: LOCATION_RADIUS_TIER3_KM,
                page,
                ...(providerFilter && { provider: providerFilter }),
              });
              if (cancelled || myFetchId !== fetchIdRef.current) return;
              for (const s of res.sensors) {
                if (!fallbackSeen.has(s.id)) {
                  fallbackSeen.add(s.id);
                  fallbackAcc.push(s);
                }
              }
              const hasMore =
                res.sensors.length === 500 && page < res.pagination.total_pages;
              if (!hasMore) break;
              page += 1;
            }
            if (fallbackAcc.length > 0) {
              accumulated = fallbackAcc;
              usedFallback = true; // so we show all types and assistant can say "No AQI here, but nearby: ..."
            }
          }

          // Bbox fallback: when radius returns 0 (API may not support radius), try bbox around searched location
          if (accumulated.length === 0) {
            const pad = 0.5; // ~55km per degree at mid-latitudes
            const fallbackBbox = {
              min_lat: locationLat - pad,
              max_lat: locationLat + pad,
              min_lon: locationLon - pad,
              max_lon: locationLon + pad,
            };
            const fallbackAcc: Sensor[] = [];
            const fallbackSeen = new Set<string>();
            for (const sensorType of typesToFetch) {
              let page = 1;
              while (page <= RADIUS_MAX_PAGES) {
                const res = await getSensors({
                  limit: 500,
                  page,
                  min_lat: fallbackBbox.min_lat,
                  min_lon: fallbackBbox.min_lon,
                  max_lat: fallbackBbox.max_lat,
                  max_lon: fallbackBbox.max_lon,
                  ...(sensorType != null && { sensor_type: sensorType }),
                  ...(providerFilter && { provider: providerFilter }),
                });
                if (cancelled || myFetchId !== fetchIdRef.current) return [];
                for (const s of res.sensors) {
                  if (!fallbackSeen.has(s.id)) {
                    fallbackSeen.add(s.id);
                    fallbackAcc.push(s);
                  }
                }
                const hasMore =
                  res.sensors.length === 500 &&
                  page < res.pagination.total_pages;
                if (!hasMore) break;
                page += 1;
              }
            }
            if (fallbackAcc.length > 0) {
              accumulated = sortSensorsByCenter(fallbackAcc, {
                lat: locationLat,
                lon: locationLon,
              });
              usedFallback = true;
            }
          }

          // Last resort: try a wide bbox (~220km) around the searched location — some APIs only support bbox
          if (accumulated.length === 0) {
            const pad = 1; // ~111km per degree at mid-latitudes
            const regionBbox = {
              south: locationLat - pad,
              north: locationLat + pad,
              west: locationLon - pad,
              east: locationLon + pad,
            };
            const regionAcc: Sensor[] = [];
            const regionSeen = new Set<string>();
            for (const sensorType of typesToFetch) {
              let page = 1;
              while (page <= RADIUS_MAX_PAGES) {
                const res = await getSensors({
                  limit: 500,
                  page,
                  min_lat: regionBbox.south,
                  min_lon: regionBbox.west,
                  max_lat: regionBbox.north,
                  max_lon: regionBbox.east,
                  ...(sensorType != null && { sensor_type: sensorType }),
                  ...(providerFilter && { provider: providerFilter }),
                });
                if (cancelled || myFetchId !== fetchIdRef.current) return;
                for (const s of res.sensors) {
                  if (!regionSeen.has(s.id)) {
                    regionSeen.add(s.id);
                    regionAcc.push(s);
                  }
                }
                const hasMore =
                  res.sensors.length === 500 &&
                  page < res.pagination.total_pages;
                if (!hasMore) break;
                page += 1;
              }
            }
            if (regionAcc.length > 0) {
              accumulated = sortSensorsByCenter(regionAcc, {
                lat: locationLat,
                lon: locationLon,
              });
              usedFallback = true;
            }
          }

          if (myFetchId !== fetchIdRef.current) return;
          // Filter to searched area — API may ignore location params and return full dataset
          const pad = 1; // ~111km at mid-latitudes — matches our widest fetch fallback
          const locationBounds = {
            west: locationLon - pad,
            south: locationLat - pad,
            east: locationLon + pad,
            north: locationLat + pad,
          };
          const inArea = filterSensorsByBounds(accumulated, locationBounds);
          // Always use filtered — if API ignores location params, only show sensors in searched area
          const toUse = inArea;
          const sorted = sortSensorsByCenter(toUse, {
            lat: locationLat,
            lon: locationLon,
          });
          setAllSensors(sorted);
          setProgressiveVisibleCount(sorted.length);
          setLocationFetchUsedFallback(usedFallback);
          if (sorted.length > 0) {
            bboxCacheRef.current.set(cacheKey, sorted);
            locationCacheFallbackRef.current.set(cacheKey, usedFallback);
          }
          if (bboxCacheRef.current.size > BBOX_CACHE_MAX_ENTRIES) {
            const firstKey = bboxCacheRef.current.keys().next().value;
            if (firstKey != null) bboxCacheRef.current.delete(firstKey);
          }
        } catch (err) {
          if (myFetchId === fetchIdRef.current) {
            setSensorsError(
              err instanceof Error ? err.message : "Failed to load sensors",
            );
          }
        } finally {
          if (myFetchId === fetchIdRef.current) {
            setLoadingSensors(false);
            setLocationDataReady(true);
            setSensorsLocationKey(`${locationLat}_${locationLon}`);
          }
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
    locationBboxKey,
  ]);

  const filteredByType = useMemo(() => {
    if (locationFetchUsedFallback) return allSensors;
    if (selectedDataTypes.size === 0) return allSensors;
    const sensorTypesToFetch = dataTypesToSensorTypes(selectedDataTypes);
    const filtered = allSensors.filter((s) =>
      sensorTypesToFetch.includes(s.sensor_type),
    );
    return filtered.length > 0 ? filtered : allSensors;
  }, [allSensors, selectedDataTypes, locationFetchUsedFallback]);

  const noMatchForRequestedType =
    allSensors.length > 0 &&
    selectedDataTypes.size > 0 &&
    (() => {
      const st = dataTypesToSensorTypes(selectedDataTypes);
      return allSensors.every((s) => !st.includes(s.sensor_type));
    })();
  const requestedTypeNotAvailable =
    locationFetchUsedFallback || noMatchForRequestedType;

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

  const handleBoundsChange = useCallback(
    (b: Bounds) => {
      // Skip bounds update when in location-search mode to avoid re-render loop:
      // fitBounds -> onMoveEnd -> setBounds -> re-render -> effect re-runs -> fitBounds
      if (hasLocationCoords) return;
      setBounds(b);
    },
    [hasLocationCoords],
  );

  const fitToLocation = useMemo((): Bounds | null => {
    if (!hasLocationCoords || locationLat == null || locationLon == null)
      return null;
    if (
      hasLocationBbox &&
      locationMinLatParam != null &&
      locationMaxLatParam != null &&
      locationMinLonParam != null &&
      locationMaxLonParam != null
    ) {
      return {
        west: parseFloat(locationMinLonParam),
        south: parseFloat(locationMinLatParam),
        east: parseFloat(locationMaxLonParam),
        north: parseFloat(locationMaxLatParam),
      };
    }
    const pad = 0.055;
    return {
      west: locationLon - pad,
      south: locationLat - pad,
      east: locationLon + pad,
      north: locationLat + pad,
    };
  }, [
    hasLocationCoords,
    locationLat,
    locationLon,
    hasLocationBbox,
    locationMinLatParam,
    locationMaxLatParam,
    locationMinLonParam,
    locationMaxLonParam,
  ]);

  // Fit map to location when we navigate, then to all sensors when they load (so user sees all dots)
  const fitToSensorsBounds = useMemo(
    () => (sensorsToShow.length > 0 ? sensorsToBounds(sensorsToShow) : null),
    [sensorsToShow],
  );
  const locationFitKey = hasLocationCoords
    ? `${locationLat}_${locationLon}_${locationBboxKey}`
    : null;
  const lastFittedLocationRef = useRef<string | null>(null);
  const lastFittedSensorsCountRef = useRef(0);
  useEffect(() => {
    if (!locationFitKey) return;
    if (lastFittedLocationRef.current === locationFitKey) return;
    lastFittedLocationRef.current = locationFitKey;
    lastFittedSensorsCountRef.current = 0;
    setFitToSensorsTrigger((t) => t + 1);
  }, [locationFitKey]);
  useEffect(() => {
    if (!hasLocationCoords || sensorsToShow.length === 0) return;
    if (sensorsToShow.length === lastFittedSensorsCountRef.current) return;
    lastFittedSensorsCountRef.current = sensorsToShow.length;
    setFitToSensorsTrigger((t) => t + 1);
  }, [hasLocationCoords, sensorsToShow.length]);

  const clearQueryFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("q")) return;
    params.delete("q");
    const newUrl = `/explorer${params.toString() ? `?${params.toString()}` : ""}`;
    router.replace(newUrl);
  }, [router, searchParams]);

  const handleSearchSubmit = useCallback(
    async (query: string, selectedTypes: Set<string>) => {
      console.log("[ExplorerClient] handleSearchSubmit start", {
        query: query.trim(),
        selectedTypes: [...selectedTypes],
      });
      setIsFindingLocation(true);
      try {
        const q = query.trim();
        let parsed: { location?: string; dataTypeIds: string[] };
        try {
          console.log("[ExplorerClient] calling parse-query API");
          const res = await fetch("/api/parse-query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q || "Show sensors" }),
          });
          parsed = await res.json();
          console.log("[ExplorerClient] parse-query result", parsed);
        } catch (e) {
          console.log("[ExplorerClient] parse-query failed", e);
          parsed = { dataTypeIds: [] };
        }
        const mergedTypes = new Set(selectedTypes);
        for (const id of parsed.dataTypeIds ?? []) {
          if (DATA_TYPE_IDS.has(id)) mergedTypes.add(id);
        }
        const params = new URLSearchParams(searchParams.toString());
        params.delete("q");
        params.delete("type");
        params.delete("sensor");
        params.delete("lat");
        params.delete("lon");
        params.delete("min_lat");
        params.delete("max_lat");
        params.delete("min_lon");
        params.delete("max_lon");
        if (q) params.set("q", q);
        if (mergedTypes.size > 0 && mergedTypes.size < DATA_TYPE_IDS.size) {
          params.set("type", [...mergedTypes].sort().join(","));
        }
        const location = parsed.location?.trim();
        if (location) {
          const tryGeocode = async (loc: string) => {
            const res = await fetch(
              `/api/geocode?q=${encodeURIComponent(loc)}&countrycodes=us`,
            );
            if (!res.ok) return null;
            const data = (await res.json()) as {
              lat?: number;
              lon?: number;
              boundingbox?: {
                south: number;
                north: number;
                west: number;
                east: number;
              };
            } | null;
            return data?.lat != null && data?.lon != null ? data : null;
          };

          let data = await tryGeocode(location);
          if (!data) {
            // Geocoding failed (e.g. typo). Ask LLM to correct the location.
            try {
              const retryRes = await fetch("/api/parse-query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: `sensors in ${location}`,
                }),
              });
              const retryParsed = (await retryRes.json()) as {
                location?: string;
              };
              const correctedLoc = retryParsed.location?.trim();
              if (correctedLoc && correctedLoc !== location) {
                console.log(
                  "[ExplorerClient] retrying geocode with LLM-corrected location",
                  correctedLoc,
                );
                data = await tryGeocode(correctedLoc);
              }
            } catch {
              // LLM correction failed, continue without location
            }
          }

          if (data) {
            console.log("[ExplorerClient] geocode success", {
              lat: data.lat,
              lon: data.lon,
            });
            params.set("lat", String(data.lat));
            params.set("lon", String(data.lon));
            if (data.boundingbox) {
              params.set("min_lat", String(data.boundingbox.south));
              params.set("max_lat", String(data.boundingbox.north));
              params.set("min_lon", String(data.boundingbox.west));
              params.set("max_lon", String(data.boundingbox.east));
            }
          }
        }
        const newUrl = `/explorer${params.toString() ? `?${params.toString()}` : ""}`;
        console.log("[ExplorerClient] router.push", newUrl);
        router.push(newUrl);
      } finally {
        setIsFindingLocation(false);
        console.log("[ExplorerClient] handleSearchSubmit done");
      }
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
          fitToLocation={fitToLocation}
          fitToSensorsBounds={fitToSensorsBounds}
          fitToLocationZoom={12}
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
          onCloseFocus={
            focusSensor
              ? () => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.delete("sensor");
                  router.push(
                    `/explorer${params.toString() ? `?${params.toString()}` : ""}`,
                  );
                }
              : undefined
          }
          sensorCount={sensorsToShow.length}
          loadingSensors={loadingSensors}
          sensorsError={sensorsError}
          sensors={sensorsToShow}
          locationFetchUsedFallback={requestedTypeNotAvailable}
          requestedDataTypes={selectedDataTypes}
          onSearchSubmit={handleSearchSubmit}
          initialSearch={initialSearch}
          hasLocationCoords={hasLocationCoords}
          isFindingLocation={isFindingLocation}
          locationDataReady={locationDataReady}
          sensorsLocationKey={sensorsLocationKey}
          currentLocationKey={
            hasLocationCoords && locationLat != null && locationLon != null
              ? `${locationLat}_${locationLon}`
              : null
          }
          locationBounds={
            hasLocationCoords && locationLat != null && locationLon != null
              ? hasLocationBbox && locationBbox
                ? {
                    west: locationBbox.min_lon,
                    south: locationBbox.min_lat,
                    east: locationBbox.max_lon,
                    north: locationBbox.max_lat,
                  }
                : {
                    west: locationLon - 1,
                    south: locationLat - 1,
                    east: locationLon + 1,
                    north: locationLat + 1,
                  }
              : null
          }
          onInitialSearchConsumed={clearQueryFromUrl}
        />
      </div>
    </div>
  );
}
