import { Suspense } from "react";
import DotGridSection from "@/components/DotGridSection";
import { NavDropdown } from "@/components/NavDropdown";
import StatusIndicator from "@/components/StatusIndicator";
import HomeSearchSection from "@/components/HomeSearchSection";
import { StatsProvider } from "@/components/StatsProvider";
import FooterStats from "@/components/FooterStats";

export default function Home() {
  return (
    <StatsProvider>
      <div className="relative flex h-screen min-h-screen flex-col bg-[#1a1a1a] text-white">
        {/* Main content area */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Header - Sensors dropdown */}
          <div className="absolute left-0 top-0 z-20 pl-3 pr-3 pt-3 pb-6">
            <NavDropdown />
          </div>

          {/* Left 50%: body text, input+button bottom-left (full width on small, hide dots) */}
          <header className="relative z-10 flex min-h-0 w-full flex-col overflow-hidden pl-6 pr-3 pt-20 pb-6 md:w-1/2 md:pt-12">
            {/* Scrollable content - top fades out before nav */}
            <div
              className="scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-4"
              style={{
                maskImage:
                  "linear-gradient(to bottom, transparent 0%, black 4rem)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0%, black 4rem)",
              }}
            >
              {/* Body text - pt-16 pushes below fade zone so text isn't faded on load */}
              <div className="max-w-md space-y-4 pt-16 text-base leading-relaxed text-white/80 md:text-lg lg:text-2xl">
                <p>
                  Sensors is an exploration of the invisible infrastructure
                  measuring our built environment: weather stations, air quality
                  monitors, water gauges, seismic sensors, quietly collecting
                  data that shapes how we understand the world.
                </p>
                <p>
                  We&rsquo;re building{" "}
                  <a
                    href="https://atlas.planetary.software"
                    className="text-white underline decoration-white/40 underline-offset-2 transition hover:decoration-white/80"
                  >
                    Atlas
                  </a>{" "}
                  as a substrate for AI systems to perceive the physical world
                  through these sensor networks.
                </p>
                <p>
                  <a
                    href="https://interstitial.systems"
                    className="text-white underline decoration-white/40 underline-offset-2 transition hover:decoration-white/80"
                  >
                    Interstitial Systems
                  </a>{" "}
                  is a research studio focused on making the unseen seen. We
                  identify and explore the in-between layers that connect fields
                  of interest, uncovering opportunities for positive climate
                  impact. Our current efforts are focused on enabling AI to
                  better understand the built environment.
                </p>
              </div>

              {/* Explore section - intro text + search input */}
              <Suspense fallback={<div className="mt-8 h-24" />}>
                <HomeSearchSection />
              </Suspense>
            </div>

            {/* Footer - visible only on small screens (dots hidden) */}
            <footer className="flex shrink-0 items-center justify-between gap-4 pb-6 pt-4 md:hidden">
              <FooterStats />
              <StatusIndicator />
            </footer>
          </header>

          {/* Right 50%: dot grid with footer aligned to grid width (hidden on small screens) */}
          <div className="hidden h-full min-h-0 flex-col overflow-hidden bg-[#1a1a1a] md:flex md:w-1/2">
            <DotGridSection />
          </div>
        </div>
      </div>
    </StatsProvider>
  );
}
