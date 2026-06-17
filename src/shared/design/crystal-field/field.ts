import type { CrystalFieldConfig } from "./config";
import { lerpRgb, makePalette, prismGradient, smoothstep, type Rgb } from "./color";

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
  lit: number;
};

function precomputeBlades(cfg: CrystalFieldConfig, w: number, h: number, diag: number): Blade[] {
  return cfg.shards.map((sh) => {
    const rad = (sh.angle * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const sx = sh.ax * w;
    const sy = sh.ay * h;
    const hl = (sh.len * diag) / 2;
    return { ux, uy, vx: -uy, vy: ux, cx: sx + ux * hl, cy: sy + uy * hl, hl, hw: sh.wid / 2, lit: sh.lit };
  });
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

  for (let k = 0; k < n; k++) {
    jit[k] = (Math.random() * 2 - 1) * cfg.rippleJitter;
    let col: Rgb = palette.empty;
    let inside = false;
    // front-most matching blade wins, with a soft blend where they overlap
    for (const b of blades) {
      const dx = cx[k] - b.cx;
      const dy = cy[k] - b.cy;
      const along = (dx * b.ux + dy * b.uy) / b.hl;
      const across = (dx * b.vx + dy * b.vy) / b.hw;
      if (Math.abs(along) + Math.abs(across) > 1) continue;

      const t = (across + 1) / 2; // 0..1 across the blade width
      let c = prismGradient(palette, t);
      // brighten toward the "lit" long edge
      const edge = b.lit > 0 ? across : -across; // +1 = lit edge
      c = lerpRgb(c, palette.spec, smoothstep(0.45, 1, edge) * 0.9);
      // gentle dim toward the sharp tips
      const taper = 1 - smoothstep(0.65, 1, Math.abs(along)) * 0.45;
      c = [c[0] * taper + 6, c[1] * taper + 6, c[2] * taper + 8];
      col = inside ? lerpRgb(col, c, 0.65) : c;
      inside = true;
    }
    backR[k] = col[0];
    backG[k] = col[1];
    backB[k] = col[2];
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
