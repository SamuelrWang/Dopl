"use client";

/**
 * LiquidGlass — refractive glass that bends and color-splits the content behind
 * it, with no painted-on highlight.
 *
 * The look is driven entirely by a generated rounded-rect "bevel" map: flat in
 * the center (clear, undistorted) and sloped at the rounded rim, with each rim
 * pixel's red/green encoding the outward surface normal. Fed to an SVG
 * `feDisplacementMap` over the backdrop, that bends the background outward,
 * hardest right at the edge — true lens magnification. Running the displacement
 * per RGB channel at slightly different strengths splits light into a faint
 * chromatic fringe at the rim — so the "glint" is the refracted content itself,
 * not an opaque white layer. Only a soft outer drop shadow lifts it off the
 * surface. Degrades to a plain translucent panel where `backdrop-filter: url()`
 * isn't supported (Safari).
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

type LiquidGlassProps = {
  children?: ReactNode;
  className?: string;
  /** Corner radius (px). */
  radius?: number;
  /** Refraction strength (px of pixel-bend at the rim). */
  scale?: number;
  /** Chromatic spread: per-channel displacement offset (0 = none). */
  dispersion?: number;
  /** Translucent fill laid over the refracted backdrop. */
  tint?: string;
  style?: CSSProperties;
};

/** Paint a rounded-rect bevel/normal map into `canvas` and return a data URI.
 *  R/G encode the outward normal (128 = none); flat center, sloped rim. */
function buildBevelMap(canvas: HTMLCanvasElement, w: number, h: number, radius: number, bevel: number): string {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.min(radius, halfW, halfH);
  const amp = 127;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      const sx = px < 0 ? -1 : 1;
      const sy = py < 0 ? -1 : 1;
      const qx = Math.abs(px) - (halfW - r);
      const qy = Math.abs(py) - (halfH - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      const outside = Math.hypot(ax, ay);
      const sdf = outside + Math.min(Math.max(qx, qy), 0) - r; // <0 inside
      const dist = -sdf; // distance to the boundary (>0 inside)

      // outward normal direction
      let nx: number;
      let ny: number;
      if (ax > 0 || ay > 0) {
        const l = outside || 1;
        nx = (sx * ax) / l;
        ny = (sy * ay) / l;
      } else if (qx > qy) {
        nx = sx;
        ny = 0;
      } else {
        nx = 0;
        ny = sy;
      }

      // ramp: flat until within `bevel` of the edge, then ease in hard
      let t = dist <= 0 ? 1 : dist < bevel ? (bevel - dist) / bevel : 0;
      t = t * t;

      const i = (y * w + x) * 4;
      d[i] = Math.max(0, Math.min(255, 128 + nx * t * amp));
      d[i + 1] = Math.max(0, Math.min(255, 128 + ny * t * amp));
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

const KEEP_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const KEEP_G = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const KEEP_B = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

export function LiquidGlass({
  children,
  className,
  radius = 26,
  scale = 56,
  dispersion = 0.08,
  tint = "rgba(255,255,255,0.03)",
  style,
}: LiquidGlassProps) {
  const rawId = useId();
  const filterId = `lg-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);
  const [mapUri, setMapUri] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(Math.min(rect.width, 900)));
      const h = Math.max(1, Math.round(Math.min(rect.height, 900)));
      if (w < 2 || h < 2) return;
      const bevel = Math.min(Math.min(w, h) * 0.5, 70);
      setMapUri(buildBevelMap(canvas, w, h, radius, bevel));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius]);

  const sR = scale * (1 + dispersion);
  const sG = scale;
  const sB = scale * (1 - dispersion);
  const backdrop = `saturate(1.15) contrast(1.04) url(#${filterId})`;

  return (
    <div
      ref={ref}
      className={cn("relative isolate overflow-hidden", className)}
      style={{ borderRadius: radius, ...style }}
    >
      {/* Filter: bevel map → per-channel displacement → recombine (chromatic). */}
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          {mapUri && (
            <feImage href={mapUri} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="map" />
          )}
          <feDisplacementMap in="SourceGraphic" in2="map" scale={sR} xChannelSelector="R" yChannelSelector="G" result="dR" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={sG} xChannelSelector="R" yChannelSelector="G" result="dG" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={sB} xChannelSelector="R" yChannelSelector="G" result="dB" />
          <feColorMatrix in="dR" type="matrix" values={KEEP_R} result="rC" />
          <feColorMatrix in="dG" type="matrix" values={KEEP_G} result="gC" />
          <feColorMatrix in="dB" type="matrix" values={KEEP_B} result="bC" />
          <feComposite in="rC" in2="gC" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
          <feComposite in="rg" in2="bC" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
        </filter>
      </svg>

      {/* Refracted backdrop + faint tint + soft lift. No painted highlight. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          background: tint,
          backdropFilter: backdrop,
          WebkitBackdropFilter: "saturate(1.15) contrast(1.04)",
          boxShadow: "0 22px 60px rgba(0,0,0,0.5)",
        }}
      />

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
