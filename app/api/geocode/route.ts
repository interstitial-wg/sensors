/**
 * Geocoding API route using Nominatim (OpenStreetMap).
 * GET /api/geocode?q=Oakland
 * GET /api/geocode?q=San+Francisco&countrycodes=us  (bias to US)
 * Returns { lat, lon, display_name } or null.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "Missing q parameter" }, { status: 400 });
  }
  const countrycodes = searchParams.get("countrycodes")?.trim() || "us";

  async function fetchGeocode(countrycodesParam: string | null) {
    const url = new URL(NOMINATIM_BASE);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    if (countrycodesParam) url.searchParams.set("countrycodes", countrycodesParam);

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
    }[];
    return data[0] ?? null;
  }

  try {
    let first = await fetchGeocode(countrycodes);
    if (!first && countrycodes) {
      first = await fetchGeocode(null);
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
    return Response.json({
      lat,
      lon,
      display_name: first.display_name ?? `${lat}, ${lon}`,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Geocoding failed" },
      { status: 502 },
    );
  }
}
