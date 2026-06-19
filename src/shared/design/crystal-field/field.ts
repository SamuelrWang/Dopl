import type { CrystalFieldConfig } from "./config";
import { hexToRgb, lerpRgb, makePalette, prismRamp, smoothstep, type Rgb } from "./color";

// Half-width (in local-facet units) of the bright edge line between faces.
const FACET_EDGE_W = 0.16;
// Direction the faces are lit from, in facet-normal radians (-PI/2..PI/2).
const LIGHT_ANGLE = 0.5;
// Focal point of the cave (where the crystal cluster glows brightest) and how
// fast the vignette falls off toward the edges.
const FOCAL_X = 0.5;
const FOCAL_Y = 0.72;
const ENV_RADIUS = 1.3;

/** Static, per-tile data baked once per layout: diamond centers and the
 *  prism color sleeping behind each one. Dynamic flip state lives in the engine. */
export type TileField = {
  n: number;
  s: number; // diamond half-extent (half the bounding box)
  cx: Float32Array;
  cy: Float32Array;
  backR: Uint8ClampedArray;
  backG: Uint8ClampedArray;
  backB: Uint8ClampedArray;
  isPrism: Uint8Array;
  jit: Float32Array; // per-tile ripple projection jitter (organic stagger)
};

type Blade = {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  cx: number;
  cy: number;
  hl: number; // half length along the long axis
  hw: number; // half width across the short axis
  depth: number;
  hue: number; // center of this column's color window in the prism ramp (0..1)
};

