import DotGrid from "@/components/DotGrid";
import { NavDropdown } from "@/components/NavDropdown";
import StatusIndicator from "@/components/StatusIndicator";
import SearchInput from "@/components/SearchInput";
import { StatsProvider } from "@/components/StatsProvider";
import SourceSection from "@/components/SourceSection";
import FooterStats from "@/components/FooterStats";

export default function Home() {
  return (
    <StatsProvider>
      <div className="relative flex h-screen flex-col bg-[#1a1a1a] text-white">
        {/* Main content area */}
        <div className="relative flex min-h-0 flex-1">
          {/* Header - Sensors dropdown */}
          <div className="absolute left-0 top-0 z-20 p-6">
            <NavDropdown />
          </div>

          {/* Left 50%: body text, input+button bottom-left */}
          <header className="relative z-10 flex w-1/2 flex-col pl-6 pr-8 pt-20 pb-12 md:pl-6 md:pr-12 md:pt-24 md:pb-16">
            {/* Body text */}
            <div className="mt-8 max-w-md space-y-4 text-[24px] leading-relaxed text-white/80">
              <p>
                Sensors is an exploration of the invisible infrastructure
                measuring our built environment: weather stations, air quality
                monitors, water gauges, seismic sensors, quietly collecting data
                that shapes how we understand the world.
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
                impact. Our current efforts are focused on enabling AI to better
                understand the built environment.
              </p>
            </div>

            {/* SOURCE section */}
            <SourceSection />

            {/* Blank space */}
            <div className="min-h-0 flex-1" />

            {/* Search bar - chat-style input with cycling examples + suggestions */}
            <div className="shrink-0">
              <SearchInput />
            </div>
          </header>

          {/* Right 50%: dot grid with footer inside */}
          <div className="flex h-full w-1/2 flex-col overflow-hidden bg-[#1a1a1a]">
            <div className="flex min-h-0 flex-1 flex-col pl-6 pr-3 pt-6">
              <div className="min-h-0 flex-1">
                <DotGrid fill className="h-full opacity-90" twinkle />
              </div>
              <footer className="flex shrink-0 items-center justify-between gap-4 pb-6 pt-0 pr-3">
                <FooterStats />
                <StatusIndicator />
              </footer>
            </div>
          </div>
        </div>
      </div>
    </StatsProvider>
  );
}
