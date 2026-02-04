"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import SearchInput from "@/components/SearchInput";
import {
  parseQuery,
  getLocationGeocodeFallback,
  correctLocationTypo,
} from "@/lib/query-parser";
import { DATA_TYPE_IDS } from "@/lib/data-filters";

/**
 * Home page search section. On submit, parses query via LLM (or keyword fallback),
 * geocodes location if present, and redirects to explorer with q, type, and lat/lon.
 */
export default function HomeSearchSection() {
  const router = useRouter();

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
        const fallback = parseQuery(q);
        parsed = {
          location: fallback.location,
          dataTypeIds: [...fallback.dataTypeIds].filter((id) =>
            DATA_TYPE_IDS.has(id),
          ),
        };
      }
      const mergedTypes = new Set(selectedTypes);
      for (const id of parsed.dataTypeIds ?? []) {
        if (DATA_TYPE_IDS.has(id)) mergedTypes.add(id);
      }
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (mergedTypes.size > 0 && mergedTypes.size < DATA_TYPE_IDS.size) {
        params.set("type", [...mergedTypes].sort().join(","));
      }
      const location = parsed.location?.trim();
      if (location) {
        const corrected = correctLocationTypo(location);
        const fallback = getLocationGeocodeFallback(location);
        const toTry = [
          ...new Set([corrected, location, fallback].filter(Boolean)),
        ] as string[];
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
                boundingbox?: {
                  south: number;
                  north: number;
                  west: number;
                  east: number;
                };
              } | null;
              if (data?.lat != null && data?.lon != null) {
                params.set("lat", String(data.lat));
                params.set("lon", String(data.lon));
                if (data.boundingbox) {
                  params.set("min_lat", String(data.boundingbox.south));
                  params.set("max_lat", String(data.boundingbox.north));
                  params.set("min_lon", String(data.boundingbox.west));
                  params.set("max_lon", String(data.boundingbox.east));
                }
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
    [router],
  );

  return (
    <div className="mt-8 space-y-6">
      <p className="text-base leading-relaxed text-foreground/80 md:text-lg lg:text-2xl">
        <a
          href="/explorer"
          className="font-medium text-foreground underline decoration-foreground/40 underline-offset-2 transition hover:decoration-foreground/80"
        >
          Explore
        </a>{" "}
        the sensors network below.
      </p>
      <SearchInput onSearchSubmit={handleSearchSubmit} />
    </div>
  );
}
