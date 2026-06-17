import type { CrystalFieldConfig } from "./config";

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Precomputed prism palette — derived once from the config hex strings. */
export type Palette = { stops: Rgb[]; spec: Rgb; empty: Rgb };

export function makePalette(cfg: CrystalFieldConfig): Palette {
  return {
    stops: cfg.prismStops.map(hexToRgb),
    spec: hexToRgb(cfg.specular),
    empty: hexToRgb(cfg.emptyBack),
  };
}

/** Sample the multi-stop prism ramp at t in [0,1]. Defensive: never throws on
 *  an empty ramp or a NaN / out-of-range t. */
export function prismRamp(p: Palette, t: number): Rgb {
  const s = p.stops;
  if (!s || s.length === 0) return [0, 0, 0];
  if (s.length === 1) return s[0];
  const tt = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const x = tt * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  return lerpRgb(s[i], s[i + 1], x - i);
}
