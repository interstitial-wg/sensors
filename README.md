# Global sensors map

A Next.js app that shows global sensor locations on an illustrated map. Filter by sensor type (ocean buoys, river sensors, farm/weather stations, air quality) and see only sensors in the current map view.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data source

Set `NEXT_PUBLIC_SENSORS_API_URL` (e.g. `http://localhost:3001`) and `NEXT_PUBLIC_SENSORS_API_KEY` to use the Sensors REST API. See [services/sensors/overview](http://localhost:3002/services/sensors/overview) for the API schema.

Copy `.env.example` to `.env.local` and adjust if needed.

## Stack

- Next.js (App Router), TypeScript, Tailwind
- Map: MapLibre GL via `react-map-gl/maplibre`
- Data: `lib/sensors-api.ts` (`GET /api/v1/sensors`)
