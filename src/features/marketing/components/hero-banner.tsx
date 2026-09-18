"use client";

import dynamic from "next/dynamic";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { NotificationCard } from "./notification-card";
import { useBannerScrub } from "./use-banner-scrub";

/**
 * 🔒 **THE SCENE IS CLIENT-ONLY, AND THAT IS A CORRECTNESS FENCE RATHER THAN A
 * PERFORMANCE ONE (2026-09-17).** Server-rendering it threw
 * *"Hydration failed because the server rendered text didn't match the client"*
 * on every fresh load, naming `DemoChannelList → WellsColumn`.
 *
 * ⚠ **THREE INDEPENDENT CLOCKS MAKE IT UNFIXABLE ON THE SERVER, not one bug.**
 * The scene prints channel-row timestamps through the product's own
 * `shared/lib/format-time.ts › formatChannelTimestamp`, and that function is
 * correct for an app that only ever runs in a browser:
 *   1. the fixture's anchor is `Date.now()` at MODULE SCOPE, and the server and
 *      client bundles are separate module instances evaluated seconds apart — so
 *      any row can land on a different minute in the two renders
 *      (`banner-demo-hydration.test.tsx` reproduces exactly this with a 61s skew);
 *   2. `toLocaleTimeString` / `toLocaleDateString` read the RUNTIME's time zone —
 *      UTC on the deploy, whatever the reader is in on the client;
 *   3. its same-day test is against a fresh `new Date()`, which can flip between
 *      the two renders on its own.
 * **(2) cannot be fixed here without forking the shared formatter**, which the
 * visual-match rules forbid — the scene shares the product's recipes or it is a
 * look-alike. So the honest fix is to stop asking a server to render a scene
 * whose whole job is to animate on a clock.
 *
 * ⚠ **IT COSTS NOTHING VISIBLE.** The slot below is `opacity: var(--lp-slot-opacity, 0)`
 * and only fades in when the scroll engine flips it (`use-banner-scrub`), and the
 * whole subtree is `aria-hidden` decoration with no SEO value. Under
 * `prefers-reduced-motion` the slot IS visible at once and the scene arrives a
 * beat later, which is a decorative element painting late rather than an error.
 *
 * 🚫 **DO NOT "OPTIMISE" THIS BACK TO A STATIC IMPORT.** The hydration failure it
 * prevents is RECOVERABLE, so React discards the server HTML and re-renders the
 * whole document on the client — which is also what made the root layout's
 * pre-paint `<script>` render client-side and log *"Scripts inside React
 * components are never executed when rendering on the client"*. One boundary,
 * two symptoms.
 */
const BannerDemo = dynamic(
  () => import("./banner-demo/banner-demo").then((m) => m.BannerDemo),
  { ssr: false }
);

/** Markup only. Scroll maths, beats, mode selection: ./use-banner-scrub. */
export function HeroBanner() {
  const { mode, sceneRef, pictureRef, glassRef, cursorRef, rippleRef } =
    useBannerScrub();

  return (
    <div className="lp-banner-scene" data-mode={mode} ref={sceneRef}>
      <div className="lp-banner-stage">
        <div className="lp-banner" ref={pictureRef}>
          {/* Decorative — glass card carries the copy. Plain <img>: static
              public/ asset, width-driven box. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/landscape-banner.jpg"
            alt=""
            className="lp-banner-img"
            draggable={false}
          />

          {/* Wrapper carries the scrubbed box; LiquidGlass fills it.
              ⚠ `staticMap` while scrubbing: box animates every frame, and a
              per-resize map rebuild swaps the <feImage> data-URI whose async
              decode pops the refraction. Frozen map stretches with the box. */}
          <div className="lp-banner-glass" ref={glassRef}>
            <LiquidGlass
              radius={18}
              staticMap={mode === "scrub"}
              className="lp-banner-glass-card"
            >
              <NotificationCard />

              {/* Click ripple. ⚠ Must stay inside the card — LiquidGlass's
                  `overflow-hidden` is what clips it. Engine writes its centre
                  and fires it by class (use-banner-scrub). */}
              <span className="lp-banner-ripple" ref={rippleRef} aria-hidden="true" />
            </LiquidGlass>

            {/* Demo slot — a CHILD of the glass wrapper with a fixed px inset
                for an even gap on all four sides. It is the scene's WINDOW:
                BannerDemo FILLS this box edge to edge (width sets the scale,
                height is derived — banner-demo.tsx › `fit`; it used to
                contain-fit and leave white gutters down both sides) and slaves
                its clock to the slot's opacity flips (use-demo-timeline.ts). */}
            <div className="lp-banner-demo-slot" aria-hidden="true">
              <BannerDemo />
            </div>
          </div>

          {/* macOS pointer, inline. ⚠ SIBLING of the glass so it rides above.
              Tip sits at the element origin, so the engine's translate3d IS the
              tip position and `scale` keeps it pinned. Hidden outside `scrub`. */}
          <div className="lp-banner-cursor" ref={cursorRef} aria-hidden="true">
            {/* ⚠ transformOrigin is the TIP (0.75,0.9 viewBox units, 1:1 with
                CSS px at this size) — keeps the engine's origin-is-tip
                translate exact under the rotation. */}
            <svg
              viewBox="0 0 13 19"
              width="13"
              height="19"
              fill="none"
              style={{ transform: "rotate(45deg)", transformOrigin: "0.75px 0.9px" }}
            >
              <path
                d="M0.75 0.9 L0.75 15.2 L4.3 11.9 L6.4 16.8 L8.3 15.9 L6.3 11.1 L10.6 10.8 Z"
                fill="#0b0b0c"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
