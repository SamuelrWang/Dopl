"use client";

import { CrystalField } from "@/shared/design/crystal-field";
import { LiquidGlass } from "@/shared/design";

/** Portrait tuning for the tall auth panel: the original thin, sparse crystal
 *  look (default-style shards, hand-scaled for ~680px) with instant cursor
 *  flips and a slow trailing ambient. Shared by login + onboarding. */
const PANEL_CRYSTAL_CONFIG = {
  tileSize: 13,
  maxTiles: 9000,
  shardWidthScale: 1,
  shards: [
    { ax: 0.08, ay: 1.1, angle: -92, len: 0.46, wid: 22, depth: 0.4, hue: 0.15 },
    { ax: 0.16, ay: 1.12, angle: -88, len: 0.6, wid: 46, depth: 0.9, hue: 0.3 },
    { ax: 0.24, ay: 1.08, angle: -91, len: 0.42, wid: 20, depth: 0.3, hue: 0.55 },
    { ax: 0.33, ay: 1.11, angle: -90, len: 0.5, wid: 26, depth: 0.6, hue: 0.72 },
    { ax: 0.43, ay: 1.13, angle: -93, len: 0.66, wid: 52, depth: 0.95, hue: 0.22 },
    { ax: 0.52, ay: 1.09, angle: -89, len: 0.4, wid: 18, depth: 0.35, hue: 0.85 },
    { ax: 0.61, ay: 1.12, angle: -91, len: 0.54, wid: 28, depth: 0.55, hue: 0.45 },
    { ax: 0.7, ay: 1.1, angle: -87, len: 0.44, wid: 22, depth: 0.4, hue: 0.65 },
    { ax: 0.8, ay: 1.12, angle: -94, len: 0.62, wid: 48, depth: 0.92, hue: 0.12 },
    { ax: 0.9, ay: 1.08, angle: -90, len: 0.38, wid: 18, depth: 0.28, hue: 0.9 },
    { ax: 0.1, ay: -0.1, angle: 90, len: 0.4, wid: 20, depth: 0.35, hue: 0.5 },
    { ax: 0.22, ay: -0.08, angle: 92, len: 0.54, wid: 44, depth: 0.8, hue: 0.2 },
    { ax: 0.35, ay: -0.11, angle: 88, len: 0.36, wid: 18, depth: 0.3, hue: 0.78 },
    { ax: 0.5, ay: -0.09, angle: 91, len: 0.46, wid: 24, depth: 0.55, hue: 0.4 },
    { ax: 0.64, ay: -0.1, angle: 89, len: 0.34, wid: 18, depth: 0.28, hue: 0.62 },
    { ax: 0.78, ay: -0.08, angle: 92, len: 0.5, wid: 42, depth: 0.75, hue: 0.08 },
    { ax: 0.9, ay: -0.11, angle: 90, len: 0.38, wid: 20, depth: 0.4, hue: 0.92 },
  ],
  flipDuration: 650,
  driftBackDuration: 650,
  lingerDuration: 700,
  flipLinear: true,
  lingerExciteScale: false,
  cursorFlipDuration: 140,
  cursorLinger: 0,
};

/** Black rounded panel with the contained crystal field + a liquid-glass card.
 *  The right half of the auth split layout. */
export function AuthCrystalPanel() {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[32px] bg-[#060A0F]"
      // Seat the panel into the page: faint highlight just below the bottom lip.
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.6)" }}
    >
      <CrystalField mode="container" config={PANEL_CRYSTAL_CONFIG} />

      {/* Concave recess — inner vignette layered above the opaque crystal canvas
          (pointer-events-none so cursor flips still reach it), below the glass.
          Dark upper lip + all-around inner shade + lit lower lip = pressed-in. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[32px]"
        style={{
          boxShadow:
            "inset 0 8px 22px rgba(0,0,0,0.9), " +
            "inset 0 40px 80px rgba(0,0,0,0.5), " +
            "inset 0 0 50px rgba(0,0,0,0.45), " +
            "inset 0 -2px 1px rgba(255,255,255,0.10), " +
            "inset 0 0 0 1px rgba(0,0,0,0.45)",
        }}
      />

      <LiquidGlass
        radius={26}
        scale={60}
        className="absolute inset-x-[7%] bottom-[7%] h-[24%] min-h-[150px]"
      >
        <div className="flex h-full flex-col justify-center p-[7%]">
          <h3 className="max-w-[300px] text-[19px] font-semibold leading-[1.2] text-white">
            Bring your whole team along to Dopl
          </h3>
          <p className="mt-3 max-w-[250px] text-[13px] font-light leading-[1.45] text-[#d3d3d3]">
            Invite your teammates to build, share, and run your agent setups together — everything your team knows, in one shared workspace.
          </p>
          <div className="absolute bottom-[16%] right-[7%] flex">
            <Avatar src="https://randomuser.me/api/portraits/women/44.jpg" />
            <Avatar src="https://randomuser.me/api/portraits/men/32.jpg" className="-ml-2.5" />
            <Avatar src="https://randomuser.me/api/portraits/women/68.jpg" className="-ml-2.5" />
            <div className="-ml-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[#2b2b2b] bg-[#3a3a3a] text-[10px] font-medium text-white">
              +2
            </div>
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
}

function Avatar({ src, className = "" }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`h-[30px] w-[30px] rounded-full border-2 border-[#2b2b2b] object-cover ${className}`}
    />
  );
}
