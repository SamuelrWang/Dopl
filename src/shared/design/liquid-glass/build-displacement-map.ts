/**
 * Pure canvas builder for the LiquidGlass displacement map. Rounded-rect
 * "lens": R = x-displacement, G = y-displacement, from an SDF to the
 * rounded-rect edge. Ring centred ON the edge (wider/softer inside via
 * `feather`), smootherstepped, shaped by `curve`. No DOM beyond the canvas.
 */

/** Saturation of the displacement map. */
const BOOST = 0.8;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export type DisplacementMapParams = {
  /** Corner radius (px). */
  radius: number;
  /** Rim half-width of the refraction ring (= `splay`). */
  rim: number;
  /** Bevel profile exponent — <1 sharpens the edge, >1 rounds it. */
  curve: number;
  /** Extra inner falloff on the ring, inside the edge. */
  feather: number;
};

/** Paint map into `canvas` at `w`×`h`; returns a data URI. */
export function buildDisplacementMap(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  { radius, rim, curve, feather }: DisplacementMapParams,
): string {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const px = img.data;

  const hx = w / 2;
  const hy = h / 2;
  const r = Math.min(radius, hx, hy);

  const sdf = (x: number, y: number) => {
    const qx = Math.abs(x - hx) - (hx - r);
    const qy = Math.abs(y - hy) - (hy - r);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const s = sdf(cx, cy);
      const gx = sdf(cx + 1, cy) - sdf(cx - 1, cy); // outward edge normal
      const gy = sdf(cx, cy + 1) - sdf(cx, cy - 1);
      const len = Math.hypot(gx, gy) || 1;
      const nx = gx / len;
      const ny = gy / len;
      const span = s < 0 ? rim + feather : rim; // inner side gets a wider, softer falloff
      let amt = Math.max(0, 1 - Math.abs(s) / span);
      amt = amt * amt * amt * (amt * (amt * 6 - 15) + 10); // smootherstep (no crease)
      amt = Math.pow(amt, curve);
      const i = (y * w + x) * 4;
      px[i] = clamp255(Math.round(127.5 - nx * amt * 127 * BOOST)); // R = x displacement (inward)
      px[i + 1] = clamp255(Math.round(127.5 - ny * amt * 127 * BOOST)); // G = y displacement
      px[i + 2] = 128; // B unused — glint is a CSS overlay
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
