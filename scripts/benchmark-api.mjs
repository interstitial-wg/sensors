#!/usr/bin/env node
/**
 * API benchmark: measures request times for the sensors API.
 * Output: table with Run 1, Run 2, Run 3, Min, Max per endpoint.
 * Run: node --env-file=.env scripts/benchmark-api.mjs
 */

const API_BASE = process.env.NEXT_PUBLIC_SENSORS_API_URL || "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_SENSORS_API_KEY;

if (!API_KEY?.trim()) {
  console.error("NEXT_PUBLIC_SENSORS_API_KEY is required. Set it in .env or pass as env var.");
  process.exit(1);
}

const RUNS = 3;
const ENDPOINTS = [
  { name: "sensors-bbox", url: `${API_BASE}/api/v1/sensors?page=1&limit=20&min_lat=25&min_lon=-95&max_lat=35&max_lon=-85` },
  { name: "sensors-radius", url: `${API_BASE}/api/v1/sensors?page=1&limit=20&lat=30&lon=-90&radius_km=100` },
  { name: "sensors-filtered-20", url: `${API_BASE}/api/v1/sensors?page=1&limit=20&sensor_type=buoy` },
  { name: "sensors-filtered-500", url: `${API_BASE}/api/v1/sensors?page=1&limit=500&sensor_type=buoy` },
];

function formatSec(ms) {
  return `${(ms / 1000).toFixed(3)}s`;
}

async function measureRequest(url) {
  const start = performance.now();
  const res = await fetch(url, {
    headers: { "x-api-key": API_KEY.trim() },
    cache: "no-store",
  });
  const body = await res.text();
  const elapsed = performance.now() - start;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return elapsed;
}

async function runBenchmark(endpoint) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    try {
      times.push(await measureRequest(endpoint.url));
    } catch (e) {
      console.error(`  ${endpoint.name} run ${i + 1} failed:`, e.message);
      times.push(NaN);
    }
  }
  const valid = times.filter((t) => !Number.isNaN(t));
  return {
    name: endpoint.name,
    run1: valid[0],
    run2: valid[1],
    run3: valid[2],
    min: valid.length ? Math.min(...valid) : NaN,
    max: valid.length ? Math.max(...valid) : NaN,
  };
}

function pad(str, len) {
  return String(str).padEnd(len);
}

async function main() {
  console.log("Sensors API Benchmark");
  console.log("====================");
  console.log(`Base URL: ${API_BASE}`);
  console.log(`Runs per endpoint: ${RUNS}`);
  console.log("");

  const results = [];
  for (const ep of ENDPOINTS) {
    process.stdout.write(`Benchmarking ${ep.name}... `);
    const r = await runBenchmark(ep);
    results.push(r);
    console.log("done");
  }

  console.log("");
  console.log("| Endpoint                 | Run 1  | Run 2  | Run 3  | Min        | Max        |");
  console.log("| ------------------------ | ------ | ------ | ------ | ---------- | ---------- |");

  for (const r of results) {
    const run1 = Number.isNaN(r.run1) ? "ERR" : formatSec(r.run1);
    const run2 = Number.isNaN(r.run2) ? "ERR" : formatSec(r.run2);
    const run3 = Number.isNaN(r.run3) ? "ERR" : formatSec(r.run3);
    const min = Number.isNaN(r.min) ? "ERR" : formatSec(r.min);
    const max = Number.isNaN(r.max) ? "ERR" : formatSec(r.max);
    const name = r.name.padEnd(22);
    console.log(`| ${name} | ${run1.padEnd(6)} | ${run2.padEnd(6)} | ${run3.padEnd(6)} | ${min.padEnd(10)} | ${max.padEnd(10)} |`);
  }

  console.log("");
  console.log("Baseline benchmark complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
