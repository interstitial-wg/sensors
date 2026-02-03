"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useStats } from "@/components/StatsProvider";

const DISPLAYED_SOURCES: { label: string; slug: string }[] = [
  { label: "EPA", slug: "epa" },
  { label: "NASA", slug: "nasa" },
  { label: "NOAA", slug: "noaa" },
  { label: "Purple Air", slug: "purpleair" },
  { label: "Air Now", slug: "airnow" },
  { label: "Trefle", slug: "trefle" },
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
        {DISPLAYED_SOURCES.map(({ label, slug }) => (
          <Link
            key={slug}
            href={`/explorer?provider=${encodeURIComponent(slug)}`}
            className="group flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-base font-medium text-white/80 transition hover:bg-white/10 hover:text-white md:px-5 md:py-2.5 md:text-lg"
          >
            {label}
            <ArrowRight className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 md:h-5 md:w-5" />
          </Link>
        ))}
        <Link
          href="/explorer"
          className="group flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-base font-medium text-white/80 transition hover:bg-white/10 hover:text-white md:px-5 md:py-2.5 md:text-lg"
        >
          {moreCount != null ? `${moreCount}+` : "100+"} more
          <ArrowRight className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 md:h-5 md:w-5" />
        </Link>
      </div>
    </div>
  );
}
