"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSensors, getLatestReading } from "@/lib/sensors-api";
import type { Sensor } from "@/lib/types";
import type { LatestReadingResponse } from "@/lib/sensors-api";

const BATCH_SIZE = 15;
const BATCH_INTERVAL_S = 0.12;
const REVEAL_DURATION_S = 1.4;

/** Fisher-Yates shuffle - returns new shuffled array */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Dot states: base (subtle), solid (filled white), hollow (outlined white), green */
type DotState = "base" | "solid" | "hollow" | "green";

const DOT_SIZE = 24;
const GAP = 12; // padding between dots
const CELL_SIZE = DOT_SIZE + GAP; // 36px per cell
const MAX_ROWS = 40;
const MAX_COLS = 32;

/** ~8% of base dots get a subtle accent (lavender or green) - drifts over time via phase */
const ACCENT_CHANCE = 0.08;
const ACCENT_COLORS = [
  "rgba(208, 200, 232, 0.7)", // lavender
  "rgba(154, 176, 127, 0.7)", // sage green
  "rgba(168, 196, 168, 0.65)", // softer green
] as const;
const ACCENT_DRIFT_INTERVAL_MS = 2800;

/** Scattered hash - avoids linear/diagonal patterns from simple r+c or r*7+c*13 */
function scatterHash(r: number, c: number, phase: number): number {
  let h = r * 374761393 + c * 668265263 + phase * 1274126177;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function getBaseDotColor(r: number, c: number, phase: number): string {
  const h = scatterHash(r, c, phase);
  if (h % 100 >= ACCENT_CHANCE * 100) return "rgba(80, 80, 80, 0.6)";
  const idx = h % ACCENT_COLORS.length;
  return ACCENT_COLORS[idx];
}

/** Format measurement key for display */
function formatKey(key: string): string {
  const known: Record<string, string> = {
    pm2_5_ug_per_m3: "PM2.5",
    pm10_ug_per_m3: "PM10",
    air_temperature_c: "Temp",
    relative_humidity_percent: "Humidity",
    wind_speed_mps: "Wind",
    water_temperature_c: "Water temp",
    wave_height_m: "Wave ht",
    dissolved_oxygen_mg_per_l: "DO",
    turbidity_ntu: "Turbidity",
    aqi: "AQI",
  };
  return known[key] ?? key.replace(/_/g, " ");
}

function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return String(value);
}

/** Exported for footer alignment: grid width = cols * DOT_SIZE + (cols - 1) * GAP */
export const DOT_GRID_CELL_SIZE = CELL_SIZE;

interface DotGridProps {
  rows?: number;
  cols?: number;
  /** Map of "row,col" -> state. Unset cells use "base". */
  pattern?: Record<string, DotState>;
  className?: string;
  /** Enable twinkle animation on dots */
  twinkle?: boolean;
  /** Fill container - compute rows/cols from available space (overrides rows/cols) */
  fill?: boolean;
  /** Called when dimensions change (fill mode). Use to align footer with grid width. */
  onDimensionsChange?: (d: {
    cols: number;
    rows: number;
    widthPx: number;
  }) => void;
}

