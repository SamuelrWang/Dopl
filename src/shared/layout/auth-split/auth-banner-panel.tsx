"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LiquidGlass } from "@/shared/design";
import {
  CARD_EASE, CARD_IN_MS, CARD_OUT_MS, CARD_SWAP_SLACK_MS,
  GLASS_HEIGHT, GLASS_MIN_H, GLASS_MS, GLASS_RADIUS,
  GLASS_RIM_BAND, GLASS_RIM_BLUR, GLASS_SHADOW_LAYERS, GLASS_SHADOW_PAD,
  GLASS_SIDE_INSET, GLASS_TOP,
  cardPath, cardRegions,
  type AuthGlassPose,
} from "./auth-glass-geometry";
import { useGlassMorph } from "./glass-morph";
import type { GlassCardContent } from "./glass-card-content";
import { GlassSheen, PaneClip, useGlassTilt, usePrefersReducedMotion } from "./glass-tilt";

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
  enterFrom,
  cardContent,
  cardKey,
}: {
  src: string;
  pose: AuthGlassPose;
  /** Onboarding only, and only with `card`. See {@link GlassCardContent}. */
  cardContent?: GlassCardContent;
  /** Onboarding only — see the call site. `false` on every plain auth surface. */
  card: boolean;
  /**
   * Mount in THIS pose, then slide into `pose` with the normal hand-off —
   * onboarding opening where the login screen's glass left off (Samuel
   * 2026-10-13). Read once, at mount. Omitted: mount already in `pose`.
   */
  enterFrom?: AuthGlassPose;
  /**
   * WHICH card this is, when two views share a pose — the login card and
   * step 4 are both `"default"`. A new key runs the same hand-off as a new
   * pose (fade out, swap, fade in), minus the glass move, and the OLD content
   * keeps the card while it fades. Omitted: the pose is the key.
   */
  cardKey?: string;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const still = usePrefersReducedMotion();

  /**
   * The pose THE GLASS is in, which lags the requested one by the card's
   * fade-out. That lag is the whole sequence: the card is already gone before
   * the glass is allowed to move, so nothing rides along with it.
   */
  const [movePose, setMovePose] = useState<AuthGlassPose>(enterFrom ?? pose);
  const [cardShown, setCardShown] = useState(enterFrom === undefined);
  // The card being SHOWN: its key and content map, which lag the requested
  // ones exactly as `movePose` lags `pose` (see `cardKey`).
  const key = cardKey ?? pose;
  const [held, setHeld] = useState({ key, content: cardContent });
  const latest = useRef(cardContent);
  useEffect(() => {
    latest.current = cardContent;
  });
  useEffect(() => {
    const moving = movePose !== pose;
    if (!moving && held.key === key) {
      // Settled — but a mount that named `enterFrom === pose` starts hidden.
      if (!cardShown) {
        const t = setTimeout(() => setCardShown(true), 0);
        return () => clearTimeout(t);
      }
      return;
    }
    const swap = () => {
      setMovePose(pose);
      setHeld({ key, content: latest.current });
    };
    if (still) {
      swap();
      return;
    }
    setCardShown(false);
    // `CARD_SWAP_SLACK_MS`: this timer can be armed a frame before the fade's
    // first style recalc, and the swap must land at opacity 0 — never with
    // the next step's content or outline faintly on the moving glass.
    const out = CARD_OUT_MS + CARD_SWAP_SLACK_MS;
    const toMove = setTimeout(swap, out);
    const toShow = setTimeout(() => setCardShown(true), out + (moving ? GLASS_MS : 0));
    return () => {
      clearTimeout(toMove);
      clearTimeout(toShow);
    };
    // `movePose`/`held`/`cardShown` are read, not tracked: re-running on them
    // would restart the hand-off halfway and the card would flash mid-slide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, key, still]);

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    glass: `agm-${uid}`,
    rim: `arm-${uid}`,
    shadow: `asm-${uid}`,
    rimBlur: `arb-${uid}`,
    shadowBlur: `asb-${uid}`,
    card: `acm-${uid}`,
  };

  // The mask paths the morph writes each frame (`./glass-morph.ts`).
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const keep = (i: number) => (el: SVGPathElement | null) => {
    paths.current[i] = el;
  };
  // The shadow's knockout is the BITTEN outline, so the cutout gets the same
  // soft shadow as every other edge outside the glass (a knockout of the
  // un-bitten rect left the cutout a pale ghost of the rectangle, Samuel
  // 2026-10-13). The shadow renders ABOVE `LiquidGlass`, out of its backdrop,
  // so the refraction cannot sample it (#3069's dark band).
  const knockout = useRef<SVGPathElement | null>(null);
  /** Knocks everything OUTSIDE the outline off the rim band. */
  const rimClip = useRef<SVGPathElement | null>(null);
  const [morphTargets] = useState(() => ({ pane: paneRef, group: groupRef, paths, knockout, rimClip }));
  const { pane: paneSize, box } = useGlassMorph(morphTargets, movePose, still);

  const masked = box !== null;
  /**
   * ⚠ THE SHAPE-FOLLOWING EDGE IS ON IN EVERY POSE, the plain rect included.
   * LiquidGlass's unshaped treatment (inset glint + rect box-shadow) is a
   * wider, whiter bevel than the rim, so the plain-rect pose wore a visibly
   * brighter edge than the bitten ones (Samuel 2026-10-13, page 3 + login);
   * and because it draws the full rectangle blind to the mask, every swap
   * between the two drew a rectangle border over an open cutout. One
   * treatment for every pose ends both. `masked` only gates the first frame,
   * before the outline has been measured.
   */
  const shaped = masked;
  // Mask regions, in the masked element's own px: the PANE's size, which no
  // box ever exceeds, so one region holds every frame of a box-changing morph.
  const mw = paneSize?.w ?? 0;
  const mh = paneSize?.h ?? 0;
  // The card's visibility, shared by the card and anything painted on it.
  // `movePose === pose` too: the render that CHANGES the pose (or first turns
  // `card` on, coming from login) runs before the effect hides the card, and
  // would flash it a frame.
  const settledKey = held.key === key;
  const cardOn = cardShown && movePose === pose && settledKey;
  // ⚠ KEYED ON `cardOn`, NOT `cardShown`. The render that changes the pose
  // turns `cardOn` off while `cardShown` is still true, so keying on
  // `cardShown` started the fade-OUT with CARD_IN_MS (400) — and a running
  // transition keeps its duration when the string changes a render later.
  // The glass then moved at 300 with the content still at ~8% (measured
  // 2026-10-13: `getAnimations()` read `opacity 400ms` on a fade-out).
  const cardFade = still
    ? undefined
    : `opacity ${cardOn ? CARD_IN_MS : CARD_OUT_MS}ms ${CARD_EASE}`;
  // The settled card reads the LIVE map (a re-render may hand a new one); a
  // card on its way out keeps the map it was shown with.
  const renderContent = card && box ? (settledKey ? cardContent : held.content)?.[movePose] : undefined;
  // Hover tilt: onboarding's card surfaces only, and only while no hand-off
  // is in flight (`./glass-tilt.tsx` owns the pointer + capability gates).
  useGlassTilt(
    { pane: paneRef, group: groupRef, shadow: shadowRef, sheen: sheenRef },
    card && masked && cardOn
  );

  return (
    <div
      className="relative h-full w-full rounded-[32px] bg-[#060A0F]"
      style={{
        boxShadow:
          "0 6px 16px rgba(8,10,15,0.28), " +
          "0 28px 64px rgba(8,10,15,0.34), " +
          "0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      {/* Rounded by a clip-path, never overflow-hidden — see `PaneClip`. */}
      <PaneClip paneRef={paneRef}>
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
          ref={groupRef}
          // Until the pane is measured, the historical percentages; after,
          // `useGlassMorph` writes the box in px every frame (it moves size
          // too for the vertical pose), so React renders no geometry at all.
          style={
            paneSize
              ? { position: "absolute" }
              : {
                  position: "absolute",
                  left: `${GLASS_SIDE_INSET * 100}%`,
                  right: `${GLASS_SIDE_INSET * 100}%`,
                  top: `${(movePose === "vertical-left-top-notch" ? 0.32 : GLASS_TOP[movePose]) * 100}%`,
                  height: `${GLASS_HEIGHT * 100}%`,
                  minHeight: GLASS_MIN_H,
                }
          }
        >
          <LiquidGlass
            radius={GLASS_RADIUS}
            maskUrl={masked ? `url(#${ids.glass})` : undefined}
            rimMaskUrl={masked ? `url(#${ids.rim})` : undefined}
            shaped={shaped}
            // Mid-flight the box changes size every frame; rebuilding the
            // refraction map per frame would pop. Stretch it, rebuild on landing.
            freezeMap={!cardShown && !still}
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
              // ⚠ ONE OPACITY FOR THE CARD AND EVERYTHING ON IT. The card and
              // its content used to be two sibling layers, each with its own
              // copy of this fade — identical numbers, two animations, two
              // compositor layers — and Samuel watched the content outlast
              // the card on every step change (2026-10-13): the white card
              // washed into the pale glass while the dark content kept its
              // contrast and still sat there, "random elements on the glass
              // panel". Now the fade lives on THIS wrapper only, so the card
              // and its content are flattened into one image and faded as one;
              // neither child carries an opacity or transition of its own.
              <div
                data-glass-card-fade=""
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: cardOn ? 1 : 0,
                  transition: cardFade,
                  pointerEvents: "none",
                }}
              >
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
                  }}
                />

                {/* ON THE CARD — a later sibling so it paints above the card.
                    Not masked (and outside the card's drop-shadow filter):
                    renderers place themselves inside `cardRegions`, which never
                    cross the card's outline. */}
                {renderContent && box && (
                  <div style={{ position: "absolute", inset: 0 }}>
                    {renderContent({
                      regions: cardRegions(movePose, box.w, box.h),
                      active: cardOn,
                      still,
                    })}
                  </div>
                )}
              </div>
            )}
          </LiquidGlass>

          {/* The tilt's sheen — see `GlassSheen`. */}
          {masked && card && <GlassSheen sheenRef={sheenRef} maskId={ids.glass} />}

          {/* Shape-following drop shadow, OUTSIDE the glass: the glass root
              clips its own overflow, and a box-shadow there can only ever be a
              rectangle. Its mask paints the blurred outline and then knocks the
              bitten outline back out, so the shadow exists only beyond the edge
              — the cutout included — and never darkens the glass. ⚠ AFTER
              `LiquidGlass` IN DOM ORDER, ON PURPOSE: painted above the glass it
              is not part of the glass's backdrop, so the refraction cannot pull
              it into the panel (see `knockout`). Off when `shaped` is, so a
              plain pose keeps the original box-shadow instead. */}
          {masked && (
            <div
              ref={shadowRef}
              aria-hidden
              style={{
                position: "absolute",
                inset: -GLASS_SHADOW_PAD,
                background: "rgba(8,10,15,0.5)",
                mask: `url(#${ids.shadow})`,
                WebkitMask: `url(#${ids.shadow})`,
                opacity: shaped ? 1 : 0,
                pointerEvents: "none",
              }}
            />
          )}
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
              <path d={box ? cardPath(movePose, box.w, box.h) : undefined} fill="#fff" />
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
                {/* Knocks the bitten outline back out, so the cutout keeps its
                    shadow. See the `knockout` ref. */}
                <path ref={knockout} fill="#000" />
              </g>
            </mask>
          </defs>
        </svg>
      </PaneClip>
    </div>
  );
}

/** Where `GlassSlot` portals land — one AuthSplitLayout per document, so a
 *  static id is safe. */
export const AUTH_GLASS_SLOT_ID = "auth-glass-slot";
