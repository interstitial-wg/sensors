/**
 * Parse natural language queries to extract location, data types, and search text.
 * Used by the explorer chat/search to drive filtering and map location.
 */

import { DATA_TYPE_FILTERS, DATA_TYPE_IDS } from "./data-filters";

export interface ParsedQuery {
  /** Place name or location phrase to geocode (e.g. "Oakland", "San Francisco") */
  location?: string;
  /** Data type ids inferred from query (subset of DATA_TYPE_IDS) */
  dataTypeIds: Set<string>;
  /** Remaining text for API search param (name, description, etc.) */
  searchText: string;
}

/** Keywords/phrases that map to data type ids. Order matters: longer phrases first. */
const DATA_TYPE_KEYWORDS: { pattern: RegExp | string; ids: string[] }[] = [
  { pattern: /\bair\s+quality\b/i, ids: ["aqi"] },
  { pattern: /\baqi\b/i, ids: ["aqi"] },
  { pattern: /\bpm2\.?5\b/i, ids: ["aqi"] },
  { pattern: /\bpm10\b/i, ids: ["aqi"] },
  { pattern: /\bwave\s+height\b/i, ids: ["wave_height"] },
  { pattern: /\bwaves?\b/i, ids: ["wave_height"] },
  { pattern: /\bbuoy\b/i, ids: ["wave_height", "wind"] },
  { pattern: /\bbuoys\b/i, ids: ["wave_height", "wind"] },
  { pattern: /\bocean\b/i, ids: ["wave_height", "wind"] },
  { pattern: /\bwater\s+quality\b/i, ids: ["water_quality"] },
  { pattern: /\bdissolved\s+oxygen\b/i, ids: ["water_quality"] },
  { pattern: /\bturbidity\b/i, ids: ["water_quality"] },
  { pattern: /\briver\b/i, ids: ["water_quality", "temperature"] },
  { pattern: /\brivers?\b/i, ids: ["water_quality", "temperature"] },
  { pattern: /\bhumidity\b/i, ids: ["humidity"] },
  { pattern: /\btemperature\b/i, ids: ["temperature"] },
  { pattern: /\btemp\b/i, ids: ["temperature"] },
  { pattern: /\bweather\b/i, ids: ["temperature", "wind"] },
  { pattern: /\bwind\b/i, ids: ["wind"] },
  { pattern: /\bwind\s+speed\b/i, ids: ["wind"] },
];

/** Location prepositions that often precede a place name */
const LOCATION_PREPOSITIONS = /\b(in|near|around|at|by)\s+/i;

/** Common place-name patterns: "in Oakland", "near San Francisco", "Pacific", "California" */
const KNOWN_PLACES = new Set([
  "oakland",
  "san francisco",
  "sf",
  "hayes valley",
  "hays valley",
  "hayes valley san francisco",
  "los angeles",
  "la",
  "california",
  "pacific",
  "atlantic",
  "gulf of mexico",
  "new york",
  "seattle",
  "portland",
  "chicago",
  "houston",
  "miami",
  "boston",
  "denver",
  "phoenix",
  "san diego",
  "texas",
  "florida",
  "oregon",
  "washington",
]);

/** Geocoding fallbacks: try these if the primary location fails */
const LOCATION_FALLBACKS: Record<string, string> = {
  "san francisco hays valley": "Hayes Valley, San Francisco",
  "hays valley san francisco": "Hayes Valley, San Francisco",
  "sf hayes valley": "Hayes Valley, San Francisco",
};

/**
 * Extract a potential location phrase from the query.
 * Looks for: "in X", "near X", quoted "X", or known place names.
 */
function extractLocation(query: string): {
  location?: string;
  remainder: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return { remainder: "" };

  // Quoted phrase: "Oakland" or "San Francisco"
  const quotedMatch = trimmed.match(/["']([^"']+)["']/);
  if (quotedMatch) {
    const location = quotedMatch[1].trim();
    const remainder = trimmed
      .replace(quotedMatch[0], "")
      .trim()
      .replace(/\s+/g, " ");
    return { location, remainder };
  }

  // "in Oakland", "near San Francisco", "around Los Angeles"
  const prepMatch = trimmed.match(
    new RegExp(LOCATION_PREPOSITIONS.source + "(.+?)(?:\\.|$)", "i"),
  );
  if (prepMatch) {
    const location = prepMatch[1].trim().replace(/\s*,\s*.*$/, ""); // drop trailing ", CA" etc for now
    const remainder = trimmed
      .replace(prepMatch[0], "")
      .trim()
      .replace(/\s+/g, " ");
    return { location: location || undefined, remainder: remainder || trimmed };
  }

  // Single known place or multi-word known place at end
  const words = trimmed.toLowerCase().split(/\s+/);
  for (let len = Math.min(words.length, 4); len >= 1; len--) {
    const phrase = words.slice(-len).join(" ");
    if (KNOWN_PLACES.has(phrase)) {
      const location = words.slice(-len).join(" ");
      const remainder = words.slice(0, -len).join(" ").trim();
      return { location, remainder };
    }
  }

  // Check for known place anywhere in query (e.g. "Oakland air quality")
  for (const place of KNOWN_PLACES) {
    const re = new RegExp(`\\b${place.replace(/\s/g, "\\s")}\\b`, "i");
    if (re.test(trimmed)) {
      const location = trimmed.match(re)?.[0] ?? place;
      const remainder = trimmed.replace(re, "").trim().replace(/\s+/g, " ");
      return { location, remainder };
    }
  }

  return { remainder: trimmed };
}

/**
 * Extract data type ids from the query using keyword matching.
 */
function extractDataTypes(query: string): Set<string> {
  const ids = new Set<string>();
  const lower = query.toLowerCase();

  for (const { pattern, ids: matchIds } of DATA_TYPE_KEYWORDS) {
    const matches =
      typeof pattern === "string"
        ? lower.includes(pattern)
        : pattern.test(query);
    if (matches) {
      for (const id of matchIds) {
        if (DATA_TYPE_IDS.has(id)) ids.add(id);
      }
    }
  }

  return ids;
}

/**
 * Parse a natural language query into location, data types, and search text.
 */
export function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { dataTypeIds: new Set(), searchText: "" };
  }

  const { location, remainder } = extractLocation(trimmed);
  const dataTypeIds = extractDataTypes(trimmed);

  // searchText: use remainder if we extracted a location, else full query (for API text search)
  const searchText = remainder || trimmed;

  return {
    location,
    dataTypeIds,
    searchText,
  };
}

/** Get a geocoding fallback for a location that may not resolve (e.g. "San Francisco Hays Valley" -> "Hayes Valley, San Francisco") */
export function getLocationGeocodeFallback(location: string): string | null {
  const key = location.trim().toLowerCase().replace(/\s+/g, " ");
  return LOCATION_FALLBACKS[key] ?? null;
}
