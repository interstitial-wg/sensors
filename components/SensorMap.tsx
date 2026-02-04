"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  Layer,
  NavigationControl,
  Popup,
  Source,
} from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import type { Sensor } from "@/lib/types";
import type { Bounds } from "@/lib/types";
import SensorHoverCard from "./SensorHoverCard";
import { useTheme } from "@/components/ThemeProvider";

// Carto basemaps – dark for dark mode, light for light mode
// If tiles don’t load, switch back to: https://tile.openstreetmap.org/{z}/{x}/{y}.png
const MAP_STYLE_DARK = {
  version: 8 as const,
  sources: {
    basemap: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© CARTO © OSM",
    },
  },
  layers: [
    {
      id: "basemap",
      type: "raster" as const,
      source: "basemap",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const MAP_STYLE_LIGHT = {
  version: 8 as const,
  sources: {
    basemap: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© CARTO © OSM",
    },
  },
  layers: [
    {
      id: "basemap",
      type: "raster" as const,
      source: "basemap",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const SENSOR_TYPE_COLORS: Record<string, string> = {
  buoy: "#0ea5e9",
  river_sensor: "#22c55e",
  weather_station: "#eab308",
  air_quality_monitor: "#a855f7",
};

/** MapLibre expression: color by sensor_type property, fallback #64748b */
const CIRCLE_COLOR_EXPR: unknown = [
  "match",
  ["get", "sensor_type"],
  "buoy",
  SENSOR_TYPE_COLORS.buoy,
  "river_sensor",
  SENSOR_TYPE_COLORS.river_sensor,
  "weather_station",
  SENSOR_TYPE_COLORS.weather_station,
  "air_quality_monitor",
  SENSOR_TYPE_COLORS.air_quality_monitor,
  "#64748b",
];

const SENSORS_SOURCE_ID = "sensors";
const SENSORS_LAYER_ID = "sensors-circles";

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
  const mapRef = useRef<MapRef | null>(null);

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

  const sensorsById = useMemo(() => {
    const byId: Record<string, Sensor> = {};
    sensors.forEach((s) => (byId[s.id] = s));
    return byId;
  }, [sensors]);

  const handleLoad = useCallback(() => {
    // Use ref for reliability; evt.target may differ across react-map-gl versions
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

  // Fit map when parent triggers. Prefer sensor bounds (show all) over location when sensors are loaded.
  const lastFittedTriggerRef = useRef(0);
  useEffect(() => {
    if (fitToSensorsTrigger <= 0) return;
    const map = mapRef.current?.getMap();
    if (!map || typeof map.fitBounds !== "function") return;

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
      return;
    }

    if (fitToLocation) {
      map.fitBounds(
        [
          [fitToLocation.west, fitToLocation.south],
          [fitToLocation.east, fitToLocation.north],
        ],
        { padding: 48, maxZoom: fitToLocationZoom, duration: 250 },
      );
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
  }, [
    fitToSensorsTrigger,
    withCoords,
    fitToLocation,
    fitToSensorsBounds,
    fitToLocationZoom,
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

  return (
    <div className="sensor-map-minimal relative h-full w-full">
      <Map
        ref={mapRef}
        projection="mercator"
        initialViewState={{
          longitude: -122.27,
          latitude: 37.8,
          zoom: 8,
          pitch: 0,
          bearing: 0,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
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
        <Source id={SENSORS_SOURCE_ID} type="geojson" data={geojson}>
          <Layer
            id={SENSORS_LAYER_ID}
            type="circle"
            paint={{
              "circle-radius": 5,
              "circle-color": CIRCLE_COLOR_EXPR as string,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.9)",
            }}
          />
          {/* Highlighted dot for selected/focused sensor - uses site green (#9ab07f) */}
          {selectedSensor && (
            <Layer
              id="sensors-selected-highlight"
              type="circle"
              filter={["==", ["get", "id"], selectedSensor.id]}
              paint={{
                "circle-radius": 10,
                "circle-color": "#9ab07f",
                "circle-stroke-width": 3,
                "circle-stroke-color": "#ffffff",
              }}
            />
          )}
        </Source>
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
