"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { LiquidGlass } from "@/shared/design";
import { panelPath } from "./panel-shape";
import {
  CARD_EASE, CARD_IN_MS, CARD_OUT_MS,
  GLASS_EASE, GLASS_HEIGHT, GLASS_MIN_H, GLASS_MS, GLASS_NOTCH_RADIUS, GLASS_RADIUS,
  GLASS_RIM_BAND, GLASS_RIM_BITE, GLASS_RIM_BLUR, GLASS_SHADOW_LAYERS, GLASS_SHADOW_PAD,
  GLASS_SIDE_INSET, GLASS_TOP,
  cardPath, easeInOutCubic, glassShape, poseDepths,
  type AuthGlassPose,
} from "./auth-glass-geometry";

/**
 * The auth split's right pane. Split out of `./auth-split-layout.tsx`
 * (2026-10-11) to stay under the 500-line cap (INVARIANTS §1): that file owns
 * `AuthSplitLayout` and the left column, this one owns the banner, the glass,
 * the morph and the card. Imports run one way, panel ← layout.
 *
 * ⚠ `AUTH_GLASS_SLOT_ID` lives HERE, at the bottom, because this is the file
 * that renders the slot. Leaving it behind on the layout would have made the
 * two import each other at runtime.
 */

/**
 * Right pane: same banner image as
 * `features/marketing/components/ontology-section.tsx` › OntologySection,
 * under the same `LiquidGlass` primitive at the landing card's `radius={20}`.
 *
 * ⚠ Nothing copied from `marketing.css` — the glass is a React component and
 * `.lp-ont-glass*` are only that section's centring + 544px cap. Slab sized by
 * percentage insets with NO transform (a transform on a `backdrop-filter`
 * element is a rendering coin flip), plus a px floor for short viewports.
 *
 * Hexes are fine here: auth + onboarding are the design system's standing
 * exemption (docs/DESIGN-SYSTEM.md).
 */
