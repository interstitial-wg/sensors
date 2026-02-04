"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import SearchInput from "@/components/SearchInput";
import { buildAssistantReply } from "@/lib/assistant-reply";
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
    <div className="max-w-[90%] rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-white/95 animate-computing-pulse">
      <p>{label}</p>
    </div>
  );
}

/** Assistant bubble that streams its content line-by-line with gradient fade when it's the latest */
function AssistantBubble({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
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
      className="max-w-[90%] rounded-2xl bg-[#0f0f0f]/80 px-4 py-2.5 text-sm text-white/95"
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
}

export default function ExplorerChatPanel({
  focusSensor,
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
}: ExplorerChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [computingPhase, setComputingPhase] = useState("looking_for_sensors");
  const prevLoadingRef = useRef(loadingSensors);
  const pendingSearchRef = useRef(false);
  const sensorsRef = useRef(sensors);
  sensorsRef.current = sensors;

  // When landing from home page with search params, add user message so assistant flow runs
  useEffect(() => {
    if (messages.length === 0 && initialSearch && hasLocationCoords) {
      setMessages([{ role: "user", content: initialSearch }]);
      pendingSearchRef.current = true;
    }
  }, [initialSearch, hasLocationCoords, messages.length]);

  const handleSearchSubmit = useCallback(
    (query: string, selectedTypes: Set<string>) => {
      console.log("[ExplorerChatPanel] handleSearchSubmit", {
        query: query.trim() || "Show sensors",
        selectedTypes: [...selectedTypes],
      });
      setMessages((prev) => [
        ...prev,
        { role: "user", content: query.trim() || "Show sensors" },
      ]);
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

  // When loading completes and we have a user message at the end, build assistant reply
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loadingSensors;

    console.log("[ExplorerChatPanel] build-reply effect", {
      messagesLength: messages.length,
      lastRole: messages[messages.length - 1]?.role,
      loadingSensors,
      wasLoading,
      pendingSearch: pendingSearchRef.current,
      sensorCount: sensorsRef.current.length,
    });

    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") {
      console.log("[ExplorerChatPanel] skipping: last message is not user");
      return;
    }
    if (loadingSensors) {
      console.log("[ExplorerChatPanel] skipping: still loading sensors");
      return;
    }
    if (!wasLoading && !pendingSearchRef.current) {
      console.log(
        "[ExplorerChatPanel] skipping: no loading transition, no pending search",
      );
      return;
    }
    pendingSearchRef.current = false;

    // Cancel any in-flight build before starting a new one (don't cancel when effect re-runs due to adding placeholder)
    cancelBuildRef.current?.();
    cancelBuildRef.current = null;

    const userQuery = last.content;
    const sensorsToUse = sensorsRef.current;
    let cancelled = false;
    cancelBuildRef.current = () => {
      cancelled = true;
    };

    console.log("[ExplorerChatPanel] starting buildAssistantReply", {
      userQuery,
      sensorCount: sensorsToUse.length,
    });

    const runReply = () => {
      if (cancelled) return;
      setComputingPhase("gathering_data");
      isBuildingReplyRef.current = true;
      buildAssistantReply(sensorsToUse, userQuery, sensorsError, {
        requestedTypeNotAvailable: locationFetchUsedFallback,
        requestedDataTypes,
        onPhase: (p) => !cancelled && setComputingPhase(p),
      })
        .then((reply) => {
          console.log("[ExplorerChatPanel] buildAssistantReply resolved", {
            cancelled,
            replyLength: reply?.length,
            replyPreview: reply?.slice(0, 80),
          });
          isBuildingReplyRef.current = false;
          if (!cancelled) {
            setMessages((prev) => {
              const next = [...prev];
              if (next[next.length - 1]?.content === COMPUTING_PLACEHOLDER) {
                next[next.length - 1] = { role: "assistant", content: reply };
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
          console.log("[ExplorerChatPanel] buildAssistantReply rejected", {
            cancelled,
            err: err instanceof Error ? err.message : String(err),
          });
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
                };
              }
              return next;
            });
          }
        });
    };

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: COMPUTING_PLACEHOLDER },
    ]);
    runReply();
    return () => {
      // Don't cancel here - effect re-runs when we add COMPUTING_PLACEHOLDER, which would wrongly discard the reply.
      // We only cancel when starting a new build (above) or on unmount (separate effect).
    };
  }, [
    loadingSensors,
    messages,
    sensorsError,
    locationFetchUsedFallback,
    requestedDataTypes,
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
    <div className="flex h-full min-h-0 flex-col text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
      {/* Content - transparent, map shows through; messages anchor above input */}
      <div className="scrollbar-hide flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-4">
        {focusSensor ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white/95">
                {focusSensor.name}
              </h3>
              <p className="mt-0.5 text-xs text-white/60">{sourceName}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Type
                </span>
                <div className="mt-0.5 truncate text-white/90">
                  {focusSensor.sensor_type.replace(/_/g, " ")}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Start
                </span>
                <div className="mt-0.5 truncate text-white/90">
                  {focusSensor.deployment_date ?? "—"}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  End
                </span>
                <div className="mt-0.5 truncate text-white/90">
                  {focusSensor.decommissioned_date ?? "Ongoing"}
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  ID
                </span>
                <div className="mt-0.5 truncate font-mono text-xs text-white/90">
                  {focusSensor.id}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Latitude
                </span>
                <div className="mt-0.5 font-mono text-white/90">
                  {focusSensor.latitude != null
                    ? toDMS(focusSensor.latitude, true)
                    : "—"}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Longitude
                </span>
                <div className="mt-0.5 font-mono text-white/90">
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
                  <div className="max-w-[90%] rounded-2xl bg-white/20 px-4 py-2.5 text-sm text-white">
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
      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-[#0f0f0f]/95 p-0 backdrop-blur-sm">
        <SearchInput
          mode="explorer"
          variant="inline"
          onSearchSubmit={handleSearchSubmit}
        />
      </div>
    </div>
  );
}
