"use client";

import { useCallback, useState } from "react";
import { CornerRightDown } from "lucide-react";
import DotGrid from "@/components/DotGrid";
import FooterStats from "@/components/FooterStats";
import StatusIndicator from "@/components/StatusIndicator";

export default function DotGridSection() {
  const [gridWidthPx, setGridWidthPx] = useState<number | null>(null);

  const handleDimensionsChange = useCallback(
    (d: { cols: number; rows: number; widthPx: number }) => {
      setGridWidthPx(d.widthPx);
    },
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pl-6 pr-3 pt-6">
      {/* Hint (left) + Grid (right) - side by side, no overlap */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Vertical hint: hover over grid items - fixed width column */}
        <div
          className="flex shrink-0 items-center justify-center pr-3"
          aria-hidden
        >
          <span
            className="flex rotate-180 flex-row items-center gap-1.5 text-sm font-medium tracking-wide text-white/50 select-none"
            style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
          >
            explore sensors
            <CornerRightDown
              className="-ml-2.5 size-4 shrink-0 rotate-90"
              aria-hidden
            />
          </span>
        </div>
        {/* Grid area */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DotGrid
            fill
            className="h-full opacity-90"
            twinkle
            onDimensionsChange={handleDimensionsChange}
          />
        </div>
      </div>
      {/* Footer: same width as grid, right-aligned to match grid (marginLeft: auto mirrors DotGrid) */}
      <div
        className="flex shrink-0 pb-6 pt-0"
        style={{
          width: gridWidthPx != null ? gridWidthPx : "100%",
          marginLeft: gridWidthPx != null ? "auto" : undefined,
        }}
      >
        <footer className="flex w-full items-center justify-between gap-4">
          <FooterStats />
          <StatusIndicator />
        </footer>
      </div>
    </div>
  );
}
