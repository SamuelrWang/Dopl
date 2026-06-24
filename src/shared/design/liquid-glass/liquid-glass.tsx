"use client";

/**
 * LiquidGlass — a refractive glass card. Its look comes from a displacement map
 * shaped like the rounded-rect (see build-displacement-map.ts): the map drives an
 * SVG feDisplacementMap applied as `backdrop-filter`, so it refracts whatever is
 * behind it. A colour tint is composited inside the filter (white = no-op); a
 * specular glint is a static CSS bevel on all four edges.
 *
 * Defaults are the approved "frosted" look — drop it over any dark backdrop with
 * just a `className`; override the knobs for a different glass.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { buildDisplacementMap } from "./build-displacement-map";

export type LiquidGlassProps = {
  children?: ReactNode;
  className?: string;
  /** Corner radius (px). */
  radius?: number;
  /** Displacement scale — px of pixel-bend at the rim. */
  depth?: number;
  /** Rim half-width of the refraction ring. */
  splay?: number;
  /** Extra inner falloff added to the ring on the inside of the edge. */
  feather?: number;
  /** Bevel profile exponent — <1 sharpens the edge, >1 rounds it. */
  curve?: number;
  /** Chromatic aberration: per-channel displacement offset (0 = off). */
  chroma?: number;
  /** Specular glint intensity, 0–150 (scales the edge highlight opacity). */
  glint?: number;
  /** Glass tint level 0–1. */
  tint?: number;
  /** Glass tint colour. */
  tintColor?: string;
  /** Standalone blur over the refraction (px). */
  blur?: number;
  style?: CSSProperties;
};

const KEEP_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const KEEP_GB = "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";

const MAX_MAP_PX = 900; // cap the offscreen map so huge cards don't blow out memory

export function LiquidGlass({
  children,
  className,
  radius = 26,
  depth = 64,
  splay = 2,
  feather = 40,
  curve = 2,
  chroma = 0,
  glint = 100,
  tint = 0,
  tintColor = "#ffffff",
  blur = 5,
  style,
}: LiquidGlassProps) {
  const rawId = useId();
  const filterId = `lg-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(Math.min(rect.width, MAX_MAP_PX)));
      const h = Math.max(1, Math.round(Math.min(rect.height, MAX_MAP_PX)));
      if (w < 2 || h < 2) return;
      setMap(buildDisplacementMap(canvas, w, h, { radius, rim: splay, curve, feather }));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, splay, curve, feather]);

  // Chromatic split: red takes the larger displacement, green+blue ride the smaller.
  const sR = depth * (1 + chroma);
  const sGB = depth * (1 - chroma);

  return (
    <div
      ref={ref}
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        borderRadius: radius,
        boxShadow:
          "0 2px 5px rgba(0,0,0,0.35), 0 12px 28px rgba(0,0,0,0.45), 0 36px 72px rgba(0,0,0,0.55)",
        ...style,
      }}
    >
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          {map && (
            <feImage href={map} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="map" />
          )}
          {chroma > 0 ? (
            <>
              <feDisplacementMap in="SourceGraphic" in2="map" scale={sR} xChannelSelector="R" yChannelSelector="G" result="dR" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={sGB} xChannelSelector="R" yChannelSelector="G" result="dGB" />
              <feColorMatrix in="dR" type="matrix" values={KEEP_R} result="cR" />
              <feColorMatrix in="dGB" type="matrix" values={KEEP_GB} result="cGB" />
              <feComposite in="cR" in2="cGB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="disp" />
            </>
          ) : (
            <feDisplacementMap in="SourceGraphic" in2="map" scale={depth} xChannelSelector="R" yChannelSelector="G" result="disp" />
          )}

          {/* colour tint — multiplied over the refracted backdrop (white = no-op) */}
          {tint > 0 && (
            <>
              <feFlood floodColor={tintColor} floodOpacity={tint} result="tintFlood" />
              <feComposite in="tintFlood" in2="disp" operator="in" result="tintClip" />
              <feBlend in="disp" in2="tintClip" mode="multiply" />
            </>
          )}
        </filter>
      </svg>

      {/* refraction: backdrop-filter samples whatever is behind the card */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          backdropFilter: `${blur > 0 ? `blur(${blur}px) ` : ""}url(#${filterId})`,
          WebkitBackdropFilter: blur > 0 ? `blur(${blur}px)` : undefined,
        }}
      />

      {/* specular glint — white bevel on all four edges, light from top-left + bottom-right */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          opacity: Math.min(1, glint / 100),
          boxShadow:
            "inset 1.5px 1.5px 4px rgba(255,255,255,0.42), inset -1.5px -1.5px 4px rgba(255,255,255,0.42)",
        }}
      />

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
