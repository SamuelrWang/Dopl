"use client";

/**
 * Refractive glass card. Rounded-rect displacement map (build-displacement-map.ts)
 * drives an SVG feDisplacementMap applied as `backdrop-filter` → refracts the
 * backdrop. Tint composited inside the filter; glint is a static CSS bevel.
 * Defaults = "frosted" over a dark backdrop.
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
  /** Extra inner falloff on the ring, inside the edge. */
  feather?: number;
  /** Bevel profile exponent — <1 sharpens the edge, >1 rounds it. */
  curve?: number;
  /** Chromatic aberration: per-channel displacement offset (0 = off). */
  chroma?: number;
  /** Specular glint intensity 0–150 (edge highlight opacity). */
  glint?: number;
  /** Glass tint level 0–1. */
  tint?: number;
  tintColor?: string;
  /** Standalone blur over the refraction (px). */
  blur?: number;
  /** ⚠ Build map ONCE on mount, never rebuild on resize. For scroll-scrubbed
   *  cards (box animates every frame): rebuild swaps the `<feImage>` data-URI
   *  and the async decode pops the refraction visibly. Frozen map stretches
   *  with the box (`preserveAspectRatio="none"`) — rim scales, no pop. */
  staticMap?: boolean;
  /**
   * A non-rectangular outline, as a CSS `mask` value — normally
   * `url(#someSvgMask)`. Masks the REFRACTION LAYER and the content layer, so
   * the blur itself takes the shape.
   *
   * 🔴 IT MUST BE A MASK, AND IT MUST BE ON THE LAYER, NOT THE ROOT. Both
   * halves of that were learned the hard way on 2026-10-10, and both failure
   * modes look like a finished feature until you examine the cutout:
   *
   *   - `clip-path` ON AN ANCESTOR makes that ancestor a BACKDROP ROOT. A
   *     `backdrop-filter` only samples inside its backdrop root, so the
   *     refraction has nothing behind it and the glass renders dead flat.
   *     Same trap rules out a `filter: drop-shadow(…)` wrapper for a
   *     shape-following shadow.
   *   - `clip-path` ON THE LAYER ITSELF does clip a plain `blur()`, but does
   *     NOT clip a backdrop-filter that includes an SVG `url(#…)` filter —
   *     which this component always uses. The outline and the rim looked
   *     correct while the glass quietly kept rendering across the whole
   *     rectangle, cutout included.
   *
   * `mask` clips both. Verified against this component's real
   * blur + displacement stack, not a plain blur.
   *
   * ⚠ Pair with `rimMaskUrl`: the glint is an inset box-shadow, which tracks
   * `border-radius` and knows nothing about a mask, so on a notched outline it
   * rims the straight edges and leaves the notch bare.
   */
  maskUrl?: string;
  /** The rim, as a CSS `mask` value — a soft band hugging the outline
   *  (`layout/auth-split/panel-shape.ts` builds the SVG). Only read when
   *  `maskUrl` is set. */
  rimMaskUrl?: string;
  /** Rim colour, when `ringPath` draws it. */
  ringColor?: string;
  /**
   * Is the outline currently non-rectangular? Cross-fades the rim treatment
   * and the drop shadow rather than swapping them, so a pose that happens to
   * be a plain rounded rect renders EXACTLY as it always did — soft inset
   * glint, full drop shadow — while a bitten one uses the shape-following
   * ring and drops the shadow (a rect shadow behind a bitten panel smudges
   * the bite). Both rims are mounted and animated, so the handover is
   * invisible mid-morph.
   */
  shaped?: boolean;
  /** CSS transition applied to the root, the refraction layer and the rim, so
   *  an outline change is one motion. */
  shapeTransition?: string;
  style?: CSSProperties;
};

const KEEP_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const KEEP_GB = "0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0";

const MAX_MAP_PX = 900; // cap offscreen map — huge cards would blow out memory

