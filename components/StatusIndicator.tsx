"use client";

import { useEffect, useState } from "react";
import { getSensors } from "@/lib/sensors-api";

export default function StatusIndicator() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSensors({ limit: 1 })
      .then(() => setLoading(false))
      .catch(() => setLoading(false));
  }, []);

  return (
    <span
      className={`flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-sm dot-grid-status ${loading ? "loading" : "live"}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${loading ? "animate-pulse bg-[#FD581E]" : "bg-[#9AB07F]"}`}
        aria-hidden
      />
      {loading ? "Loading" : "Live"}
    </span>
  );
}
