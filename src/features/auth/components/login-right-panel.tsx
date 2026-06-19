"use client";

import { CrystalField } from "@/shared/design/crystal-field";
import { LiquidGlass } from "@/shared/design";

/** Portrait tuning for the tall panel:
 *  - instant reveal (flip/drift durations ~0) — tiles convert, don't animate
 *  - straight-sided crystal columns that taper to a point (high bladeKnee)
 *  - spaced anchors with gaps so there's negative space between columns
 *  - mixed depth (dark = further back) + stronger facet shade for edge depth */
const PANEL_CRYSTAL_CONFIG = {
  tileSize: 13,
  maxTiles: 9000,
  revealRadius: 120,

  flipDuration: 1,
  driftBackDuration: 1,
  lingerDuration: 900,

  bladeKnee: 0.86,
  facetShade: 0.62,
  facetEdge: 0.5,
  depthDarken: 0.8,

  shards: [
    { ax: 0.1, ay: 1.08, angle: -90, len: 0.46, wid: 56, depth: 0.32, hue: 0.15 },
    { ax: 0.26, ay: 1.1, angle: -90, len: 0.64, wid: 74, depth: 0.92, hue: 0.3 },
    { ax: 0.42, ay: 1.07, angle: -90, len: 0.4, wid: 48, depth: 0.26, hue: 0.55 },
    { ax: 0.55, ay: 1.11, angle: -90, len: 0.58, wid: 80, depth: 0.86, hue: 0.42 },
    { ax: 0.7, ay: 1.08, angle: -90, len: 0.5, wid: 58, depth: 0.5, hue: 0.7 },
    { ax: 0.86, ay: 1.1, angle: -90, len: 0.66, wid: 76, depth: 0.95, hue: 0.2 },
    { ax: 0.96, ay: 1.06, angle: -90, len: 0.36, wid: 42, depth: 0.24, hue: 0.85 },
  ],
};

/** Right column: a black rounded panel with the crystal field contained inside
 *  it (not full-screen), fronted by a liquid-glass card. Hidden on mobile. */
export function LoginRightPanel() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[32px] bg-[#060A0F]">
      <CrystalField mode="container" config={PANEL_CRYSTAL_CONFIG} />

      {/* Liquid-glass card — refracts the crystal field behind it. Equal side
          insets + matching bottom inset keep it balanced in the panel. */}
      <LiquidGlass
        radius={26}
        scale={38}
        blur={3}
        className="absolute inset-x-[7%] bottom-[7%] h-[24%] min-h-[150px]"
      >
        <div className="flex h-full flex-col justify-center p-[7%]">
          <h3 className="max-w-[280px] text-[19px] font-semibold leading-[1.2] text-white">
            Get your right job and right place apply now
          </h3>
          <p className="mt-3 max-w-[230px] text-[13px] font-light leading-[1.45] text-[#d3d3d3]">
            Be among the first founders to experience the easiest way to start run a business.
          </p>
          <div className="absolute bottom-[16%] right-[7%] flex">
            <Avatar gradient="linear-gradient(135deg,#e6c4a8,#9c6b4a)" />
            <Avatar gradient="linear-gradient(135deg,#3a3f4a,#1a1d24)" className="-ml-2.5" />
            <Avatar gradient="linear-gradient(135deg,#d8b89a,#6e4a32)" className="-ml-2.5" />
            <div className="-ml-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[#2b2b2b] bg-[#3a3a3a] text-[10px] font-medium text-white">
              +2
            </div>
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
}

function Avatar({ gradient, className = "" }: { gradient: string; className?: string }) {
  return (
    <div
      className={`h-[30px] w-[30px] rounded-full border-2 border-[#2b2b2b] ${className}`}
      style={{ background: gradient }}
    />
  );
}
