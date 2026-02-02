"use client";

import { useStats } from "@/components/StatsProvider";

const DISPLAYED_SOURCES = [
  "EPA",
  "NASA",
  "NOAA",
  "Purple Air",
  "Air Now",
  "Trefle",
];

export default function SourceSection() {
  const stats = useStats();
  const moreCount =
    stats && stats.providers > DISPLAYED_SOURCES.length
      ? stats.providers - DISPLAYED_SOURCES.length
      : null;

  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/60">
        SOURCE
      </p>
      <div className="flex flex-wrap gap-2">
        {DISPLAYED_SOURCES.map((source) => (
          <span
            key={source}
            className="rounded bg-white/5 px-3 py-1.5 text-sm text-white/80"
          >
            {source}
          </span>
        ))}
        <span className="rounded bg-white/5 px-3 py-1.5 text-sm text-white/80">
          {moreCount != null ? `${moreCount}+` : "100+"} more
        </span>
      </div>
    </div>
  );
}
