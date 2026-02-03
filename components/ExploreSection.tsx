"use client";

import Link from "next/link";

const EXPLORE_OPTIONS = [
  { label: "By location", href: "/explorer?q=location" },
  { label: "By sensor type", href: "/explorer?q=sensor" },
  { label: "By data source", href: "/explorer?q=source" },
];

export default function ExploreSection() {
  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/60">
        EXPLORE
      </p>
      <div className="flex flex-wrap gap-2">
        {EXPLORE_OPTIONS.map((option) => (
          <Link
            key={option.href}
            href={option.href}
            className="rounded bg-white/5 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
