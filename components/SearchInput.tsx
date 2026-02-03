"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Check,
  Layers,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PLACEHOLDER_EXAMPLES = [
  "Air quality in Oakland",
  "Weather stations near San Francisco",
  "Ocean buoys in the Pacific",
  "River sensors with water temperature",
  "PM2.5 monitors",
  "Dissolved oxygen in rivers",
  "Wave height and wind speed",
];

/** Type filters: sensor_type for API filter, or search term */
const TYPE_FILTERS = [
  { label: "Air quality", sensorType: "air_quality_monitor" },
  { label: "Humidity", sensorType: "weather_station" },
  { label: "Temperature", search: "temperature" },
  { label: "Ocean buoys", sensorType: "buoy" },
  { label: "River sensors", sensorType: "river_sensor" },
  { label: "Weather stations", sensorType: "weather_station" },
];

const TYPE_KEYS = new Set(
  TYPE_FILTERS.map((f) => f.sensorType ?? f.search ?? f.label),
);

const CYCLE_MS = 3500;

function PillDropdown({
  icon: Icon,
  summary,
  isOpen,
  onToggle,
  children,
  dropdownRef,
  ariaLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  summary: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  ariaLabel: string;
}) {
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-full border bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white ${
          isOpen
            ? "border-white/25"
            : "border-transparent hover:border-white/25"
        }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/60" />
        <span>{summary}</span>
        {isOpen ? (
          <ChevronUp className="h-3 w-3 shrink-0 text-white/60" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-white/60" />
        )}
      </button>
      {isOpen && children}
    </div>
  );
}

export default function SearchInput() {
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(TYPE_KEYS),
  );
  const [query, setQuery] = useState("");
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(target)
      ) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allTypesSelected = selectedTypes.size === TYPE_KEYS.size;
  const noTypesSelected = selectedTypes.size === 0;
  const typeLabel = allTypesSelected
    ? "Type"
    : noTypesSelected
      ? "None"
      : `${selectedTypes.size}`;

  const buildExplorerUrl = () => {
    const params = new URLSearchParams();
    const searchParts: string[] = [];
    if (query.trim()) searchParts.push(query.trim());
    if (!allTypesSelected) {
      const sensorTypesForUrl: string[] = [];
      for (const key of selectedTypes) {
        const filter = TYPE_FILTERS.find(
          (f) => (f.sensorType ?? f.search ?? f.label) === key,
        );
        if (filter?.sensorType) sensorTypesForUrl.push(filter.sensorType);
        else if (filter?.search) searchParts.push(filter.search);
      }
      if (sensorTypesForUrl.length > 0)
        params.set("type", sensorTypesForUrl.sort().join(","));
    }
    if (searchParts.length > 0) params.set("q", searchParts.join(" "));
    return `/explorer${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = buildExplorerUrl();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-2xl flex-col gap-0 rounded-xl border border-white/15 bg-white/[0.07] shadow-lg shadow-black/20 transition focus-within:border-white/25 focus-within:bg-white/9 focus-within:shadow-xl focus-within:shadow-black/25"
    >
      {/* Text input - compact single line */}
      <div className="px-3 py-1.5 md:px-4 md:py-2">
        <input
          type="text"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
          className="min-h-[36px] w-full bg-transparent text-base text-white placeholder:text-white/45 focus:outline-none md:min-h-[40px] md:text-lg"
          aria-label="Search for sensors"
        />
      </div>

      {/* Bottom bar: pill selectors left, submit button right */}
      <div className="flex items-center justify-between gap-3 py-1.5 pl-3 pr-1 md:py-2 md:pl-4 md:pr-2">
        <div className="flex items-center gap-2">
          {/* Type pill */}
          <PillDropdown
            icon={Layers}
            summary={typeLabel}
            isOpen={typeDropdownOpen}
            onToggle={() => setTypeDropdownOpen((o) => !o)}
            dropdownRef={typeDropdownRef}
            ariaLabel="Filter by sensor type"
          >
            <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[180px] rounded-xl border border-white/15 bg-[#1a1a1a] p-1.5 shadow-lg">
              <div className="mb-1.5 flex gap-1 border-b border-white/10 pb-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedTypes(new Set(TYPE_KEYS))}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTypes(new Set())}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                >
                  None
                </button>
              </div>
              {TYPE_FILTERS.map((filter) => {
                const key = filter.sensorType ?? filter.search ?? filter.label;
                const isSelected = selectedTypes.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleType(key)}
                    className="flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-[#9AB07F] bg-[#9AB07F]"
                          : "border-white/30 bg-transparent"
                      }`}
                    >
                      {isSelected ? (
                        <Check className="h-2.5 w-2.5 text-white" />
                      ) : null}
                    </span>
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </PillDropdown>
        </div>

        {/* Submit button - green when prompt has content */}
        <button
          type="submit"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition md:h-10 md:w-10 ${
            query.trim()
              ? "bg-[#9AB07F] text-white hover:bg-[#8a9f6f]"
              : "bg-white/5 text-white/50"
          }`}
          aria-label="Search"
        >
          <ArrowRight className="h-4 w-4 md:h-5 md:w-5" />
        </button>
      </div>
    </form>
  );
}
