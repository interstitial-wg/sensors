"use client";

import { DraftingCompass, Building2 } from "lucide-react";
import { useStats } from "@/components/StatsProvider";

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export default function FooterStats() {
  const stats = useStats();

  const sensorsLabel = stats
    ? `${formatCount(stats.sensors)} Sensors`
    : "— Sensors";
  const agenciesLabel = stats
    ? `${formatCount(stats.agencies)} Agencies`
    : "— Agencies";

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/80">
        <DraftingCompass className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {sensorsLabel}
      </span>
      <span className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/80">
        <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {agenciesLabel}
      </span>
    </div>
  );
}
