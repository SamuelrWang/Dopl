"use client";

import { CrystalField } from "@/shared/design/crystal-field";
import { LiquidGlass } from "@/shared/design";

/** Portrait shard tuning: the default field is tuned wide; in this tall, narrow
 *  panel we want smaller diamonds and a denser cluster rising from the floor. */
const PANEL_CRYSTAL_CONFIG = {
  tileSize: 16,
  maxTiles: 6000,
  revealRadius: 120,
};

/** Right column: a black rounded panel with the crystal field contained inside
 *  it (not full-screen), fronted by a liquid-glass card. Hidden on mobile. */
export function LoginRightPanel() {
  return (
    <div className="relative hidden h-full w-full overflow-hidden rounded-[40px] bg-[#060A0F] md:block">
      <CrystalField mode="container" config={PANEL_CRYSTAL_CONFIG} />

      {/* Liquid-glass card — refracts the crystal field behind it. */}
      <LiquidGlass
        radius={36}
        scale={42}
        blur={3}
        className="absolute inset-x-[7%] bottom-[6%] h-[27%] min-h-[210px]"
      >
        <div className="flex h-full flex-col justify-center p-[7%]">
          <h3 className="max-w-[360px] text-[28px] font-semibold leading-[1.2] text-white">
            Get your right job and right place apply now
          </h3>
          <p className="mt-6 max-w-[300px] text-[18px] font-light leading-[1.45] text-[#d3d3d3]">
            Be among the first founders to experience the easiest way to start run a business.
          </p>
          <div className="absolute bottom-[14%] right-[8%] flex">
            <Avatar gradient="linear-gradient(135deg,#e6c4a8,#9c6b4a)" />
            <Avatar gradient="linear-gradient(135deg,#3a3f4a,#1a1d24)" className="-ml-3" />
            <Avatar gradient="linear-gradient(135deg,#d8b89a,#6e4a32)" className="-ml-3" />
            <div className="-ml-3 flex h-[42px] w-[42px] items-center justify-center rounded-full border-2 border-[#2b2b2b] bg-[#3a3a3a] text-[12px] font-medium text-white">
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
      className={`h-[42px] w-[42px] rounded-full border-2 border-[#2b2b2b] ${className}`}
      style={{ background: gradient }}
    />
  );
}
