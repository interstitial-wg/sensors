"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import SearchInput from "@/components/SearchInput";
import { buildAssistantReply } from "@/lib/assistant-reply";
import { filterSensorsByBounds } from "@/lib/sensors-api";
import type { Sensor } from "@/lib/types";

const STREAM_LINE_DELAY_MS = 180;

const COMPUTING_PLACEHOLDER = "__COMPUTING__";

const PHASE_LABELS: Record<string, string> = {
  finding_location: "Finding location…",
  looking_for_sensors: "Looking up sensors…",
  gathering_data: "Gathering data…",
  computing: "Calculating…",
};

/** Parse **bold** markers and render as spans */
function renderWithBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/** Bubble shown while search is in progress - shows phase-specific message */
function ComputingBubble({ phase }: { phase: string }) {
  const label = PHASE_LABELS[phase] ?? "Working…";
  return (
    <div className="max-w-[90%] rounded-2xl border border-black/10 bg-[#f0eeeb] px-4 py-2.5 text-sm text-foreground dark:border-white/10 dark:bg-[#1a1a1a] dark:text-white animate-computing-pulse">
      <p>{label}</p>
    </div>
  );
}

/** Collapsible "Thinking steps" section - expandable to see what ran */
function ThinkingSteps({ steps }: { steps: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;
  const labels = steps.map((s) => PHASE_LABELS[s] ?? s);
  return (
    <div className="mt-3 border-t border-black/10 pt-2 dark:border-white/10">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground/70 transition dark:text-white/50 dark:hover:text-white/70"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>Thinking steps</span>
      </button>
      {expanded && (
        <ul className="mt-1.5 space-y-1 pl-5 text-xs text-foreground/50 dark:text-white/50">
          {labels.map((label, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-foreground/40 dark:bg-white/40" />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Assistant bubble that streams its content line-by-line with gradient fade when it's the latest */
function AssistantBubble({
  content,
  isStreaming,
  steps,
}: {
  content: string;
  isStreaming: boolean;
  steps?: string[];
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const lines = content.split("\n");
  const [visibleLineCount, setVisibleLineCount] = useState(
    isStreaming ? 0 : lines.length,
  );
  useEffect(() => {
    if (!isStreaming) {
      setVisibleLineCount(lines.length);
      return;
    }
    setVisibleLineCount(0);
  }, [content, isStreaming, lines.length]);

  useEffect(() => {
    if (!isStreaming || visibleLineCount >= lines.length) return;
    const id = setInterval(() => {
      setVisibleLineCount((prev) => Math.min(prev + 1, lines.length));
    }, STREAM_LINE_DELAY_MS);
    return () => clearInterval(id);
  }, [isStreaming, visibleLineCount, lines.length]);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (!isStreaming) return;
    const now = Date.now();
    if (now - lastScrollRef.current > 120) {
      lastScrollRef.current = now;
      bubbleRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [visibleLineCount, isStreaming]);

  const displayedLines = lines.slice(0, visibleLineCount);

  return (
    <div
      ref={bubbleRef}
      className="max-w-[90%] rounded-2xl bg-[#f0eeeb] px-4 py-2.5 text-sm text-foreground dark:bg-[#1a1a1a] dark:text-white"
    >
      <p className="whitespace-pre-wrap">
        {displayedLines.map((line, i) => (
          <span
            key={i}
            className={
              i === displayedLines.length - 1
                ? "animate-chat-line-fade block"
                : "block"
            }
          >
            {renderWithBold(line)}
            {i < displayedLines.length - 1 ? "\n" : ""}
          </span>
        ))}
      </p>
      {steps && steps.length > 0 && <ThinkingSteps steps={steps} />}
    </div>
  );
}

/** Convert decimal degrees to DMS format (e.g. 37.7749 → "37° 46' 29.64" N") */
function toDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m / 60) * 3600).toFixed(2);
  const dir = isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W";
  return `${d}° ${m}' ${s}" ${dir}`;
}

export interface ExplorerChatPanelProps {
  focusSensor: Sensor | null;
  onCloseFocus?: () => void;
  sensorCount: number;
  loadingSensors: boolean;
  sensorsError: string | null;
  sensors: Sensor[];
  locationFetchUsedFallback?: boolean;
  requestedDataTypes?: Set<string>;
  onSearchSubmit?: (
    query: string,
    selectedTypes: Set<string>,
  ) => void | Promise<void>;
  initialSearch?: string;
  hasLocationCoords?: boolean;
  isFindingLocation?: boolean;
  /** When false, block build until location fetch completes (avoids stale data from previous city). */
  locationDataReady?: boolean;
  /** Key of location for which we have sensor data (set when fetch completes). */
  sensorsLocationKey?: string | null;
  /** Current location key from URL. Build only when sensorsLocationKey === currentLocationKey. */
  currentLocationKey?: string | null;
  /** When set, only build reply when sensors fall within these bounds (avoids stale viewport data). */
  locationBounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
  /** Called after adding user message from initialSearch — parent can clear q from URL to reset input. */
  onInitialSearchConsumed?: () => void;
}

export default function ExplorerChatPanel({
  focusSensor,
  onCloseFocus,
  sensorCount,
  loadingSensors,
  sensorsError,
  sensors,
  locationFetchUsedFallback = false,
  requestedDataTypes,
  onSearchSubmit,
  initialSearch = "",
  hasLocationCoords = false,
  isFindingLocation = false,
  locationDataReady = true,
  sensorsLocationKey = null,
  currentLocationKey = null,
  locationBounds = null,
  onInitialSearchConsumed,
}: ExplorerChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string; steps?: string[] }[]
  >([]);
  const [computingPhase, setComputingPhase] = useState("looking_for_sensors");
  const prevLoadingRef = useRef(loadingSensors);
  const pendingSearchRef = useRef(false);
  const sensorsRef = useRef(sensors);
  sensorsRef.current = sensors;
  const lastAddedInitialSearchRef = useRef<string | null>(null);

  // When landing with search params (from home or after explorer search), add user message.
  // Must run after navigation so we have the new URL — adding before nav causes build with old location's data.
  // Use ref to prevent duplicate adds (e.g. React Strict Mode double-mount or effect re-runs).
  useEffect(() => {
    if (!initialSearch) return;
    if (lastAddedInitialSearchRef.current === initialSearch) return;
    lastAddedInitialSearchRef.current = initialSearch;
    setMessages((prev) => [...prev, { role: "user", content: initialSearch }]);
    pendingSearchRef.current = true;
    onInitialSearchConsumed?.();
  }, [initialSearch, onInitialSearchConsumed]);

  const handleSearchSubmit = useCallback(
    (query: string, selectedTypes: Set<string>) => {
      const trimmed = query.trim() || "Show sensors";
      console.log("[ExplorerChatPanel] handleSearchSubmit", {
        query: trimmed,
        selectedTypes: [...selectedTypes],
      });
      // Add user message immediately so it appears without waiting for parse/geocode/navigation
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      lastAddedInitialSearchRef.current = trimmed;
      pendingSearchRef.current = true;
      onSearchSubmit?.(query, selectedTypes);
    },
    [onSearchSubmit],
  );

  const isBuildingReplyRef = useRef(false);
  const cancelBuildRef = useRef<(() => void) | null>(null);

  // Cancel in-flight build on unmount
  useEffect(() => {
    return () => cancelBuildRef.current?.();
  }, []);

  // Sync computing phase with actual operations (don't overwrite when buildAssistantReply is running)
  useEffect(() => {
    if (isBuildingReplyRef.current) return;
    if (isFindingLocation) setComputingPhase("finding_location");
    else if (loadingSensors) setComputingPhase("looking_for_sensors");
  }, [isFindingLocation, loadingSensors]);

  // Show ComputingBubble while finding location or loading sensors
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return;
    if (!isFindingLocation && !loadingSensors) return;
    if (messages.some((m) => m.content === COMPUTING_PLACEHOLDER)) return;
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: COMPUTING_PLACEHOLDER },
    ]);
  }, [messages, isFindingLocation, loadingSensors]);

  // Build reply when location fetch completes — use same sensors as map for consistency
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loadingSensors;

    const last = messages[messages.length - 1];
    const lastIsUser = last?.role === "user";
    const lastIsComputing =
      last?.role === "assistant" && last?.content === COMPUTING_PLACEHOLDER;
    const locationKeyMismatch =
      hasLocationCoords &&
      currentLocationKey != null &&
      sensorsLocationKey !== currentLocationKey;
    const skipNoTransition =
      !wasLoading && !pendingSearchRef.current;

    if (messages.length === 0) return;
    if (!lastIsUser && !lastIsComputing) return;
    if (isFindingLocation) return;
    if (loadingSensors) return;
    if (hasLocationCoords && !locationDataReady) return;
    if (locationKeyMismatch) return;
    if (skipNoTransition) return;
    // Avoid running with empty sensors when a location search is in flight: wait for fetch to complete.
    // (When isFindingLocation becomes false, router may not have updated yet; we'd run with stale 0 sensors.)
    if (pendingSearchRef.current && sensorsRef.current.length === 0) return;
    pendingSearchRef.current = false;

    // Cancel any in-flight build before starting a new one
    cancelBuildRef.current?.();
    cancelBuildRef.current = null;

    const userQuery = lastIsUser
      ? last.content
      : messages[messages.length - 2]?.role === "user"
        ? messages[messages.length - 2].content
        : last.content;
    let sensorsToUse = sensorsRef.current;
    // When searching a location, prefer sensors in the URL bbox to avoid stale viewport data.
    // If bbox filter would empty the list, use unfiltered sensors — we fetched for this location
    // (radius fallback can return sensors outside the geocoding bbox).
    if (locationBounds && sensorsToUse.length > 0) {
      const inBounds = filterSensorsByBounds(sensorsToUse, locationBounds);
      if (inBounds.length > 0) {
        sensorsToUse = inBounds;
      }
      // inBounds.length === 0: bbox from URL may be tighter than our radius fetch; use all fetched sensors
    }

    let cancelled = false;
    cancelBuildRef.current = () => {
      cancelled = true;
    };

    const runReply = () => {
      if (cancelled) return;
      const steps: string[] = [];
      if (hasLocationCoords) {
        steps.push("finding_location", "looking_for_sensors");
      }
      setComputingPhase("gathering_data");
      isBuildingReplyRef.current = true;
      buildAssistantReply(sensorsToUse, userQuery, sensorsError, {
        requestedTypeNotAvailable: locationFetchUsedFallback,
        requestedDataTypes,
        onPhase: (p) => {
          if (!cancelled) {
            steps.push(p);
            setComputingPhase(p);
          }
        },
      })
        .then((reply) => {
          isBuildingReplyRef.current = false;
          if (!cancelled) {
            setMessages((prev) => {
              const next = [...prev];
              if (next[next.length - 1]?.content === COMPUTING_PLACEHOLDER) {
                next[next.length - 1] = {
                  role: "assistant",
                  content: reply,
                  steps: steps.length > 0 ? steps : undefined,
                };
              }
              return next;
            });
          } else {
            console.log(
              "[ExplorerChatPanel] reply discarded: effect was cancelled",
            );
          }
        })
        .catch((err) => {
          isBuildingReplyRef.current = false;
          if (!cancelled) {
            const msg =
              err instanceof Error ? err.message : "Failed to load readings";
            setMessages((prev) => {
              const next = [...prev];
              if (next[next.length - 1]?.content === COMPUTING_PLACEHOLDER) {
                next[next.length - 1] = {
                  role: "assistant",
                  content: `Sorry, something went wrong: ${msg}`,
                  steps: steps.length > 0 ? steps : undefined,
                };
              }
              return next;
            });
          }
        });
    };

    if (lastIsUser) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: COMPUTING_PLACEHOLDER },
      ]);
    }
    runReply();
    return () => {
      // Don't cancel here - effect re-runs when we add COMPUTING_PLACEHOLDER, which would wrongly discard the reply.
      // We only cancel when starting a new build (above) or on unmount (separate effect).
    };
  }, [
    loadingSensors,
    messages,
    sensors.length,
    sensorsError,
    locationFetchUsedFallback,
    requestedDataTypes,
    hasLocationCoords,
    isFindingLocation,
    locationDataReady,
    sensorsLocationKey,
    currentLocationKey,
    locationBounds,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [focusSensor, messages]);

  const sourceName =
    focusSensor?.provider_name ??
    focusSensor?.feed_name ??
    focusSensor?.connected_service ??
    "—";

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground dark:text-white dark:[text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
      {/* Content - transparent, map shows through; messages anchor above input */}
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-4">
        {focusSensor ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground/95 shrink min-w-0 dark:text-white/95">
                {focusSensor.name}
              </h3>
              {onCloseFocus && (
                <button
                  type="button"
                  onClick={onCloseFocus}
                  className="shrink-0 rounded-full p-1 text-foreground/60 hover:bg-black/10 hover:text-foreground transition dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Close sensor detail"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div>
              <p className="mt-0.5 text-xs text-foreground/60 dark:text-white/60">
                {sourceName}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  Type
                </span>
                <div className="mt-0.5 truncate text-foreground/90 dark:text-white/90">
                  {focusSensor.sensor_type.replace(/_/g, " ")}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  Start
                </span>
                <div className="mt-0.5 truncate text-foreground/90 dark:text-white/90">
                  {focusSensor.deployment_date ?? "—"}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  End
                </span>
                <div className="mt-0.5 truncate text-foreground/90 dark:text-white/90">
                  {focusSensor.decommissioned_date ?? "Ongoing"}
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  ID
                </span>
                <div className="mt-0.5 truncate font-mono text-xs text-foreground/90 dark:text-white/90">
                  {focusSensor.id}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  Latitude
                </span>
                <div className="mt-0.5 font-mono text-foreground/90 dark:text-white/90">
                  {focusSensor.latitude != null
                    ? toDMS(focusSensor.latitude, true)
                    : "—"}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-foreground/50 dark:text-white/50">
                  Longitude
                </span>
                <div className="mt-0.5 font-mono text-foreground/90 dark:text-white/90">
                  {focusSensor.longitude != null
                    ? toDMS(focusSensor.longitude, false)
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        ) : messages.length > 0 ? (
          <div className="mt-auto space-y-4 pt-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "user" ? (
                  <div className="max-w-[90%] rounded-2xl bg-[#F7E6D2] px-4 py-2.5 text-sm text-foreground [text-shadow:none] dark:bg-[#2d2d2d] dark:text-white">
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : m.content === COMPUTING_PLACEHOLDER ? (
                  <ComputingBubble phase={computingPhase} />
                ) : (
                  <AssistantBubble
                    content={m.content}
                    isStreaming={
                      i === messages.length - 1 && m.role === "assistant"
                    }
                    steps={"steps" in m ? m.steps : undefined}
                  />
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : null}
        {messages.length === 0 && <div ref={messagesEndRef} />}
      </div>

      {/* Chat input bar - has background like WhatsApp */}
      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-black/10 bg-white/95 p-0 backdrop-blur-sm dark:border-white/10 dark:bg-[#0f0f0f]/95">
        <SearchInput
          mode="explorer"
          variant="inline"
          onSearchSubmit={handleSearchSubmit}
        />
      </div>
    </div>
  );
}
