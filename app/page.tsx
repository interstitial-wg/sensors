import { Globe } from "lucide-react";
import DotGrid from "@/components/DotGrid";

export default function Home() {
  return (
    <div className="relative flex h-screen bg-[#1a1a1a] text-white">
      {/* Logo - Atlas globe + text in upper left, p-6 like other items */}
      <div className="absolute left-0 top-0 z-20 flex items-center gap-2 p-6">
        <Globe
          className="h-5 w-5 shrink-0 text-white/95 md:h-6 md:w-6"
          strokeWidth={1.5}
          aria-hidden
        />
        <span className="text-base font-medium text-white/95 md:text-lg">
          Sensors from Atlas
        </span>
      </div>

      {/* Left 50%: body text, input+button bottom-left */}
      <header className="relative z-10 flex w-1/2 flex-col pl-6 pr-8 pt-20 pb-12 md:pl-6 md:pr-12 md:pt-24 md:pb-16">
        {/* Body text */}
        <div className="mt-8 max-w-md space-y-4 text-lg leading-relaxed text-white/80 md:text-xl">
          <p>
            Sensors is an exploration of the invisible infrastructure measuring
            our built environment—weather stations, air quality monitors, water
            gauges, seismic sensors—quietly collecting data that shapes how we
            understand the world.
          </p>
          <p>
            We&rsquo;re building{" "}
            <a
              href="https://atlas.planetary.software"
              className="text-white underline decoration-white/40 underline-offset-2 transition hover:decoration-white/80"
            >
              Atlas
            </a>{" "}
            as a substrate for AI systems to perceive the physical world through
            these sensor networks.
          </p>
          <p>
            <a
              href="https://interstitial.systems"
              className="text-white underline decoration-white/40 underline-offset-2 transition hover:decoration-white/80"
            >
              Interstitial Systems
            </a>{" "}
            is a research studio focused on making the unseen seen. We identify
            and explore the &lsquo;in-between&rsquo; layers that connect fields
            of interest, uncovering opportunities for positive climate impact.
            Our current efforts are focused on enabling AI to better understand
            the built environment.
          </p>
        </div>

        {/* Live stats line */}
        <p className="mt-2 text-sm text-white/50">
          Indexing{" "}
          <span className="font-medium text-[var(--color-metric-green)]">
            12,847
          </span>{" "}
          sensors across{" "}
          <span className="font-medium text-[var(--color-metric-green)]">
            8
          </span>{" "}
          sources
        </p>

        {/* Data source badges */}
        <div className="mt-4 flex flex-wrap gap-2">
          {["NOAA", "USGS", "PurpleAir", "EPA", "EMODnet", "AirNow"].map(
            (source) => (
              <span
                key={source}
                className="rounded-full border border-white/20 bg-white/5 px-2.5 py-0.5 text-xs text-white/60"
              >
                {source}
              </span>
            ),
          )}
        </div>

        {/* Blank space */}
        <div className="min-h-0 flex-1" />

        {/* Bottom left: search input + Explore button */}
        <div className="shrink-0 space-y-3">
          <form action="/explorer" method="get" className="flex flex-col gap-3">
            <input
              type="text"
              name="q"
              placeholder="What datasets are you looking for?"
              className="w-full max-w-sm rounded-md border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
              aria-label="Search for datasets"
            />
            <button
              type="submit"
              className="w-fit rounded-md bg-white px-5 py-2.5 text-sm font-medium text-[#1a1a1a] transition hover:bg-white/90"
            >
              Explore sensors
            </button>
          </form>
        </div>

        {/* Early access banner */}
        <p className="mt-6 text-xs text-white/45">
          Atlas is in active development. This demo shows what&rsquo;s possible.
        </p>

        {/* Footer */}
        <footer className="mt-auto shrink-0 pt-8 text-xs text-white/50">
          <nav
            className="flex flex-wrap gap-x-4 gap-y-1"
            aria-label="External links"
          >
            <a
              href="https://interstitial.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/30 underline-offset-2 transition hover:text-white/70 hover:decoration-white/50"
            >
              Interstitial Systems
            </a>
            <a
              href="https://github.com/interstitial-systems"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/30 underline-offset-2 transition hover:text-white/70 hover:decoration-white/50"
            >
              GitHub
            </a>
            <a
              href="https://atlas.planetary.software"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/30 underline-offset-2 transition hover:text-white/70 hover:decoration-white/50"
            >
              Atlas
            </a>
            <a
              href="https://bsky.app/profile/interstitial.bsky.social"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-white/30 underline-offset-2 transition hover:text-white/70 hover:decoration-white/50"
            >
              Bluesky
            </a>
          </nav>
        </footer>
      </header>

      {/* Right 50%: dense dot grid with twinkle - fills entire half */}
      <div className="h-screen w-1/2 overflow-hidden p-6">
        <DotGrid fill className="opacity-90" twinkle />
      </div>
    </div>
  );
}