// Sorted far -> near so the bake loop lets nearer blades override (occlude)
// farther ones simply by processing them last.
function precomputeBlades(cfg: CrystalFieldConfig, w: number, h: number, diag: number): Blade[] {
  return cfg.shards
    .map((sh) => {
      const rad = (sh.angle * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const sx = sh.ax * w;
      const sy = sh.ay * h;
      const hl = (sh.len * diag) / 2;
      return {
        ux,
        uy,
        vx: -uy,
        vy: ux,
        cx: sx + ux * hl,
        cy: sy + uy * hl,
        hl,
        hw: sh.wid / 2,
        depth: sh.depth,
        hue: sh.hue,
      };
    })
    .sort((a, b) => a.depth - b.depth);
}

/** Build the diamond grid and bake each tile's hidden prism color. */
export function buildField(w: number, h: number, cfg: CrystalFieldConfig): TileField {
  const diag = Math.hypot(w, h);
  const palette = makePalette(cfg);

  // grow the diamond half-extent until the tile count fits the clamp
  let s = cfg.tileSize / 2;
  const estimate = () => ((Math.floor(w / s) + 2) * (Math.floor(h / s) + 2)) / 2;
  while (estimate() > cfg.maxTiles) s *= 1.08;

  // diamond centers: square grid of spacing s, keeping only cells where
  // (i + j) is even — that interleave tessellates into a diamond lattice.
  const cols = Math.ceil(w / s) + 2;
  const rows = Math.ceil(h / s) + 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = -1; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      if (((i + j) & 1) !== 0) continue;
      xs.push(i * s);
      ys.push(j * s);
    }
  }

  const n = xs.length;
  const cx = new Float32Array(xs);
  const cy = new Float32Array(ys);
  const backR = new Uint8ClampedArray(n);
  const backG = new Uint8ClampedArray(n);
  const backB = new Uint8ClampedArray(n);
  const isPrism = new Uint8Array(n);
  const jit = new Float32Array(n);

  const blades = precomputeBlades(cfg, w, h, diag);

  const haze = hexToRgb(cfg.hazeColor);
  const rockRgb = hexToRgb(cfg.rockColor);

  for (let k = 0; k < n; k++) {
    jit[k] = Math.random() * 2 - 1; // unit; scaled by ambientJitter at runtime

    let col: Rgb = palette.empty;
    let inside = false;
    // blades are far -> near; a nearer match overrides (occludes) the running
    // color, so the closest column wins each tile.
    for (const b of blades) {
      const dx = cx[k] - b.cx;
      const dy = cy[k] - b.cy;
      const along = (dx * b.ux + dy * b.uy) / b.hl; // -1 = base, +1 = tip
      if (along < -1 || along > 1) continue;

      // width profile: full rectangle to the knee, then cone to a point
      const s = (along + 1) / 2; // 0 base .. 1 tip
      const prof = s < cfg.bladeKnee ? 1 : 1 - (s - cfg.bladeKnee) / (1 - cfg.bladeKnee);
      if (prof <= 0) continue;

      const across = (dx * b.vx + dy * b.vy) / b.hw;
      if (Math.abs(across) > prof) continue;
      const acrossLocal = across / prof; // -1..1 across the local width

      // split the width into vertical faces: each a distinct hue + light-angled
      // shade, with a bright edge line between — this is what reads as a solid.
      const u = (acrossLocal + 1) / 2; // 0..1
      const fi = Math.min(cfg.facetCount - 1, Math.floor(u * cfg.facetCount));
      const fLocal = u * cfg.facetCount - fi; // 0..1 within the face
      const facetT = (fi + 0.5) / cfg.facetCount;

      // each column occupies a narrow window of the ramp around its own hue, so
      // some columns read cyan, others violet/magenta — faces vary within it.
      let c = prismRamp(palette, b.hue + (facetT - 0.5) * cfg.hueSpread);
      const faceLight = 0.5 + 0.5 * Math.cos((facetT - 0.5) * Math.PI - LIGHT_ANGLE);
      const shade = 1 - cfg.facetShade * (1 - faceLight);
      const edgeDist = Math.min(fLocal, 1 - fLocal);
      const edgeHi = (1 - smoothstep(0, FACET_EDGE_W, edgeDist)) * cfg.facetEdge;
      c = lerpRgb(c, palette.spec, edgeHi);

      // dim into the point, by face shade, and by depth (far columns recede)
      const tip = 1 - smoothstep(0.8, 1, s) * 0.5;
      const dim = (1 - (1 - b.depth) * cfg.depthDarken) * shade * tip;
      c = [c[0] * dim + 5, c[1] * dim + 5, c[2] * dim + 7];
      col = inside ? lerpRgb(col, c, 0.85) : c;
      inside = true;
    }

    // voids become mottled rock (the cave walls), not flat black
    if (!inside) {
      const m = 0.5 + 0.5 * Math.sin(cx[k] * 0.05 + Math.sin(cy[k] * 0.04) * 1.5) * Math.cos(cy[k] * 0.06 - 1);
      const mottle = Math.min(1, Math.max(0, m + jit[k] * 0.08));
      col = lerpRgb(palette.empty, rockRgb, cfg.rock * mottle);
    }

    // cave environment: vignette toward the edges + central purple haze, so the
    // field reads as a glowing cavern rather than columns on a flat void.
    const dx = cx[k] / w - FOCAL_X;
    const dy = cy[k] / h - FOCAL_Y;
    const d = Math.min(1, Math.hypot(dx, dy) * ENV_RADIUS); // 0 focal .. 1 edge
    const vig = 1 - cfg.vignette * smoothstep(0.3, 1, d);
    const hz = cfg.haze * (1 - d);
    backR[k] = col[0] * vig + haze[0] * hz;
    backG[k] = col[1] * vig + haze[1] * hz;
    backB[k] = col[2] * vig + haze[2] * hz;
    isPrism[k] = inside ? 1 : 0;
  }

  return { n, s, cx, cy, backR, backG, backB, isPrism, jit };
}

export function traceDiamond(c: CanvasRenderingContext2D, x: number, y: number, hw: number, hh: number): void {
  c.beginPath();
  c.moveTo(x, y - hh);
  c.lineTo(x + hw, y);
  c.lineTo(x, y + hh);
  c.lineTo(x - hw, y);
  c.closePath();
}

/** Paint the resting field (dark veil + faint seams) into the offscreen layer
 *  that gets blitted under the animated tiles every frame. */
export function buildRestLayer(
  rest: HTMLCanvasElement,
  field: TileField,
  cfg: CrystalFieldConfig,
  dpr: number,
  w: number,
  h: number,
): void {
  rest.width = Math.round(w * dpr);
  rest.height = Math.round(h * dpr);
  const ctx = rest.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cfg.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = cfg.tileFront;
  ctx.strokeStyle = cfg.seam;
  ctx.lineWidth = 1;
  for (let k = 0; k < field.n; k++) {
    traceDiamond(ctx, field.cx[k], field.cy[k], field.s, field.s);
    ctx.fill();
    ctx.stroke();
  }
}
