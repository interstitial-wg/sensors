import type { Bounds } from "./types";
import type { Sensor } from "./types";

/** Normalize longitude to [-180, 180]. MapLibre can return e.g. -193 for 167°E. */
export function normalizeLongitude(lon: number): number {
  let l = lon;
  while (l < -180) l += 360;
  while (l > 180) l -= 360;
  return l;
}

/**
 * Normalize bounds so west/east are in [-180, 180].
 * When the map returns west=-193 (167°E) and east=-101, we get west=167, east=-101 so west > east and we detect crossing.
 */
export function normalizeBounds(bounds: Bounds): Bounds {
  return {
    west: normalizeLongitude(bounds.west),
    east: normalizeLongitude(bounds.east),
    south: bounds.south,
    north: bounds.north,
  };
}

/**
 * True when viewport spans the International Date Line (Pacific wrap).
 * Handles: west > east (e.g. 170, -170), span > 180° (e.g. -120, 120), or raw map bounds with west < -180 (e.g. -193, -101).
 * Call normalizeBounds(bounds) first so west=-193 becomes 167 and we get west > east.
 */
export function boundsCrossDateline(bounds: Bounds): boolean {
  if (bounds.west > bounds.east) return true;
  const span = bounds.east - bounds.west;
  return span > 180;
}

/** Longitude threshold: when view touches within this many degrees of ±180°, also fetch a strip on the other side so buoys don’t disappear at the boundary. */
const DATELINE_OVERLAP_DEG = 15;

/**
 * Split bounds into 1 or 2 (sometimes 3) segments for API bbox requests.
 * - Full world (west=180, east=-180): single segment [-180, 180] so degenerate [180,180]/[-180,-180] don't wipe the map.
 * - When view crosses the dateline: two segments (both sides).
 * - When view does not cross but touches the dateline (west <= -165 or east >= 165): main segment + a small strip on the other side so panning past 50% doesn’t make buoys on the other side disappear.
 */
/** When zoomed all the way out the map can report west=180, east=-180, giving zero-width segments; treat as full world. */
function isFullWorldBounds(bounds: Bounds): boolean {
  if (!boundsCrossDateline(bounds)) return bounds.east - bounds.west >= 360 - 1e-6;
  return Math.abs(bounds.west - 180) < 1e-6 && Math.abs(bounds.east + 180) < 1e-6;
}

/** Split full-world into two hemispheres so we don't hit the API cap and get only Americas/Europe or only Asia. */
function fullWorldSegments(bounds: Bounds): Bounds[] {
  return [
    { west: -180, south: bounds.south, east: 0, north: bounds.north },
    { west: 0, south: bounds.south, east: 180, north: bounds.north },
  ];
}

export function boundsToFetchSegments(bounds: Bounds): Bounds[] {
  if (isFullWorldBounds(bounds)) {
    return fullWorldSegments(bounds);
  }
  if (boundsCrossDateline(bounds)) {
    return [
      { west: bounds.west, south: bounds.south, east: 180, north: bounds.north },
      { west: -180, south: bounds.south, east: bounds.east, north: bounds.north },
    ];
  }
  const main: Bounds[] = [bounds];
  if (bounds.west <= -180 + DATELINE_OVERLAP_DEG) {
    main.push({
      west: 180 - DATELINE_OVERLAP_DEG,
      south: bounds.south,
      east: 180,
      north: bounds.north,
    });
  }
  if (bounds.east >= 180 - DATELINE_OVERLAP_DEG) {
    main.push({
      west: -180,
      south: bounds.south,
      east: -180 + DATELINE_OVERLAP_DEG,
      north: bounds.north,
    });
  }
  return main;
}

/** Expand bounds by a margin (e.g. 0.15 = 15% on each side). Handles dateline crossing. */
export function expandBounds(bounds: Bounds, margin: number): Bounds {
  const h = bounds.north - bounds.south;
  const half = margin / 2;

  if (boundsCrossDateline(bounds)) {
    // Two segments: [west, 180] and [-180, east]. Expand each side.
    const w1 = 180 - bounds.west;
    const w2 = bounds.east - -180;
    return {
      west: bounds.west - w1 * half,
      east: bounds.east + w2 * half,
      south: bounds.south - h * half,
      north: bounds.north + h * half,
    };
  }

  const w = bounds.east - bounds.west;
  return {
    west: bounds.west - w * half,
    east: bounds.east + w * half,
    south: bounds.south - h * half,
    north: bounds.north + h * half,
  };
}

/** True if inner is fully inside outer. Handles dateline crossing. */
export function boundsContained(inner: Bounds, outer: Bounds): boolean {
  if (inner.south < outer.south || inner.north > outer.north) return false;

  // When outer crosses in normalized form (west < east, span > 180), the two bands
  // [outer.west, 180] and [-180, outer.east] cover the whole world, so we'd always
  // say "contained" and skip refetch. Panning then keeps stale data and dots disappear.
  // So never skip refetch for that case: treat as not contained.
  if (boundsCrossDateline(outer) && outer.west < outer.east) return false;

  if (boundsCrossDateline(outer)) {
    if (boundsCrossDateline(inner)) {
      return inner.west >= outer.west && inner.east <= outer.east;
    }
    return (
      (inner.west >= outer.west && inner.east <= 180) ||
      (inner.west >= -180 && inner.east <= outer.east)
    );
  }
  if (boundsCrossDateline(inner)) {
    return outer.west <= inner.west && outer.east >= inner.east;
  }
  return inner.west >= outer.west && inner.east <= outer.east;
}

/** Squared distance in lat/lon space (avoids sqrt). Use for ordering only. */
function distSq(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dlat = lat1 - lat2;
  const dlon = lon1 - lon2;
  return dlat * dlat + dlon * dlon;
}

/** Viewport center from bounds. Handles dateline crossing (Pacific center ≈ ±180). */
export function centerFromBounds(bounds: Bounds): { lat: number; lon: number } {
  let lon: number;
  if (boundsCrossDateline(bounds)) {
    // Visual center is midpoint along the wrap: west toward 180, then -180 toward east.
    lon = (bounds.west + bounds.east + 360) / 2;
    if (lon > 180) lon -= 360;
  } else {
    lon = (bounds.west + bounds.east) / 2;
  }
  return {
    lat: (bounds.south + bounds.north) / 2,
    lon,
  };
}

/** Bounds that encompass all sensors with coordinates. Returns null if none have coords. */
export function sensorsToBounds(sensors: Sensor[]): Bounds | null {
  const withCoords = sensors.filter(
    (s): s is Sensor & { latitude: number; longitude: number } =>
      s.latitude != null && s.longitude != null,
  );
  if (withCoords.length === 0) return null;
  const lngs = withCoords.map((s) => s.longitude);
  const lats = withCoords.map((s) => s.latitude);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

/** Sort sensors by distance from center (nearest first). Only sensors with coords are ordered; others go to the end. */
export function sortSensorsByCenter(
  sensors: Sensor[],
  center: { lat: number; lon: number }
): Sensor[] {
  const withCoords = sensors.filter(
    (s): s is Sensor & { latitude: number; longitude: number } =>
      s.latitude != null && s.longitude != null
  );
  const withoutCoords = sensors.filter(
    (s) => s.latitude == null || s.longitude == null
  );
  withCoords.sort((a, b) => {
    const da = distSq(a.latitude, a.longitude, center.lat, center.lon);
    const db = distSq(b.latitude, b.longitude, center.lat, center.lon);
    return da - db;
  });
  return [...withCoords, ...withoutCoords];
}