export function AuthBannerPanel({
  src,
  pose,
  card,
}: {
  src: string;
  pose: AuthGlassPose;
  /** Onboarding only — see the call site. `false` on every plain auth surface. */
  card: boolean;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const still = usePrefersReducedMotion();

  /**
   * The pose THE GLASS is in, which lags the requested one by the card's
   * fade-out. That lag is the whole sequence: the card is already gone before
   * the glass is allowed to move, so nothing rides along with it.
   */
  const [movePose, setMovePose] = useState<AuthGlassPose>(pose);
  const [cardShown, setCardShown] = useState(true);
  useEffect(() => {
    if (movePose === pose) return;
    if (still) {
      setMovePose(pose);
      return;
    }
    setCardShown(false);
    const toMove = setTimeout(() => setMovePose(pose), CARD_OUT_MS);
    const toShow = setTimeout(() => setCardShown(true), CARD_OUT_MS + GLASS_MS);
    return () => {
      clearTimeout(toMove);
      clearTimeout(toShow);
    };
    // `movePose` is read, not tracked: re-running on it would restart the
    // hand-off halfway and the card would flash mid-slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, still]);

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    glass: `agm-${uid}`,
    rim: `arm-${uid}`,
    shadow: `asm-${uid}`,
    rimBlur: `arb-${uid}`,
    shadowBlur: `asb-${uid}`,
    card: `acm-${uid}`,
  };

  // Every mask path is written IMPERATIVELY, never from JSX: the morph runs
  // frame by frame and React re-rendering `d` would fight it. These all carry
  // the SAME notched outline, so one string per frame feeds the lot.
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const keep = (i: number) => (el: SVGPathElement | null) => {
    paths.current[i] = el;
  };
  // ⚠ THE SHADOW'S KNOCKOUT IS THE ONE PATH THAT IS **NOT** THE OUTLINE — it is
  // the un-bitten rounded rect, so it gets its own ref and its own `d`.
  // Knocking out the OUTLINE instead leaves the bite counting as "outside the
  // shape", and the panel then casts its own drop shadow down into its own
  // cutout: a grey wash over the sharp photo in the bite, plus a dark band
  // just inside the glass above it, because the refraction samples whatever
  // sits behind it and the shadow was sitting there (Samuel #3069).
  const knockout = useRef<SVGPathElement | null>(null);
  /** Knocks everything OUTSIDE the outline off the rim band — the mask region
   *  as a rect, then the outline, `evenodd`. */
  const rimClip = useRef<SVGPathElement | null>(null);
  const depths = useRef({ top: 0, bot: 0 });

  // The outline is absolute px inside the glass box, so it has to be measured.
  // Measuring the PANE (not the glass) keeps LiquidGlass's own ref free and
  // survives the glass being clipped to nothing mid-morph.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = r.width * (1 - GLASS_SIDE_INSET * 2);
      const h = Math.max(GLASS_MIN_H, r.height * GLASS_HEIGHT);
      if (w < 2 || h < 2) return;
      setBox((prev) =>
        prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // THE MORPH. A mask cannot be CSS-transitioned the way a clip path can, so
  // the outline is interpolated here and written to the mask paths each
  // frame. Only the depths move; the splits are pose-invariant, so top-right
  // → bottom-left is two depths crossing and the point count never changes.
  // The slide (`top`) stays on a CSS transition with the matching curve.
  useLayoutEffect(() => {
    if (!box) return;
    const to = poseDepths(movePose, box.h);
    const from = { ...depths.current };
    // ⚠ WHEN BOTH BITES MOVE, THEY TAKE TURNS — the one closing owns the first
    // half, the one opening the second. Running them together is what made the
    // slide read as a double outline: at mid-flight BOTH were half open, so the
    // panel wore a top-right notch AND a bottom-left notch at once and the rim
    // traced both (Samuel #3098B, caught on frame captures at 430ms and 650ms).
    // The three mask layers were already in lockstep — 0 of 134 frames
    // disagreed — so this was never a clock split; the shape itself was wrong.
    const bothMove = from.top !== to.top && from.bot !== to.bot;
    const phase = (t: number, a: number, b: number) => {
      if (!bothMove) return easeInOutCubic(t);
      const p = b < a ? t / 0.5 : (t - 0.5) / 0.5; // close first, then open
      return easeInOutCubic(Math.min(1, Math.max(0, p)));
    };
    const paint = (t: number) => {
      depths.current = {
        top: from.top + (to.top - from.top) * phase(t, from.top, to.top),
        bot: from.bot + (to.bot - from.bot) * phase(t, from.bot, to.bot),
      };
      const d = panelPath(
        box.w,
        box.h,
        glassShape(box.w, depths.current.top, depths.current.bot),
        { radius: GLASS_RADIUS, notchRadius: GLASS_NOTCH_RADIUS }
      );
      // The panel's un-bitten footprint: the rim strokes it, and the shadow
      // knocks it out.
      const dRect = panelPath(box.w, box.h, glassShape(box.w, 0, 0), {
        radius: GLASS_RADIUS,
        notchRadius: GLASS_NOTCH_RADIUS,
      });
      // ⚠ THE RIM STROKES THE FULL OUTLINE, CUTOUT EDGES INCLUDED. It briefly
      // stroked the un-bitten rect instead, to take the glow off the cutout
      // (#3112) — Samuel reversed that the same evening and asked for the glow
      // back, so the band follows every edge again. What stays from that round
      // is the thinner profile (band 4 / blur 2.6, closer to the glint it
      // imitates) and the knockout's inward bite, which together are why the
      // glow no longer reads as a hard white stroke on a bright backdrop.
      for (const p of paths.current) p?.setAttribute("d", d);
      // Un-bitten footprint: shadow lives strictly OUTSIDE the panel's own
      // rectangle, never inside the cutout.
      knockout.current?.setAttribute("d", dRect);
      // The mask region as a rect, then the outline: `evenodd` leaves exactly
      // the OUTSIDE, which is what the rim band must lose.
      //
      // ⚠ THE OUTLINE HERE IS INSET BY A HAIR, ON PURPOSE. Knocking out with
      // the exact outline leaves the knockout's own ANTIALIASED edge sitting
      // on top of the brightest part of the blurred band, and the partial
      // coverage survives as a one-pixel white fringe on the OUTSIDE of the
      // bite — the rim line Samuel could still see on page 2 (#3112) after the
      // nested-mask fix. A column probe across the bite ceiling missed it; a
      // full-region pixel diff found 245 pixels, peaking at the concave
      // corner where the blur piles up. Pulling the knockout `GLASS_RIM_BITE`
      // INTO the solid puts that fringe inside the glass, where the band
      // already is, and costs the band about a pixel of its ~3.5px width.
      rimClip.current?.setAttribute(
        "d",
        `M0,0 H${box.w} V${box.h} H0 Z ${panelPath(
          box.w,
          box.h,
          glassShape(box.w, depths.current.top, depths.current.bot),
          { radius: GLASS_RADIUS, notchRadius: GLASS_NOTCH_RADIUS, inset: GLASS_RIM_BITE }
        )}`
      );
    };
    if (still) {
      paint(1);
      return;
    }
    paint(0);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / GLASS_MS);
      paint(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [movePose, box, still]);

  // Pose-driven, not outline-driven: the cross-fade has to START when the
  // morph does. A pose with no bite keeps the original glint and box-shadow,
  // so it stays indistinguishable from the panel before any of this.
  const shaped = movePose !== "default";
  const masked = box !== null;
  // Mask regions, in the masked element's own px.
  const mw = box?.w ?? 0;
  const mh = box?.h ?? 0;
  const transition = still
    ? undefined
    : `top ${GLASS_MS}ms ${GLASS_EASE}, opacity ${GLASS_MS}ms ${GLASS_EASE}, ` +
      `box-shadow ${GLASS_MS}ms ${GLASS_EASE}`;

  return (
    <div
      ref={paneRef}
      className="relative h-full w-full overflow-hidden rounded-[32px] bg-[#060A0F]"
      style={{
        boxShadow:
          "0 6px 16px rgba(8,10,15,0.28), " +
          "0 28px 64px rgba(8,10,15,0.34), " +
          "0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      {/* Decorative (empty alt) — form column carries the meaning. ⚠ Plain
          <img>, never next/image: Vite compiles this file too and has no Next
          runtime to serve an optimized image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover object-center"
      />

      {/* ⚠ Geometry is INLINE STYLE, not utility classes, and must stay that
          way: Tailwind's scan does not reliably emit this file's arbitrary
          values for every route chain (measured 2026-08-17 — `top-[32%]` /
          `min-h-[220px]` absent from every built stylesheet), and when the
          classes are missing the glass drops into static flow below the
          full-height image and the panel's overflow clips it to nothing. */}
      <div
        style={{
          position: "absolute",
          left: `${GLASS_SIDE_INSET * 100}%`,
          right: `${GLASS_SIDE_INSET * 100}%`,
          top: `${GLASS_TOP[movePose] * 100}%`,
          height: `${GLASS_HEIGHT * 100}%`,
          minHeight: GLASS_MIN_H,
          transition,
        }}
      >
        {/* Shape-following drop shadow, BEHIND the glass and OUTSIDE it: the
            glass root clips its own overflow, and a box-shadow there can only
            ever be a rectangle. Its mask paints the blurred outline and then
            knocks the outline back out, so the shadow exists only beyond the
            edge and never darkens the glass it sits under. Fades out with
            `shaped` so a plain pose keeps the original box-shadow instead. */}
        {masked && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: -GLASS_SHADOW_PAD,
              background: "rgba(8,10,15,0.5)",
              mask: `url(#${ids.shadow})`,
              WebkitMask: `url(#${ids.shadow})`,
              opacity: shaped ? 1 : 0,
              transition,
            }}
          />
        )}

        <LiquidGlass
          radius={GLASS_RADIUS}
          maskUrl={masked ? `url(#${ids.glass})` : undefined}
          rimMaskUrl={masked ? `url(#${ids.rim})` : undefined}
          shaped={shaped}
          shapeTransition={transition}
          style={{ position: "absolute", inset: 0 }}
        >
          {/* Portal target — a PAGE may project content onto the glass (the
              get-started install animation does) while the layout, and therefore
              the banner + glass, persists across auth-group navigations. Empty on
              every other surface, including the desktop SPA. */}
          <div id={AUTH_GLASS_SLOT_ID} style={{ width: "100%", height: "100%" }} />

          {/* THE WHITE CARD. Empty for now; content comes later. It is sized
              from the SOLID part of the pose, so it can never sit over the
              bite, and it never animates its own position — it is simply
              absent while the glass moves. Wears the landing page's panel
              recipe through `--glass-card-*`, not a copy of its values.
              ⚠ `card &&` IS LOAD-BEARING, AND `masked` ALONE WAS A BUG. This
              read `{masked && (`, and `masked` only means "the pane has been
              measured" — true on every surface — so an opaque #ffffff card
              painted on /login, /signup, /authenticate, /oauth/authorize and
              the desktop signed-out screen, contradicting this file's own
              contract that a surface naming no pose is untouched. Worst on
              /get-started, whose install animation is portaled into the slot
              ABOVE: the card is a later absolutely-positioned sibling in the
              same stacking context, so it covered all but a 34px frame of it.
              ⚠ Do NOT gate this on `shaped` instead: onboarding's step 3 is
              pose `"default"` BY DESIGN and must keep its card, so `shaped`
              (pose !== default) would strip it from the one step that looks
              like a plain surface and is not. */}
          {masked && card && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                // Masked to an inset copy of THIS pose's outline, bite and
                // all. No morph needed: the card is invisible for the whole
                // flight, so it only ever shows a settled pose.
                mask: `url(#${ids.card})`,
                WebkitMask: `url(#${ids.card})`,
                background: "var(--glass-card-fill)",
                // ⚠ `drop-shadow`, NOT `box-shadow`: a box-shadow is drawn on
                // the border box and the mask then cuts it away, so a masked
                // card would lose its shadow entirely. `drop-shadow` is
                // computed from the masked alpha, so it follows the bite.
                // The token's value is already in drop-shadow's grammar.
                filter: "drop-shadow(var(--glass-card-shadow))",
                opacity: cardShown ? 1 : 0,
                transition: still
                  ? undefined
                  : `opacity ${cardShown ? CARD_IN_MS : CARD_OUT_MS}ms ${CARD_EASE}`,
              }}
            />
          )}
        </LiquidGlass>
      </div>

      {/* The masks. `userSpaceOnUse` means these coordinates are px in the
          masked element's own box, which is why the glass and rim masks share
          one outline while the shadow's is shifted by its padding. */}
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id={ids.rimBlur} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={GLASS_RIM_BLUR} />
          </filter>
          {GLASS_SHADOW_LAYERS.map((l, i) => (
            <filter
              key={i}
              id={`${ids.shadowBlur}-${i}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation={l.std} />
            </filter>
          ))}

          {/* ⚠ THE REGION IS EXPLICIT ON EVERY MASK. With
              `maskUnits="userSpaceOnUse"` the default region is still
              -10%/120%, and a percentage resolves against THIS `<svg>`, which
              is 0×0 — so the region collapses and the mask hides the element
              outright. That is a blank panel, not a subtle bug. */}
          <mask id={ids.glass} maskUnits="userSpaceOnUse" x="0" y="0" width={mw} height={mh}>
            <path ref={keep(0)} fill="#fff" />
          </mask>

          {/* The card's outline. Driven by React, not the morph loop: it is
              one settled pose at a time, never an in-between. */}
          <mask id={ids.card} maskUnits="userSpaceOnUse" x="0" y="0" width={mw} height={mh}>
            <path d={box ? cardPath(movePose, mw, mh) : undefined} fill="#fff" />
          </mask>

          {/* A blurred band ON the outline, trimmed to the inside of the
              shape: the soft inward bevel, following every edge the bite
              makes. */}
          {/* ⚠ THE OUTSIDE IS KNOCKED OUT WITH AN `evenodd` PATH, NOT WITH A
              NESTED `<g mask="url(#glass)">`. The nested reference is not
              honoured here — the band rendered its OUTER half too, which drew
              a faint white line across the cutout where there is no glass at
              all (Samuel #3098A, proved by hiding this layer). Same primitive
              the shadow's knockout already uses, and that one works. */}
          <mask id={ids.rim} maskUnits="userSpaceOnUse" x="0" y="0" width={mw} height={mh}>
            <path
              ref={keep(1)}
              fill="none"
              stroke="#fff"
              strokeWidth={GLASS_RIM_BAND}
              filter={`url(#${ids.rimBlur})`}
            />
            <path ref={rimClip} fillRule="evenodd" fill="#000" />
          </mask>

          <mask
            id={ids.shadow}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={mw + GLASS_SHADOW_PAD * 2}
            height={mh + GLASS_SHADOW_PAD * 2}
          >
            <g transform={`translate(${GLASS_SHADOW_PAD},${GLASS_SHADOW_PAD})`}>
              {GLASS_SHADOW_LAYERS.map((l, i) => (
                <path
                  key={i}
                  ref={keep(2 + i)}
                  fill="#fff"
                  fillOpacity={l.alpha}
                  filter={`url(#${ids.shadowBlur}-${i})`}
                  transform={`translate(0,${l.dy})`}
                />
              ))}
              {/* Knocks the panel's WHOLE rectangle back out — the bite
                  included. See the `knockout` ref for why that is the rect and
                  not the outline. */}
              <path ref={knockout} fill="#000" />
            </g>
          </mask>
        </defs>
      </svg>
    </div>
  );
}

/** `prefers-reduced-motion: reduce` → the panel still changes pose, it just
 *  arrives there instantly (no transition at all, so no clip-path tween). */
function usePrefersReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return still;
}

/** Where `GlassSlot` portals land — one AuthSplitLayout per document, so a
 *  static id is safe. */
export const AUTH_GLASS_SLOT_ID = "auth-glass-slot";
