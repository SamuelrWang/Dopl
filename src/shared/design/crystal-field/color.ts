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
export type Palette = { pa: Rgb; pb: Rgb; pc: Rgb; spec: Rgb; empty: Rgb };

export function makePalette(cfg: CrystalFieldConfig): Palette {
  return {
    pa: hexToRgb(cfg.prismA),
    pb: hexToRgb(cfg.prismB),
    pc: hexToRgb(cfg.prismC),
    spec: hexToRgb(cfg.specular),
    empty: hexToRgb(cfg.emptyBack),
  };
}

/** Sample the cross-axis prism gradient (pink -> lilac -> periwinkle) at t in [0,1]. */
export function prismGradient(p: Palette, t: number): Rgb {
  return t < 0.5 ? lerpRgb(p.pa, p.pb, t * 2) : lerpRgb(p.pb, p.pc, (t - 0.5) * 2);
}
