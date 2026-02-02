"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

const PLACEHOLDER_EXAMPLES = [
  "Air quality in Oakland",
  "Weather stations near San Francisco",
  "Ocean buoys in the Pacific",
  "River sensors with water temperature",
  "PM2.5 monitors",
  "Dissolved oxygen in rivers",
  "Wave height and wind speed",
];

const SUGGESTION_CHIPS = [
  { label: "Air quality", q: "air quality" },
  { label: "Ocean buoys", q: "buoy" },
  { label: "River sensors", q: "river" },
  { label: "Weather stations", q: "weather" },
  { label: "PM2.5", q: "PM2.5" },
  { label: "Water temperature", q: "water temperature" },
];

const CYCLE_MS = 3500;

export default function SearchInput() {
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-3">
      <form
        action="/explorer"
        method="get"
        className="relative flex w-full max-w-2xl items-center rounded-2xl border border-white/15 bg-white/[0.07] shadow-lg shadow-black/20 transition focus-within:border-white/25 focus-within:bg-white/[0.09] focus-within:shadow-xl focus-within:shadow-black/25"
      >
        <input
          type="text"
          name="q"
          placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
          className="flex-1 bg-transparent py-4 pl-5 pr-4 text-[15px] text-white placeholder:text-white/45 focus:outline-none"
          aria-label="Search for sensors"
        />
        <button
          type="submit"
          className="mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-[#FD581E] hover:text-white"
          aria-label="Search"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {SUGGESTION_CHIPS.map((chip) => (
          <a
            key={chip.q}
            href={`/explorer?q=${encodeURIComponent(chip.q)}`}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            {chip.label}
          </a>
        ))}
      </div>
    </div>
  );
}
