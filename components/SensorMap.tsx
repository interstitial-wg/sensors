"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, NavigationControl, Popup } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import type { Sensor } from "@/lib/types";
import type { Bounds } from "@/lib/types";
import SensorHoverCard from "./SensorHoverCard";
import { useTheme } from "@/components/ThemeProvider";

// Carto basemaps – dark for dark mode, light for light mode
// If tiles don’t load, switch back to: https://tile.openstreetmap.org/{z}/{x}/{y}.png
const SENSORS_SOURCE_ID = "sensors";
const SENSORS_LAYER_ID = "sensors-circles";

const EMPTY_GEOJSON: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function buildMapStyle(
  basemapTiles: string[],
  attribution: string,
): Record<string, unknown> {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: basemapTiles,
        tileSize: 256,
        attribution,
      },
      [SENSORS_SOURCE_ID]: {
        type: "geojson",
        data: EMPTY_GEOJSON,
        promoteId: "id",
      },
    },
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        minzoom: 0,
        maxzoom: 20,
      },
      {
        id: SENSORS_LAYER_ID,
        type: "circle",
        source: SENSORS_SOURCE_ID,
        minzoom: 0,
        paint: {
          "circle-radius": 8,
          "circle-color": [
            "match",
            ["get", "sensor_type"],
            "buoy",
            "#0ea5e9",
            "river_sensor",
            "#22c55e",
            "weather_station",
            "#eab308",
            "air_quality_monitor",
            "#a855f7",
            "#64748b",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.95)",
        },
      },
    ],
  };
}

const MAP_STYLE_DARK = buildMapStyle(
  [
    "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
    "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
    "https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
  ],
  "© CARTO © OSM",
);

const MAP_STYLE_LIGHT = buildMapStyle(
  [
    "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
  ],
  "© CARTO © OSM",
);

export interface SensorMapProps {
  sensors: Sensor[];
  onBoundsChange?: (bounds: Bounds) => void;
  /** Increment to trigger fitBounds. When fitToLocation is set, fits to that; else fits to sensors. */
  fitToSensorsTrigger?: number;
  /** When set (e.g. from location search), fit map to this area instead of all sensors. Prevents zoom-out. */
  fitToLocation?: Bounds | null;
  /** When set (sensors loaded from location search), fit to show all sensors. Takes precedence over fitToLocation. */
  fitToSensorsBounds?: Bounds | null;
  /** When set with fitToLocation, use this zoom level. Default 11 (city scale). */
  fitToLocationZoom?: number;
  /** When set, fit map to this sensor and show its popup. Sensor must be in sensors array. */
  focusSensorId?: string | null;
}

