"use client";

import { CrystalField, LiquidGlass, type CrystalFieldConfig } from "@/shared/design";

/** Landscape tuning of the crystal field for the wide hero panel — sparse thin
 *  shards hanging from top + bottom, same family as the auth panel. */
const HERO_CRYSTAL_CONFIG: Partial<CrystalFieldConfig> = {
  tileSize: 13,
  maxTiles: 9000,
  shardWidthScale: 1,
  shards: [
    { ax: 0.06, ay: -0.1, angle: 90, len: 0.34, wid: 18, depth: 0.3, hue: 0.5 },
    { ax: 0.18, ay: -0.08, angle: 92, len: 0.52, wid: 44, depth: 0.85, hue: 0.2 },
    { ax: 0.31, ay: -0.11, angle: 88, len: 0.36, wid: 18, depth: 0.3, hue: 0.78 },
    { ax: 0.46, ay: -0.09, angle: 91, len: 0.46, wid: 24, depth: 0.55, hue: 0.4 },
    { ax: 0.6, ay: -0.1, angle: 89, len: 0.34, wid: 18, depth: 0.28, hue: 0.62 },
    { ax: 0.74, ay: -0.08, angle: 92, len: 0.5, wid: 42, depth: 0.75, hue: 0.08 },
    { ax: 0.88, ay: -0.11, angle: 90, len: 0.4, wid: 20, depth: 0.4, hue: 0.92 },
    { ax: 0.12, ay: 1.1, angle: -91, len: 0.4, wid: 22, depth: 0.4, hue: 0.15 },
    { ax: 0.27, ay: 1.12, angle: -88, len: 0.58, wid: 46, depth: 0.9, hue: 0.32 },
    { ax: 0.42, ay: 1.09, angle: -90, len: 0.4, wid: 20, depth: 0.35, hue: 0.7 },
    { ax: 0.57, ay: 1.11, angle: -92, len: 0.5, wid: 26, depth: 0.6, hue: 0.48 },
    { ax: 0.72, ay: 1.13, angle: -89, len: 0.62, wid: 48, depth: 0.92, hue: 0.12 },
    { ax: 0.86, ay: 1.08, angle: -90, len: 0.38, wid: 18, depth: 0.28, hue: 0.88 },
  ],
  flipDuration: 650,
  driftBackDuration: 650,
  lingerDuration: 700,
  flipLinear: true,
  cursorFlipDuration: 140,
  cursorLinger: 0,
};

/** The hero's right side: recessed black crystal panel with a raised liquid-glass
 *  card floating above it — the same 3D language as the login panel. */
export function HeroVisual() {
  return (
    <div className="dopl-hero-panel">
      <CrystalField mode="container" config={HERO_CRYSTAL_CONFIG} />

      {/* Concave recess — inner vignette above the crystal canvas. */}
      <div className="dopl-hero-recess" aria-hidden />

      <LiquidGlass radius={22} scale={56} className="dopl-hero-glass">
        <div className="dopl-flowcard">
          <span className="dopl-flowcard-label">From intent to action</span>
          <div className="dopl-flowrow">
            <Node kind="human" label="You" />
            <Wire />
            <Node kind="agent" label="Agent" />
            <Wire />
            <Node kind="action" label="Done" />
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
}

function Node({ kind, label }: { kind: "human" | "agent" | "action"; label: string }) {
  return (
    <div className="dopl-flownode">
      <span className={`dopl-flowdot dopl-flowdot--${kind}`} />
      <span className="dopl-flowname">{label}</span>
    </div>
  );
}

function Wire() {
  return (
    <svg className="dopl-flowwire" viewBox="0 0 40 8" fill="none" aria-hidden>
      <path d="M0 4h32" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="m30 1 6 3-6 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
