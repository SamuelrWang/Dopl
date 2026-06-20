"use client";

/**
 * LiquidGlass — Apple-style refractive glass surface.
 *
 * Bends the pixels *behind* the element (its backdrop) with an SVG
 * `feDisplacementMap`, the same technique Aave's "Aave Glass" uses: a
 * displacement map whose red/green channels encode horizontal/vertical pixel
 * shift, neutral (128) in the center and ramping toward the rim — so the middle
 * stays clear while the edges refract like curved glass. A blur + saturate +
 * translucent tint + rim highlight make up the glass body; if a browser ignores
 * `backdrop-filter: url()` (e.g. Safari) those still read as frosted glass, so
 * the component degrades instead of breaking.
 *
 * Place it over visually interesting content (here, the crystal field) — there
 * has to be something behind it for the refraction to act on.
 */

import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

type LiquidGlassProps = {
  children?: ReactNode;
  className?: string;
  /** Corner radius (px). */
  radius?: number;
  /** Backdrop blur radius (px). */
  blur?: number;
  /** Displacement strength (px of pixel-bend at the rim). Higher = more liquid. */
  scale?: number;
  /** Translucent fill laid over the refracted backdrop. */
  tint?: string;
  style?: CSSProperties;
};

// Edge-concentrated displacement map: neutral (128,128) across the center so the
// middle reads clear, ramping to the extremes near each border so only the rim
// bends. Red drives x-shift, green drives y-shift. Rendered channel-independent
// by screen-blending a horizontal red ramp over a vertical green ramp.
// Lens profile: a wide flat NEUTRAL center (no displacement → clear, undistorted
// middle) and a hard ramp in the outer ~18% (strong bend right at the rim, like
// the thick edge of a glass bubble). Red drives x-shift, green y-shift; they're
// kept channel-independent by screen-blending a horizontal red ramp over a
// vertical green ramp.
const DISPLACEMENT_MAP = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" preserveAspectRatio="none">
  <defs>
    <linearGradient id="x" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FF0000"/>
      <stop offset="0.09" stop-color="#C00000"/>
      <stop offset="0.18" stop-color="#800000"/>
      <stop offset="0.82" stop-color="#800000"/>
      <stop offset="0.91" stop-color="#400000"/>
      <stop offset="1" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="y" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#00FF00"/>
      <stop offset="0.09" stop-color="#00C000"/>
      <stop offset="0.18" stop-color="#008000"/>
      <stop offset="0.82" stop-color="#008000"/>
      <stop offset="0.91" stop-color="#004000"/>
      <stop offset="1" stop-color="#000000"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#x)"/>
  <rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`;

const MAP_URI = `data:image/svg+xml,${encodeURIComponent(DISPLACEMENT_MAP)}`;

export function LiquidGlass({
  children,
  className,
  radius = 24,
  blur = 0,
  scale = 60,
  tint = "rgba(255,255,255,0.04)",
  style,
}: LiquidGlassProps) {
  const rawId = useId();
  const filterId = `lg-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // No blur by default — a clear lens. saturate/contrast give the refracted
  // backdrop a touch of glassy pop without clouding it.
  const blurPart = blur > 0 ? `blur(${blur}px) ` : "";
  const backdrop = `${blurPart}saturate(1.15) contrast(1.04) url(#${filterId})`;
  const backdropFallback = `${blurPart}saturate(1.15) contrast(1.04)`;

  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      style={{ borderRadius: radius, ...style }}
    >
      {/* Filter definition — sized to the element via objectBoundingBox units. */}
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          <feImage href={MAP_URI} preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      {/* Refractive glass body — backdrop bend + blur + tint. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          background: tint,
          backdropFilter: backdrop,
          WebkitBackdropFilter: backdropFallback,
        }}
      />

      {/* Volume — makes it read as a raised bubble, not a flat panel: a soft
          (blurred, never a hard line) top sheen, a deeper bottom inner shadow so
          the surface bows toward you, a faint UNIFORM edge on all sides (so there
          is no lone top border line), and an outer drop shadow that lifts it. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          boxShadow: [
            "inset 0 12px 26px rgba(255,255,255,0.12)",
            "inset 0 -22px 40px rgba(0,0,0,0.32)",
            "inset 0 0 0 1px rgba(255,255,255,0.06)",
            "0 22px 60px rgba(0,0,0,0.5)",
          ].join(", "),
        }}
      />

      {/* Specular gloss — a soft highlight catching the top-left, like light on a
          bubble. Radial + feathered, so it never looks like an edge. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          background:
            "radial-gradient(135% 95% at 28% 6%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 30%, transparent 56%)",
        }}
      />

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
