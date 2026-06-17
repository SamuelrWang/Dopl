/**
 * Tunable configuration for the CrystalField background. Every visual knob
 * lives here so the effect can be retheme/retuned without touching the engine.
 */

/** One procedural prism "blade" — an elongated diamond baked into the tiles.
 *  ax/ay: start anchor as a fraction of the viewport (may be <0 or >1 = off-screen).
 *  angle: degrees the blade points. len: length as a fraction of the diagonal.
 *  wid: blade width in px. lit: which long edge carries the specular (+1 / -1). */
export type CrystalShard = {
  ax: number;
  ay: number;
  angle: number;
  len: number;
  wid: number;
  lit: number;
};

export type CrystalFieldConfig = {
  // grid
  tileSize: number; // edge-to-edge of a diamond's bounding box (px)
  maxTiles: number; // clamp on huge screens; tileSize grows to respect this

  // palette
  bg: string; // field background
  tileFront: string; // resting veil (front face)
  seam: string; // faint darker seam between resting diamonds
  emptyBack: string; // back face where no prism lives (faint cool facet)
  prismA: string; // rose-pink (cross-axis gradient stop)
  prismB: string; // lilac
  prismC: string; // periwinkle
  specular: string; // bright near-white edge / mid-flip glint
  seamLit: string; // deep-violet facet seam on lit faces

  shards: CrystalShard[];

  // cursor reveal
  revealRadius: number; // px
  cursorFalloff: number; // higher = sharper center, dimmer edge

  // ambient ripple
  rippleEnabled: boolean;
  ripplePeriod: number; // ms for one full sweep
  rippleBand: number; // px width of the soft flip band
  rippleAngle: number; // base travel direction (deg)
  rippleAngleDrift: number; // deg/ms slow rotation of the wavefront
  ripplePeak: number; // max excitation a ripple delivers (0..1)
  ripple2: boolean; // a second crossing ripple
  ripple2Period: number;
  ripple2AngleOffset: number;
  ripple2Peak: number;
  rippleJitter: number; // px of per-tile projection jitter (organic edge / stagger)

  // timing / easing (ms)
  flipDuration: number; // front -> back
  flipAxisDeg: number; // axis the flip collapses along (0 = vertical sliver, 45 = diagonal)
  flipPerspective: number; // camera distance in tile-halves; lower = stronger 3D foreshortening
  lingerDuration: number; // hold lit after trigger passes
  driftBackDuration: number; // back -> front
  afterglowFactor: number; // bloom fades this much slower than the flip back

  // look
  glowStrength: number; // max shadowBlur px on a fully-lit bloom
  glowThreshold: number; // only bloom faces brighter than this (perf)
  litFloor: number; // dimmest a revealed back face draws (afterglow base)
  glintStrength: number; // intensity of the mid-flip white glint
};

export const DEFAULT_CRYSTAL_CONFIG: CrystalFieldConfig = {
  tileSize: 30,
  maxTiles: 14000,

  bg: "#07070B",
  tileFront: "#0C0C14",
  seam: "#05050A",
  emptyBack: "#101019",
  prismA: "#F5B8CE",
  prismB: "#C9B6E8",
  prismC: "#A9C2EC",
  specular: "#F2F4FF",
  seamLit: "#2A2540",

  shards: [
    { ax: -0.06, ay: 0.12, angle: 34, len: 0.62, wid: 150, lit: 1 }, // long, top-left
    { ax: 1.06, ay: 0.86, angle: 212, len: 0.58, wid: 138, lit: -1 }, // long, bottom-right
    { ax: 0.96, ay: -0.06, angle: 128, len: 0.34, wid: 92, lit: 1 }, // short, top-right
    { ax: 0.08, ay: 1.07, angle: -68, len: 0.3, wid: 80, lit: -1 }, // short, bottom-left
  ],

  revealRadius: 150,
  cursorFalloff: 1.7,

  rippleEnabled: true,
  ripplePeriod: 9000,
  rippleBand: 220,
  rippleAngle: 28,
  rippleAngleDrift: 0.018,
  ripplePeak: 0.9,
  ripple2: true,
  ripple2Period: 13000,
  ripple2AngleOffset: 74,
  ripple2Peak: 0.6,
  rippleJitter: 9,

  flipDuration: 300,
  flipAxisDeg: 45,
  flipPerspective: 2.2,
  lingerDuration: 1200,
  driftBackDuration: 900,
  afterglowFactor: 1.45,

  glowStrength: 16,
  glowThreshold: 0.22,
  litFloor: 0.74,
  glintStrength: 0.95,
};
