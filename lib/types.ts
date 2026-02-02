/**
 * Sensor type aligned with Sensors REST API schema.
 * List, detail, and registry endpoints return latitude/longitude; null when sensor has no location.
 */
export interface Sensor {
  id: string;
  external_id: string;
  name: string;
  description: string | null;
  sensor_type: string;
  status: string;
  deployment_date: string | null;
  decommissioned_date: string | null;
  /** WGS84 latitude; null when sensor has no location. */
  latitude: number | null;
  /** WGS84 longitude; null when sensor has no location. */
  longitude: number | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_slug: string | null;
  feed_id: string | null;
  feed_name: string | null;
  connected_service?: string | null;
  /**
   * ISO timestamp of the most recent observation (from clean_records or upstream).
   * Optional: API may include this when available; sensors app shows "—" when absent.
   */
  last_reading_at?: string | null;
}

/** Example API response shape (GET /api/v1/sensors, list item). */
export const EXAMPLE_SENSOR: Sensor = {
  id: "51fbdd95-4a67-4bce-b205-2f7a3c4619f3",
  external_id: "01-003-0002",
  name: "AirNow 01-003-0002",
  description: "AQS site 01-003-0002 (StateCode-CountyCode-SiteNumber)",
  sensor_type: "air_quality_monitor",
  status: "active",
  deployment_date: null,
  decommissioned_date: null,
  latitude: 30.552367,
  longitude: -87.706911,
  provider_id: "5f7ec8cf-e87e-480e-9558-1ef76cca9058",
  provider_name: "EPA AirNow Monitoring Sites",
  provider_slug: "epa_airnow",
  feed_id: "7f2f0657-90c2-49e3-82a1-9e49825edb41",
  feed_name: "AirNow Air Quality",
  connected_service: "airnow",
};

export interface SensorsListResponse {
  sensors: Sensor[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