export default function SensorMap({
  sensors,
  onBoundsChange,
  fitToSensorsTrigger = 0,
  fitToLocation = null,
  fitToSensorsBounds = null,
  fitToLocationZoom = 11,
  focusSensorId = null,
}: SensorMapProps) {
  const { theme } = useTheme();
  const mapStyle = theme === "light" ? MAP_STYLE_LIGHT : MAP_STYLE_DARK;
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const hasFocusedRef = useRef(false);
  const [hoveredSensor, setHoveredSensor] = useState<Sensor | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const withCoords = useMemo(
    () =>
      sensors.filter(
        (s): s is Sensor & { latitude: number; longitude: number } =>
          s.latitude != null && s.longitude != null,
      ),
    [sensors],
  );

  const geojson = useMemo<FeatureCollection>(() => {
    const features = withCoords.map((s) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [s.longitude, s.latitude],
      },
      properties: {
        id: s.id,
        sensor_type: s.sensor_type,
        name: s.name,
      },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [withCoords]);

  const geojsonRef = useRef<FeatureCollection | null>(null);
  geojsonRef.current = geojson;

  // Reset mapReady when Map remounts (key changes for new city) so we retry setData
  const mapKey = fitToLocation ? `loc-${fitToLocation.west}-${fitToLocation.south}` : "default";
  useEffect(() => {
    setMapReady(false);
  }, [mapKey]);

  // Update source data when geojson changes. Retry when mapReady becomes true (map loaded).
  useEffect(() => {
    if (geojson.features.length === 0) return;
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const src = map.getSource(SENSORS_SOURCE_ID) as
      | { setData: (d: FeatureCollection) => void }
      | undefined;
    if (src?.setData) {
      src.setData(geojson);
      map.once("idle", () => {
        if (typeof map.triggerRepaint === "function") map.triggerRepaint();
        map.resize();
      });
    }
  }, [geojson, mapReady]);

  const sensorsById = useMemo(() => {
    const byId: Record<string, Sensor> = {};
    sensors.forEach((s) => (byId[s.id] = s));
    return byId;
  }, [sensors]);

  // Force map repaint when sensors load — fixes dots not appearing until console/layout triggers reflow
  useEffect(() => {
    if (withCoords.length === 0) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let raf2Id: number | null = null;
    const raf1Id = requestAnimationFrame(() => {
      raf2Id = requestAnimationFrame(() => {
        if (typeof map.triggerRepaint === "function") {
          map.triggerRepaint();
        }
        map.resize();
      });
    });
    return () => {
      cancelAnimationFrame(raf1Id);
      if (raf2Id != null) cancelAnimationFrame(raf2Id);
    };
  }, [withCoords.length]);

  // ResizeObserver: when container resizes (e.g. dev tools open/close), force map resize + repaint
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const container = map.getContainer?.();
    if (!container) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        map.resize();
        if (typeof map.triggerRepaint === "function") {
          map.triggerRepaint();
        }
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [mapReady]);

  // Periodic repaint for first 3s after sensors load — works around MapLibre not rendering until layout reflow
  useEffect(() => {
    if (withCoords.length === 0) return;
    const repaint = () => {
      const m = mapRef.current?.getMap();
      if (!m) return;
      const container = m.getContainer?.();
      if (container) {
        // Force layout recalculation — some browsers need this for WebGL to render
        void container.offsetHeight;
      }
      m.resize();
      if (typeof m.triggerRepaint === "function") m.triggerRepaint();
    };
    const interval = setInterval(repaint, 100);
    const timeout = setTimeout(() => clearInterval(interval), 3000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [withCoords.length]);

  // Window resize listener — repaint when viewport changes (e.g. dev tools open/close)
  useEffect(() => {
    if (!mapReady) return;
    const repaint = () => {
      const m = mapRef.current?.getMap();
      if (m) {
        m.resize();
        if (typeof m.triggerRepaint === "function") m.triggerRepaint();
      }
    };
    window.addEventListener("resize", repaint);
    return () => window.removeEventListener("resize", repaint);
  }, [mapReady]);

  const handleLoad = useCallback(() => {
    setMapReady(true);
    const map = mapRef.current?.getMap();
    if (!map || typeof map.getBounds !== "function") return;
    // Fit to city immediately when map loads with location in URL (e.g. after search from home)
    if (fitToLocation && typeof map.fitBounds === "function") {
      map.fitBounds(
        [
          [fitToLocation.west, fitToLocation.south],
          [fitToLocation.east, fitToLocation.north],
        ],
        { padding: 48, maxZoom: fitToLocationZoom, duration: 250 },
      );
    }
    // Set source data on load if we have features (fixes race: sensors arrived before map ready)
    const gj = geojsonRef.current;
    if (gj?.features?.length && gj.features.length > 0) {
      const src = map.getSource(SENSORS_SOURCE_ID) as
        | { setData?: (d: FeatureCollection) => void }
        | undefined;
      if (src?.setData) {
        src.setData(gj);
        map.once("idle", () => {
          if (typeof map.triggerRepaint === "function") map.triggerRepaint();
          map.resize();
        });
      }
    }
    const b = map.getBounds();
    onBoundsChange?.({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    });
    // Force initial resize + repaint — use multiple delays to catch late layout
    const repaint = () => {
      map.resize();
      if (typeof map.triggerRepaint === "function") map.triggerRepaint();
    };
    requestAnimationFrame(repaint);
    setTimeout(repaint, 100);
    setTimeout(repaint, 500);
    setTimeout(repaint, 1000);
  }, [onBoundsChange, fitToLocation, fitToLocationZoom]);

  const handleMoveEnd = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || typeof map.getBounds !== "function") return;
    const b = map.getBounds();
    onBoundsChange?.({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    });
  }, [onBoundsChange]);

  const handleMapClick = useCallback(
    (evt: { point: { x: number; y: number }; defaultPrevented?: boolean }) => {
      if (evt.defaultPrevented) return;
      const map = mapRef.current?.getMap();
      if (!map) return;
      const point = [evt.point.x, evt.point.y] as [number, number];
      const features = map.queryRenderedFeatures(point, {
        layers: [SENSORS_LAYER_ID],
      });
      const feature = features[0];
      if (!feature?.properties?.id) {
        setSelectedSensor(null);
        setHoveredSensor(null);
        return;
      }
      const id = feature.properties.id as string;
      const sensor = sensorsById[id] ?? null;
      setSelectedSensor(sensor);
      setHoveredSensor(sensor);
    },
    [sensorsById],
  );

  const handleMouseMove = useCallback(
    (evt: {
      point: { x: number; y: number };
      features?: { properties?: { id?: string } }[];
    }) => {
      const features = evt.features;
      if (!features?.length) {
        setHoveredSensor(null);
        return;
      }
      const feature = features[0];
      const id = feature?.properties?.id as string | undefined;
      if (!id) {
        setHoveredSensor(null);
        return;
      }
      const sensor = sensorsById[id] ?? null;
      setHoveredSensor(sensor);
    },
    [sensorsById],
  );

  // Show pointer cursor when hovering over a sensor, grab otherwise
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const canvas = map.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = hoveredSensor ? "pointer" : "grab";
  }, [hoveredSensor]);

  // Fit map when parent triggers or when fitToLocation changes (e.g. new city search).
  const lastFittedTriggerRef = useRef(0);
  const lastFittedLocationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map || typeof map.fitBounds !== "function") return;

    const scheduleRepaintAfterFit = () => {
      map.once("idle", () => {
        if (typeof map.triggerRepaint === "function") map.triggerRepaint();
        map.resize();
      });
    };

    // When we have fitToLocation (location search), fit when trigger fires OR when location changes
    if (fitToLocation) {
      const locationKey = `${fitToLocation.west}_${fitToLocation.south}_${fitToLocation.east}_${fitToLocation.north}`;
      const triggerChanged = fitToSensorsTrigger > 0 && lastFittedTriggerRef.current !== fitToSensorsTrigger;
      const locationChanged = lastFittedLocationKeyRef.current !== locationKey;
      if (!triggerChanged && !locationChanged) return;
      if (triggerChanged) lastFittedTriggerRef.current = fitToSensorsTrigger;
      if (locationChanged) lastFittedLocationKeyRef.current = locationKey;

      map.fitBounds(
        [
          [fitToLocation.west, fitToLocation.south],
          [fitToLocation.east, fitToLocation.north],
        ],
        { padding: 48, maxZoom: fitToLocationZoom, duration: 250 },
      );
      scheduleRepaintAfterFit();
      return;
    }

    // No location search — only fit when trigger fires
    if (fitToSensorsTrigger <= 0) return;
    if (lastFittedTriggerRef.current === fitToSensorsTrigger) return;
    lastFittedTriggerRef.current = fitToSensorsTrigger;

    if (fitToSensorsBounds) {
      map.fitBounds(
        [
          [fitToSensorsBounds.west, fitToSensorsBounds.south],
          [fitToSensorsBounds.east, fitToSensorsBounds.north],
        ],
        { padding: 48, maxZoom: 14, duration: 250 },
      );
      scheduleRepaintAfterFit();
      return;
    }

    if (withCoords.length === 0) return;
    const lngs = withCoords.map((s) => s.longitude);
    const lats = withCoords.map((s) => s.latitude);
    const west = Math.min(...lngs);
    const east = Math.max(...lngs);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 48, maxZoom: 12, duration: 250 },
    );
    scheduleRepaintAfterFit();
  }, [
    fitToSensorsTrigger,
    withCoords,
    fitToLocation,
    fitToSensorsBounds,
    fitToLocationZoom,
    mapReady,
  ]);

  // Fit map to and select a specific sensor (e.g. from ?sensor=id in URL)
  useEffect(() => {
    if (!focusSensorId || hasFocusedRef.current) return;
    const sensor = sensorsById[focusSensorId];
    if (!sensor?.latitude || !sensor?.longitude) return;
    const map = mapRef.current?.getMap();
    if (!map || typeof map.fitBounds !== "function") return;
    hasFocusedRef.current = true;
    const pad = 0.02;
    map.fitBounds(
      [
        [sensor.longitude - pad, sensor.latitude - pad],
        [sensor.longitude + pad, sensor.latitude + pad],
      ],
      { padding: 48, maxZoom: 14, duration: 250 },
    );
    setSelectedSensor(sensor);
    setHoveredSensor(sensor);
  }, [focusSensorId, sensorsById]);

  // When we have fitToLocation, start the map centered on the city (fixes map not moving on search)
  const initialViewState = useMemo(() => {
    if (fitToLocation) {
      const lon = (fitToLocation.west + fitToLocation.east) / 2;
      const lat = (fitToLocation.south + fitToLocation.north) / 2;
      return { longitude: lon, latitude: lat, zoom: fitToLocationZoom, pitch: 0, bearing: 0 };
    }
    return { longitude: -122.27, latitude: 37.8, zoom: 8, pitch: 0, bearing: 0 };
  }, [fitToLocation, fitToLocationZoom]);

  return (
    <div
      ref={containerRef}
      className="sensor-map-minimal relative h-full w-full"
    >
      <Map
        key={fitToLocation ? `loc-${fitToLocation.west}-${fitToLocation.south}` : "default"}
        ref={mapRef}
        projection="mercator"
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle as import("maplibre-gl").StyleSpecification}
        styleDiffing={false}
        onLoad={handleLoad}
        onMoveEnd={handleMoveEnd}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSensor(null)}
        interactiveLayerIds={[SENSORS_LAYER_ID]}
      >
        <NavigationControl
          position="top-right"
          showCompass={true}
          showZoom={true}
        />
        {/* Sensors source + layer embedded in map style; we update via setData */}
        {selectedSensor && (
          <Layer
            id="sensors-selected-highlight"
            source={SENSORS_SOURCE_ID}
            type="circle"
            filter={["==", ["get", "id"], selectedSensor.id]}
            paint={{
              "circle-radius": 7,
              "circle-color": "#9ab07f",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            }}
          />
        )}
        {selectedSensor &&
          selectedSensor.latitude != null &&
          selectedSensor.longitude != null && (
            <Popup
              longitude={selectedSensor.longitude}
              latitude={selectedSensor.latitude}
              onClose={() => setSelectedSensor(null)}
              closeButton
              closeOnClick={false}
              className="sensor-map-popup-minimal"
            >
              <div className="min-w-[100px] min-h-[32px]" aria-hidden />
            </Popup>
          )}
      </Map>
      {/* Card anchored to right: hover preview or full details when selected */}
      {(hoveredSensor || selectedSensor) && (
        <div className="absolute bottom-20 right-4 z-20">
          <SensorHoverCard
            key={(selectedSensor ?? hoveredSensor)!.id}
            sensor={selectedSensor ?? hoveredSensor!}
            shouldFetchReading={selectedSensor != null}
          />
        </div>
      )}
    </div>
  );
}