/** Memoized dot - only re-renders when its props change (e.g. isHovered, isClicked) */
const Dot = React.memo(function Dot({
  r,
  c,
  state,
  isHovered,
  isClicked,
  twinkle,
  fill,
  batchPosition,
  dotSize,
  sensorName,
  onDotClick,
  accentPhase,
}: {
  r: number;
  c: number;
  state: DotState;
  isHovered: boolean;
  isClicked: boolean;
  twinkle: boolean;
  fill: boolean;
  batchPosition: number;
  dotSize: number;
  sensorName?: string | null;
  onDotClick: (r: number, c: number, e: React.MouseEvent) => void;
  accentPhase: number;
}) {
  const batchIndex = Math.floor(batchPosition / BATCH_SIZE);
  const revealDelay = twinkle ? batchIndex * BATCH_INTERVAL_S : 0;
  const twinkleDelay = twinkle ? ((r * 7 + c * 11) % 20) / 10 : 0;
  const showOutline = !isClicked && state === "hollow";

  const bgColor = isClicked
    ? "#ffffff"
    : state === "base"
      ? getBaseDotColor(r, c, accentPhase)
      : state === "solid"
        ? "#ffffff"
        : state === "green"
          ? "#a0c4a0"
          : "transparent";

  return (
    <div
      data-row={r}
      data-col={c}
      role={twinkle && fill ? "button" : undefined}
      tabIndex={twinkle && fill ? 0 : undefined}
      title={sensorName ?? undefined}
      className={`dot-cell rounded-full ${twinkle && !isHovered && !isClicked ? "animate-dot-reveal-twinkle" : ""} ${twinkle && (isHovered || isClicked) ? "dot-no-twinkle" : ""} ${twinkle && fill ? "cursor-pointer" : ""} ${isClicked ? "dot-clicked" : ""}`}
      style={{
        width: dotSize,
        height: dotSize,
        backgroundColor: bgColor,
        border: showOutline ? "1.5px solid var(--dot-outline)" : "none",
        boxSizing: "border-box",
        animationDelay:
          twinkle && !isHovered && !isClicked
            ? `${revealDelay}s, ${REVEAL_DURATION_S + revealDelay + twinkleDelay}s`
            : undefined,
      }}
      onClick={
        twinkle && fill
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onDotClick(r, c, e);
            }
          : undefined
      }
    />
  );
});

function buildPatternMap(
  _rows: number,
  _cols: number,
  custom?: Record<string, DotState>,
): Record<string, DotState> {
  return { ...custom };
}

