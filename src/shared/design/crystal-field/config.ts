/**
 * Tunable configuration for the CrystalField background. Every visual knob
 * lives here so the effect can be retheme/retuned without touching the engine.
 */

/** One procedural prism column baked into the tiles.
 *  ax/ay: base anchor as a fraction of the viewport (usually off-screen — the
 *    wide rectangular end). angle: degrees the column points (≈ -90 grows up
 *    from the floor, ≈ +90 hangs down from the ceiling). len: length as a
 *    fraction of the diagonal. wid: column width in px.
 *  depth: 0 = far (dark, recedes, behind), 1 = near (bright, occludes far).
 *  hue: 0..1 position in prismStops — the column's base color (0 = cyan end). */
export type CrystalShard = {
  ax: number;
  ay: number;
  angle: number;
  len: number;
  wid: number;
  depth: number;
  hue: number;
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
  prismStops: string[]; // crystal color ramp (cyan -> ... -> magenta/pink); columns pick a window of it
  specular: string; // bright near-white edge / mid-flip glint
  seamLit: string; // deep-violet facet seam on lit faces

  shards: CrystalShard[];
  depthDarken: number; // how dark the farthest column (depth=0) goes vs nearest (depth=1); 0..1
  hueSpread: number; // width of the ramp window a single column spans across its faces; 0..1

  // shape — where along a column the full-width body cones to its tip. Higher =
  // more of a straight-sided prism rising to a point near the top; lower = a
  // triangular/mountain silhouette.
  bladeKnee: number; // 0..1 (fraction of length kept full-width before coning)

  // facets — vertical faces that give a column its 3D solidity
  facetCount: number; // faces across a column's width
  facetShade: number; // max brightness drop on faces angled away from the light; 0..1
  facetEdge: number; // brightness of the edge highlight line between faces; 0..1

  // cave environment
  vignette: number; // how much the field darkens toward the edges; 0..1
  haze: number; // strength of the central purple ambient glow filling the voids; 0..1
  hazeColor: string; // color of that ambient haze
  rock: number; // strength of the mottled rock fill in the voids (the cave walls); 0..1
  rockColor: string; // base color of the cave rock

  // cursor reveal
  revealRadius: number; // px
  cursorFalloff: number; // higher = sharper center, dimmer edge

  // ambient — organic drifting noise field (not a marching wavefront)
  ambientEnabled: boolean;
  ambientScale: number; // px feature size of the organic patches (bigger = larger blobs)
  ambientSpeed: number; // evolution / drift speed
  ambientWarp: number; // domain-warp amount — distorts patches off the grid axes
  ambientThreshold: number; // 0..1; higher = sparser coverage (only noise peaks reveal)
  ambientSoftness: number; // edge softness of each patch (0..1)
  ambientPeak: number; // max excitation a patch delivers (0..1)
  ambientJitter: number; // per-tile noise jitter (organic break-up of patch edges)

  // timing / easing (ms)
  flipDuration: number; // front -> back
  flipAxisDeg: number; // axis the flip collapses along (0 = vertical sliver, 45 = diagonal)
  flipPerspective: number; // camera distance in tile-halves; lower = stronger 3D foreshortening
  lingerDuration: number; // hold lit after trigger passes
  driftBackDuration: number; // back -> front
  afterglowFactor: number; // bloom fades this much slower than the flip back

  // look
  litFloor: number; // dimmest a revealed back face draws (afterglow base)
  glintStrength: number; // intensity of the mid-flip glint
};

export const DEFAULT_CRYSTAL_CONFIG: CrystalFieldConfig = {
  tileSize: 30,
  maxTiles: 14000,

  bg: "#060A0F",
  tileFront: "#0B0F15",
  seam: "#05080C",
  emptyBack: "#0A1019",
  // Cool slate-blue → azure → cyan → teal → ice (drawn from the app's blue
  // accent + slate chrome; no purple).
  prismStops: ["#1E4D7A", "#2E78B8", "#2FA6C8", "#5AD2CE", "#A8E6DC"],
  specular: "#EAF6FF",
  seamLit: "#1E2A38",

  // A vertical crystal cluster, mirroring the cave reference: a dense forest of
  // columns rising from a base just off the bottom (angle ≈ -90), plus a few
  // hanging from the ceiling (angle ≈ +90). Hues spread across the ramp so some
  // read deep blue, others cyan/ice. Far columns (low depth) read dark and
  // recede; near ones (high depth) stay bright and draw on top.
  shards: [
    { ax: 0.14, ay: 1.1, angle: -94, len: 0.52, wid: 120, depth: 0.9, hue: 0.12 }, // front-left, cyan, big
    { ax: 0.26, ay: 1.12, angle: -86, len: 0.4, wid: 76, depth: 0.5, hue: 0.32 }, // blue
    { ax: 0.36, ay: 1.08, angle: -91, len: 0.58, wid: 60, depth: 0.3, hue: 0.5 }, // tall thin, violet, back
    { ax: 0.46, ay: 1.13, angle: -89, len: 0.46, wid: 84, depth: 0.62, hue: 0.82 }, // magenta
    { ax: 0.56, ay: 1.09, angle: -92, len: 0.36, wid: 56, depth: 0.4, hue: 0.24 }, // teal, back-ish
    { ax: 0.66, ay: 1.12, angle: -88, len: 0.5, wid: 70, depth: 0.55, hue: 0.66 }, // violet-magenta
    { ax: 0.86, ay: 1.09, angle: -96, len: 0.56, wid: 132, depth: 0.97, hue: 0.72 }, // front-right, biggest
    { ax: 0.74, ay: 1.13, angle: -90, len: 0.34, wid: 50, depth: 0.36, hue: 0.42 }, // small filler, back
    { ax: 0.2, ay: 1.11, angle: -90, len: 0.3, wid: 48, depth: 0.45, hue: 0.95 }, // small pink filler
    { ax: 0.24, ay: -0.1, angle: 88, len: 0.34, wid: 62, depth: 0.22, hue: 0.55 }, // hanging, far dim
    { ax: 0.6, ay: -0.08, angle: 92, len: 0.3, wid: 56, depth: 0.28, hue: 0.86 }, // hanging, far dim
    { ax: 0.92, ay: -0.12, angle: 90, len: 0.4, wid: 70, depth: 0.7, hue: 0.04 }, // hanging cyan, nearer
  ],
  depthDarken: 0.74,
  hueSpread: 0.16,

  bladeKnee: 0.6,
  facetCount: 3,
  facetShade: 0.5,
  facetEdge: 0.45,

  vignette: 0.6,
  haze: 0.32,
  hazeColor: "#15243A",
  rock: 0.7,
  rockColor: "#141C26",

  revealRadius: 150,
  cursorFalloff: 1.7,

  ambientEnabled: true,
  ambientScale: 300,
  ambientSpeed: 0.5,
  ambientWarp: 0.65,
  ambientThreshold: 0.62,
  ambientSoftness: 0.22,
  ambientPeak: 0.85,
  ambientJitter: 0.05,

  flipDuration: 300,
  flipAxisDeg: 45,
  flipPerspective: 2.2,
  lingerDuration: 1200,
  driftBackDuration: 1100, // steady linear return; longer = more gradual flip-back
  afterglowFactor: 1.45,

  litFloor: 0.74,
  glintStrength: 0.95,
};
