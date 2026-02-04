"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Check,
  Layers,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DATA_TYPE_FILTERS, DATA_TYPE_IDS } from "@/lib/data-filters";

const PLACEHOLDER_EXAMPLES = [
  "Air quality in Oakland",
  "Weather stations near San Francisco",
  "Ocean buoys in the Pacific",
  "River sensors with water temperature",
  "PM2.5 monitors",
  "Dissolved oxygen in rivers",
  "Wave height and wind speed",
];

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

export interface SearchInputProps {
  /** When "explorer", syncs with URL params and uses router for updates */
  mode?: "standalone" | "explorer";
  /** Compact styling for chat bar (no border/shadow) */
  variant?: "default" | "inline";
  /** Called when form is submitted with query and selected data types */
  onSearchSubmit?: (query: string, selectedTypes: Set<string>) => void;
}

export default function SearchInput({
  mode = "standalone",
  variant = "default",
  onSearchSubmit,
}: SearchInputProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery =
    mode === "explorer" ? (searchParams.get("q")?.trim() ?? "") : "";
  const initialTypes = useMemo(() => {
    if (mode !== "explorer") return new Set(DATA_TYPE_IDS);
    const typeParam = searchParams.get("type")?.trim();
    if (!typeParam) return new Set(DATA_TYPE_IDS);
    return new Set(
      typeParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => DATA_TYPE_IDS.has(t)),
    );
  }, [mode, searchParams]);

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(initialTypes);
  const [query, setQuery] = useState(initialQuery);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const justSubmittedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mode === "explorer") {
      if (!justSubmittedRef.current) {
        setQuery(searchParams.get("q")?.trim() ?? "");
      } else {
        justSubmittedRef.current = false;
        setQuery("");
      }
      const typeParam = searchParams.get("type")?.trim();
      setSelectedTypes(
        !typeParam
          ? new Set(DATA_TYPE_IDS)
          : new Set(
              typeParam
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .filter((t) => DATA_TYPE_IDS.has(t)),
            ),
      );
    }
  }, [mode, searchParams]);

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
      if (mode === "explorer") {
        applyToUrl(query, next);
      }
      return next;
    });
  };

  const allTypesSelected = selectedTypes.size === DATA_TYPE_IDS.size;
  const noTypesSelected = selectedTypes.size === 0;
  const typeLabel = allTypesSelected
    ? "Data"
    : noTypesSelected
      ? "None"
      : `${selectedTypes.size}`;

  const buildExplorerUrl = (q: string, types: Set<string>) => {
    const params =
      mode === "explorer"
        ? new URLSearchParams(searchParams.toString())
        : new URLSearchParams();
    if (mode === "explorer") {
      params.delete("q");
      params.delete("type");
    }
    if (q.trim()) params.set("q", q.trim());
    if (!(types.size === DATA_TYPE_IDS.size) && types.size > 0) {
      params.set("type", [...types].sort().join(","));
    }
    return `/explorer${params.toString() ? `?${params.toString()}` : ""}`;
  };

  const applyToUrl = (q: string, types: Set<string>) => {
    const url = buildExplorerUrl(q, types);
    router.push(url);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearchSubmit) {
      justSubmittedRef.current = true;
      setQuery("");
      onSearchSubmit(query, selectedTypes);
      // Parent handles URL update (including lat/lon from geocoding)
    } else if (mode === "explorer") {
      applyToUrl(query, selectedTypes);
    } else {
      window.location.href = buildExplorerUrl(query, selectedTypes);
    }
  };

  const formClass =
    variant === "inline"
      ? "flex w-full min-w-0 flex-1 flex-col gap-0 rounded-lg border border-white/10 bg-white/5 transition focus-within:border-white/20 focus-within:bg-white/[0.07]"
      : "flex w-full max-w-2xl flex-col gap-0 rounded-xl border border-white/15 bg-white/[0.07] shadow-lg shadow-black/20 transition focus-within:border-white/25 focus-within:bg-white/9 focus-within:shadow-xl focus-within:shadow-black/25";

  return (
    <form onSubmit={handleSubmit} className={formClass}>
      {/* Text input - compact single line */}
      <div
        className={
          variant === "inline" ? "px-3 py-1.5" : "px-3 py-1.5 md:px-4 md:py-2"
        }
      >
        <input
          type="text"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
          className={`w-full bg-transparent text-white placeholder:text-white/45 focus:outline-none ${
            variant === "inline"
              ? "min-h-[36px] text-sm"
              : "min-h-[36px] text-base md:min-h-[40px] md:text-lg"
          }`}
          aria-label="Search for sensors"
        />
      </div>

      {/* Bottom bar: pill selectors left, submit button right */}
      <div
        className={
          variant === "inline"
            ? "flex items-center justify-between gap-2 py-1.5 pl-3 pr-1"
            : "flex items-center justify-between gap-3 py-1.5 pl-3 pr-1 md:py-2 md:pl-4 md:pr-2"
        }
      >
        <div className="flex items-center gap-2">
          {/* Type pill */}
          <PillDropdown
            icon={Layers}
            summary={typeLabel}
            isOpen={typeDropdownOpen}
            onToggle={() => setTypeDropdownOpen((o) => !o)}
            dropdownRef={typeDropdownRef}
            ariaLabel="Filter by data type"
          >
            <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[180px] rounded-xl border border-white/15 bg-[#1a1a1a] p-1.5 shadow-lg">
              <div className="mb-1.5 flex gap-1 border-b border-white/10 pb-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(DATA_TYPE_IDS);
                    setSelectedTypes(next);
                    if (mode === "explorer") applyToUrl(query, next);
                  }}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set<string>();
                    setSelectedTypes(next);
                    if (mode === "explorer") applyToUrl(query, next);
                  }}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                >
                  None
                </button>
              </div>
              {DATA_TYPE_FILTERS.map((filter) => {
                const isSelected = selectedTypes.has(filter.id);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => toggleType(filter.id)}
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
          className={`flex shrink-0 items-center justify-center rounded-full transition ${
            variant === "inline" ? "h-9 w-9" : "h-9 w-9 md:h-10 md:w-10"
          } ${
            query.trim()
              ? "bg-[#9AB07F] text-white hover:bg-[#8a9f6f]"
              : "bg-white/5 text-white/50"
          }`}
          aria-label="Search"
        >
          <ArrowRight
            className={
              variant === "inline" ? "h-4 w-4" : "h-4 w-4 md:h-5 md:w-5"
            }
          />
        </button>
      </div>
    </form>
  );
}