export default function DotGrid({
  rows: rowsProp = 12,
  cols: colsProp = 28,
  pattern: customPattern,
  className = "",
  twinkle = false,
  fill = false,
  onDimensionsChange,
}: DotGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const prevNeighborsRef = useRef<Set<string>>(new Set());
  const dimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  const [dimensions, setDimensions] = useState<{
    rows: number;
    cols: number;
  } | null>(fill ? null : { rows: rowsProp, cols: colsProp });
  const [accentPhase, setAccentPhase] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setAccentPhase((p) => p + 1),
      ACCENT_DRIFT_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!fill || !containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const cols = Math.min(MAX_COLS, Math.max(1, Math.floor(w / CELL_SIZE)));
      const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(h / CELL_SIZE)));
      const d = { cols, rows };
      dimensionsRef.current = d;
      setDimensions(d);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  // Report actual grid width from the rendered grid element for footer alignment
  useEffect(() => {
    if (!fill || !onDimensionsChange || !gridRef.current || !dimensions) return;
    const gridEl = gridRef.current;
    const report = () => {
      const widthPx = gridEl.offsetWidth;
      const d = dimensionsRef.current;
      if (d) onDimensionsChange({ cols: d.cols, rows: d.rows, widthPx });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(gridEl);
    return () => ro.disconnect();
  }, [fill, onDimensionsChange, dimensions]);

  const rows = dimensions?.rows ?? rowsProp;
  const cols = dimensions?.cols ?? colsProp;
  const patternMap = buildPatternMap(rows, cols, customPattern);
  const total = rows * cols;

  const loadOrderMap = useMemo(() => {
    if (!twinkle || total === 0) return null;
    const indices = Array.from({ length: total }, (_, i) => i);
    const shuffled = shuffle(indices);
    const order = new Array<number>(total);
    shuffled.forEach((idx, batchPosition) => {
      order[idx] = batchPosition;
    });
    return order;
  }, [twinkle, total]);

  // Fetch sensors for dot-sensor mapping (when fill + twinkle)
  const [sensors, setSensors] = useState<Sensor[]>([]);
  useEffect(() => {
    if (!fill || !twinkle) return;
    let cancelled = false;
    getSensors({ limit: 200 })
      .then((res) => {
        if (!cancelled && res.sensors.length > 0) setSensors(res.sensors);
      })
      .catch(() => {
        if (!cancelled) setSensors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fill, twinkle]);

  // Hover/click state and tooltip
  const [hoveredDot, setHoveredDot] = useState<{ r: number; c: number } | null>(
    null,
  );
  const [clickedDot, setClickedDot] = useState<{
    r: number;
    c: number;
    sensor: Sensor;
  } | null>(null);
  const [reading, setReading] = useState<LatestReadingResponse | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{
    x: number;
    y: number;
    /** When true, tooltip is positioned to the left of the dot (for right-edge dots) */
    preferLeft?: boolean;
  } | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);

  // Click away: clear clicked tooltip when clicking outside the grid
  useEffect(() => {
    if (!clickedDot || !containerRef.current) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setClickedDot(null);
        setReading(null);
        setTooltipAnchor(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clickedDot]);

  const getSensorForDot = useCallback(
    (r: number, c: number): Sensor | null => {
      if (sensors.length === 0) return null;
      const idx = (r * cols + c) % sensors.length;
      return sensors[idx] ?? null;
    },
    [sensors, cols],
  );

  // Event delegation: direct DOM for neighbors (instant), React for tooltip
  const handleGridPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      const r = target.dataset?.row;
      const c = target.dataset?.col;
      if (r == null || c == null) return;
      const nr = parseInt(r, 10);
      const nc = parseInt(c, 10);

      // Direct DOM: neighbor effect (bypasses React for instant feedback)
      if (gridRef.current) {
        const nextNeighbors = new Set<string>();
        for (const [dr, dc] of [
          [nr - 1, nc],
          [nr + 1, nc],
          [nr, nc - 1],
          [nr, nc + 1],
        ]) {
          nextNeighbors.add(`${dr},${dc}`);
        }
        for (const key of prevNeighborsRef.current) {
          if (!nextNeighbors.has(key)) {
            const el = gridRef.current.querySelector(
              `[data-row="${key.split(",")[0]}"][data-col="${key.split(",")[1]}"]`,
            );
            el?.classList.remove("dot-neighbor");
          }
        }
        for (const key of nextNeighbors) {
          const el = gridRef.current.querySelector(
            `[data-row="${key.split(",")[0]}"][data-col="${key.split(",")[1]}"]`,
          );
          el?.classList.add("dot-neighbor");
        }
        prevNeighborsRef.current = nextNeighbors;
      }

      setHoveredDot((prev) =>
        prev?.r === nr && prev?.c === nc ? prev : { r: nr, c: nc },
      );
      if (!clickedDot) {
        const rect = target.getBoundingClientRect();
        const tooltipWidthRight = 360;
        const padding = 16;
        const fitsRight =
          rect.right + 8 + tooltipWidthRight + padding <=
          (typeof window !== "undefined" ? window.innerWidth : 1920);
        setTooltipAnchor(
          fitsRight
            ? { x: rect.right + 8, y: rect.top }
            : { x: rect.left, y: rect.top, preferLeft: true },
        );
      }
    },
    [clickedDot],
  );
  const handleGridPointerLeave = useCallback(() => {
    if (gridRef.current) {
      for (const key of prevNeighborsRef.current) {
        const [r, c] = key.split(",");
        const el = gridRef.current.querySelector(
          `[data-row="${r}"][data-col="${c}"]`,
        );
        el?.classList.remove("dot-neighbor");
      }
      prevNeighborsRef.current = new Set();
    }
    setHoveredDot(null);
    if (!clickedDot) setTooltipAnchor(null);
  }, [clickedDot]);

  const handleDotClick = useCallback(
    (r: number, c: number, e: React.MouseEvent) => {
      const sensor = getSensorForDot(r, c);
      if (!sensor) return;
      if (clickedDot?.r === r && clickedDot?.c === c) {
        setClickedDot(null);
        setReading(null);
        setTooltipAnchor(null);
        return;
      }
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const tooltipWidthRight = 360;
      const padding = 16;
      const fitsRight =
        rect.right + 8 + tooltipWidthRight + padding <=
        (typeof window !== "undefined" ? window.innerWidth : 1920);
      setTooltipAnchor(
        fitsRight
          ? { x: rect.right + 8, y: rect.top }
          : { x: rect.left, y: rect.top, preferLeft: true },
      );
      setClickedDot({ r, c, sensor });
      setReading(null);
      setReadingLoading(true);
      getLatestReading(sensor.id)
        .then((res) => {
          setReading(res ?? null);
        })
        .catch(() => setReading(null))
        .finally(() => setReadingLoading(false));
    },
    [getSensorForDot, clickedDot],
  );

  const grid = (
    <div
      ref={gridRef}
      className={`dot-grid-container grid ${className}`}
      style={{
        gap: GAP,
        gridTemplateRows: `repeat(${rows}, ${DOT_SIZE}px)`,
        gridTemplateColumns: `repeat(${cols}, ${DOT_SIZE}px)`,
        ...(fill && { marginLeft: "auto" }),
      }}
      onPointerMove={twinkle && fill ? handleGridPointerMove : undefined}
      onPointerLeave={twinkle && fill ? handleGridPointerLeave : undefined}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const key = `${r},${c}`;
        const state = patternMap[key] ?? "base";
        const batchPosition = loadOrderMap?.[i] ?? 0;
        const isHovered = hoveredDot?.r === r && hoveredDot?.c === c;
        const isClicked = clickedDot?.r === r && clickedDot?.c === c;

        const sensor = getSensorForDot(r, c);
        return (
          <Dot
            key={key}
            r={r}
            c={c}
            state={state}
            isHovered={isHovered}
            isClicked={isClicked}
            twinkle={twinkle}
            fill={fill}
            batchPosition={batchPosition}
            dotSize={DOT_SIZE}
            sensorName={sensor?.name}
            onDotClick={handleDotClick}
            accentPhase={accentPhase}
          />
        );
      })}
    </div>
  );

  const activeSensor =
    clickedDot?.sensor ??
    (hoveredDot ? getSensorForDot(hoveredDot.r, hoveredDot.c) : null);
  const showTooltip = twinkle && fill && activeSensor && tooltipAnchor;

  if (fill) {
    return (
      <div ref={containerRef} className="relative h-full w-full">
        {dimensions && (
          <>
            {grid}
            {showTooltip && tooltipAnchor && (
              <div
                className={`dot-grid-tooltip-pill fixed z-50 flex flex-col gap-1.5${!tooltipAnchor.preferLeft ? " dot-grid-tooltip-pill--right" : ""}`}
                style={{
                  left: tooltipAnchor.x,
                  top: tooltipAnchor.y,
                  transform: tooltipAnchor.preferLeft
                    ? "translateX(-100%)"
                    : undefined,
                }}
              >
                <div className="pointer-events-none">
                  {readingLoading ? (
                    <span className="dot-grid-tooltip-content">Loading…</span>
                  ) : reading && clickedDot ? (
                    <div className="dot-grid-tooltip-content flex flex-wrap gap-x-2 gap-y-1">
                      {Object.entries(reading.reading.measurements).map(
                        ([key, value]) => (
                          <span key={key}>
                            {formatKey(key)}: {formatValue(value)}
                          </span>
                        ),
                      )}
                    </div>
                  ) : (
                    <span className="dot-grid-tooltip-content">
                      {activeSensor.name}
                    </span>
                  )}
                </div>
                <Link
                  href={`/explorer?sensor=${encodeURIComponent(activeSensor.id)}`}
                  className="dot-grid-tooltip-content pointer-events-auto flex items-center gap-1.5 text-emerald-400 underline-offset-2 hover:text-emerald-300 hover:underline"
                >
                  View sensor
                  <ArrowRight className="size-3.5 shrink-0" />
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return grid;
}