/**
 * THE EDGE WHITE, one value for both rim treatments.
 *
 * ⚠ The glint lays this down twice, but the two insets are OPPOSITE
 * DIRECTIONS (`1.5px 1.5px` and `-1.5px -1.5px`), so any single edge gets
 * about ONE pass — they do not stack. Reading it as "0.42 twice" and setting
 * the shaped rim to 0.72 is what made the bitten panel visibly whiter than
 * the landing page's glass, which passes no overrides and therefore wears
 * exactly this (`features/marketing/components/ontology-section.tsx`).
 */
const GLINT_WHITE = "rgba(255,255,255,0.42)";

/** The card's drop shadow. `shaped` zeroes the alphas instead of dropping the
 *  property, so `transition: box-shadow` has something to interpolate toward
 *  (none ↔ a shadow list does not animate). An unshaped card gets the exact
 *  values it always had. */
function shadowFor(shaped: boolean): string {
  const a = shaped ? 0 : 1;
  return (
    `0 2px 5px rgba(0,0,0,${0.35 * a}), ` +
    `0 12px 28px rgba(0,0,0,${0.45 * a}), ` +
    `0 36px 72px rgba(0,0,0,${0.55 * a})`
  );
}

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
  staticMap = false,
  maskUrl,
  rimMaskUrl,
  ringColor = GLINT_WHITE,
  shaped = false,
  shapeTransition,
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
    if (staticMap) return; // see `staticMap` prop doc
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, splay, curve, feather, staticMap]);

  // Chromatic split: red larger displacement, green+blue smaller.
  const sR = depth * (1 + chroma);
  const sGB = depth * (1 - chroma);

  return (
    <div
      ref={ref}
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        borderRadius: radius,
        // ⚠ NO mask or clip-path here — either would make this a backdrop
        // root and flatten the glass (see `maskUrl`). The layers below carry
        // the shape. Faded to transparent rather than removed when the
        // outline is bitten, so the shadow animates instead of popping.
        boxShadow: shadowFor(shaped),
        transition: shapeTransition,
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

          {/* tint — multiplied over refracted backdrop (white = no-op) */}
          {tint > 0 && (
            <>
              <feFlood floodColor={tintColor} floodOpacity={tint} result="tintFlood" />
              <feComposite in="tintFlood" in2="disp" operator="in" result="tintClip" />
              <feBlend in="disp" in2="tintClip" mode="multiply" />
            </>
          )}
        </filter>
      </svg>

      {/* refraction: backdrop-filter samples behind the card */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          backdropFilter: `${blur > 0 ? `blur(${blur}px) ` : ""}url(#${filterId})`,
          WebkitBackdropFilter: blur > 0 ? `blur(${blur}px)` : undefined,
          // The element's own MASK — the one thing that actually shapes a
          // backdrop-filter carrying an SVG filter. See `maskUrl`.
          mask: maskUrl,
          WebkitMask: maskUrl,
          transition: shapeTransition,
        }}
      />

      {/* specular glint — white bevel, all 4 edges, light top-left +
          bottom-right. Correct for a plain rounded rect, blind to a clip
          path, so it fades out as a bite appears. */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: radius,
          opacity: shaped ? 0 : Math.min(1, glint / 100),
          boxShadow: `inset 1.5px 1.5px 4px ${GLINT_WHITE}, inset -1.5px -1.5px 4px ${GLINT_WHITE}`,
          transition: shapeTransition,
        }}
      />

      {rimMaskUrl && (
        /* Shape-following rim. The mask is a BLURRED band hugging the
           outline, trimmed to the inside of the shape, so this reads as the
           same soft bevel the glint gives a plain rect — not a drawn line.
           A hard-edged ring here was the "harsh white border" regression. */
        <div
          className="absolute inset-0"
          style={{
            mask: rimMaskUrl,
            WebkitMask: rimMaskUrl,
            background: ringColor,
            opacity: shaped ? Math.min(1, glint / 100) : 0,
            transition: shapeTransition,
          }}
        />
      )}

      <div className="relative z-10 h-full" style={{ mask: maskUrl, WebkitMask: maskUrl }}>
        {children}
      </div>
    </div>
  );
}
