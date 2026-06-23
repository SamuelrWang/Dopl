"use client";

/**
 * LiquidGlass — a refractive glass "bubble" whose look is derived from its own
 * geometry, not a painted-on highlight.
 *
 * Two generated maps drive everything, both shaped like the rounded-rect card:
 *   • a NORMAL map (flat center, sloped rim) → fed to `feDisplacementMap` to
 *     bend the backdrop outward, hardest at the edge (lens refraction). Run per
 *     RGB channel at slightly different strengths → a chromatic fringe pulled
 *     from the content.
 *   • a HEIGHT map (a smooth dome, high in the center) → fed to
 *     `feDiffuseLighting` + `feSpecularLighting`, which compute the surface
 *     normal and light it. That gives soft volume shading + a specular glint
 *     that track the bubble's curvature — so it reads as a raised, lit bubble
 *     even when the backdrop behind it is dark. No opaque overlay.
 *
 * Degrades to a translucent panel where `backdrop-filter: url()` is unsupported.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

type LiquidGlassProps = {
  children?: ReactNode;
  className?: string;
  radius?: number;
  /** Refraction strength (px of pixel-bend at the rim). */
  scale?: number;
  /** Chromatic spread: per-channel displacement offset. */
  dispersion?: number;
  /** Translucent fill laid over the refracted backdrop. */
  tint?: string;
  style?: CSSProperties;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Maps = { normal: string; height: string };

/** Paint the normal map (R/G = outward rim normal) and the height map (alpha =
 *  smooth dome, high in the center) for a rounded rect; return both as URIs. */
function buildMaps(
  nCanvas: HTMLCanvasElement,
  hCanvas: HTMLCanvasElement,
  w: number,
  h: number,
  radius: number,
  bevel: number,
): Maps {
  nCanvas.width = w;
  nCanvas.height = h;
  hCanvas.width = w;
  hCanvas.height = h;
  const nctx = nCanvas.getContext("2d");
  const hctx = hCanvas.getContext("2d");
  if (!nctx || !hctx) return { normal: "", height: "" };
  const nImg = nctx.createImageData(w, h);
  const hImg = hctx.createImageData(w, h);
  const nd = nImg.data;
  const hd = hImg.data;
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.min(radius, halfW, halfH);
  const domeFalloff = Math.min(halfW, halfH);

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
      const sdf = outside + Math.min(Math.max(qx, qy), 0) - r;
      const dist = -sdf;

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

      let t = dist <= 0 ? 1 : dist < bevel ? (bevel - dist) / bevel : 0;
      t = t * t;

      const i = (y * w + x) * 4;
      nd[i] = Math.max(0, Math.min(255, 128 + nx * t * 127));
      nd[i + 1] = Math.max(0, Math.min(255, 128 + ny * t * 127));
      nd[i + 2] = 128;
      nd[i + 3] = 255;

      // dome height: 0 at the edge → 1 in the center, smooth.
      const dome = dist <= 0 ? 0 : smoothstep(0, domeFalloff, dist);
      hd[i] = 255;
      hd[i + 1] = 255;
      hd[i + 2] = 255;
      hd[i + 3] = Math.round(dome * 255);
    }
  }
  nctx.putImageData(nImg, 0, 0);
  hctx.putImageData(hImg, 0, 0);
  return { normal: nCanvas.toDataURL(), height: hCanvas.toDataURL() };
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
  tint = "rgba(255,255,255,0.04)",
  style,
}: LiquidGlassProps) {
  const rawId = useId();
  const filterId = `lg-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);
  const [maps, setMaps] = useState<Maps | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nCanvas = document.createElement("canvas");
    const hCanvas = document.createElement("canvas");
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(Math.min(rect.width, 900)));
      const h = Math.max(1, Math.round(Math.min(rect.height, 900)));
      if (w < 2 || h < 2) return;
      const bevel = Math.min(Math.min(w, h) * 0.5, 70);
      setMaps(buildMaps(nCanvas, hCanvas, w, h, radius, bevel));
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
      style={{
        borderRadius: radius,
        // Lift the whole bubble off the panel — layered (contact → near →
        // far) so it floats above rather than sitting on the same plane.
        // Lives on the parent: its own box-shadow escapes `overflow-hidden`,
        // unlike a shadow on the clipped inner overlay.
        boxShadow:
          "0 2px 5px rgba(0,0,0,0.35), 0 12px 28px rgba(0,0,0,0.45), 0 36px 72px rgba(0,0,0,0.55)",
        ...style,
      }}
    >
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          {maps && (
            <feImage href={maps.normal} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="nmap" />
          )}
          {maps && (
            <feImage href={maps.height} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="hmap" />
          )}

          {/* Chromatic refraction of the backdrop. */}
          <feDisplacementMap in="SourceGraphic" in2="nmap" scale={sR} xChannelSelector="R" yChannelSelector="G" result="dR" />
          <feDisplacementMap in="SourceGraphic" in2="nmap" scale={sG} xChannelSelector="R" yChannelSelector="G" result="dG" />
          <feDisplacementMap in="SourceGraphic" in2="nmap" scale={sB} xChannelSelector="R" yChannelSelector="G" result="dB" />
          <feColorMatrix in="dR" type="matrix" values={KEEP_R} result="rC" />
          <feColorMatrix in="dG" type="matrix" values={KEEP_G} result="gC" />
          <feColorMatrix in="dB" type="matrix" values={KEEP_B} result="bC" />
          <feComposite in="rC" in2="gC" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg" />
          <feComposite in="rg" in2="bC" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="refr" />

          {/* Geometry-derived lighting from the dome height map. */}
          <feDiffuseLighting in="hmap" surfaceScale="18" diffuseConstant="1" lightingColor="#aebed8" result="diff">
            <feDistantLight azimuth="235" elevation="58" />
          </feDiffuseLighting>
          <feSpecularLighting in="hmap" surfaceScale="18" specularConstant="1.05" specularExponent="22" lightingColor="#ffffff" result="spec">
            <feDistantLight azimuth="235" elevation="62" />
          </feSpecularLighting>
          <feComposite in="diff" in2="hmap" operator="in" result="diffClip" />
          <feComposite in="spec" in2="hmap" operator="in" result="specClip" />

          {/* Refraction → + soft volume (screen) → + glint (screen). */}
          <feBlend in="refr" in2="diffClip" mode="screen" result="lit1" />
          <feBlend in="lit1" in2="specClip" mode="screen" />
        </filter>
      </svg>

      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          background: tint,
          backdropFilter: backdrop,
          WebkitBackdropFilter: "saturate(1.15) contrast(1.04)",
          // Convex bubble read: bright catch along the top edge + soft upper
          // inner glow (dome crown), darker underside, hairline rim to crisp
          // the glass edge. Inset only — sits on the glass, keeps refraction.
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.5), " +
            "inset 0 8px 20px rgba(255,255,255,0.10), " +
            "inset 0 -16px 28px rgba(0,0,0,0.32), " +
            "inset 0 0 0 1px rgba(255,255,255,0.14)",
        }}
      />

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
