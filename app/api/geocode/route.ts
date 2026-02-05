/**
 * Geocoding API route using Nominatim (OpenStreetMap).
 * GET /api/geocode?q=Oakland
 * GET /api/geocode?q=San+Francisco&countrycodes=us  (bias to US)
 * Returns { lat, lon, display_name, boundingbox? } or null.
 * When q is "City, State", tries city-only first for a tighter boundary.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
/** Max bbox area (km²) — reject larger (e.g. Bay Area ~18k km²). SF city ~2.5k km² (includes water). */
const MAX_BBOX_AREA_KM2 = 3500;

function bboxAreaKm2(bbox: {
  south: number;
  north: number;
  west: number;
  east: number;
}): number {
  const latKm = 111;
  const lonKm =
    111 * Math.cos((bbox.south + bbox.north) * 0.5 * (Math.PI / 180));
  return (bbox.north - bbox.south) * latKm * (bbox.east - bbox.west) * lonKm;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "Missing q parameter" }, { status: 400 });
  }
  const countrycodes = searchParams.get("countrycodes")?.trim() || "us";

  /** Try city-only first when "City, State" or "City, Country" for tighter boundary */
  const cityOnly = q.includes(",") ? q.split(",")[0]!.trim() : null;

  async function fetchGeocode(
    query: string,
    countrycodesParam: string | null,
    featureType?: "city" | "settlement",
  ) {
    const url = new URL(NOMINATIM_BASE);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    if (countrycodesParam)
      url.searchParams.set("countrycodes", countrycodesParam);
    if (featureType) url.searchParams.set("featureType", featureType);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "SensorsExplorer/1.0 (https://github.com/planetary/sensors)",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      boundingbox?: [string, string, string, string]; // [south, north, west, east]
    }[];
    return data[0] ?? null;
  }

  try {
    let first: Awaited<ReturnType<typeof fetchGeocode>> = null;
    if (cityOnly) {
      first = await fetchGeocode(cityOnly, countrycodes, "city");
    }
    if (!first && cityOnly) {
      first = await fetchGeocode(cityOnly, countrycodes, "settlement");
    }
    if (!first) {
      first = await fetchGeocode(q, countrycodes);
    }
    if (!first && countrycodes) {
      first = await fetchGeocode(q, null);
    }
    if (!first) {
      return Response.json(null);
    }
    const lat = parseFloat(first.lat);
    const lon = parseFloat(first.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return Response.json(
        { error: "Invalid geocode result" },
        { status: 502 },
      );
    }
    const result: {
      lat: number;
      lon: number;
      display_name: string;
      boundingbox?: {
        south: number;
        north: number;
        west: number;
        east: number;
      };
    } = {
      lat,
      lon,
      display_name: first.display_name ?? `${lat}, ${lon}`,
    };
    const bbox = first.boundingbox;
    if (
      Array.isArray(bbox) &&
      bbox.length >= 4 &&
      bbox.every((v) => typeof v === "string")
    ) {
      const [south, north, west, east] = bbox.map(parseFloat);
      if (
        !Number.isNaN(south) &&
        !Number.isNaN(north) &&
        !Number.isNaN(west) &&
        !Number.isNaN(east) &&
        south < north &&
        west < east
      ) {
        const area = bboxAreaKm2({ south, north, west, east });
        if (area <= MAX_BBOX_AREA_KM2) {
          result.boundingbox = { south, north, west, east };
        }
      }
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Geocoding failed" },
      { status: 502 },
    );
  }
}
