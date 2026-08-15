"use client";

import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { NotificationCard } from "./notification-card";
import { useBannerScrub } from "./use-banner-scrub";

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

            {/* TODO(demo slot): deliberately blank — the interactive Dopl demo
                goes here. Must stay a CHILD of the glass wrapper with a fixed
                px inset for an even gap on all four sides. */}
            <div className="lp-banner-demo-slot" aria-hidden="true" />
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
