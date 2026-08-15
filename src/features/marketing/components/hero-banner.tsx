"use client";

import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { NotificationCard } from "./notification-card";
import { useBannerScrub } from "./use-banner-scrub";

/**
 * Landscape banner between the hero CTA and the Multiplayer section, staged as
 * a scroll-scrubbed pinned scene: the picture pins centred in the viewport with
 * a Dopl notification seated top-right, a cursor flies in and clicks it, and
 * the notification then GROWS out of its own top-right corner into a rectangle
 * inset in the picture, with a blank white product-demo panel fading in over it
 * at the end.
 *
 * All of the scroll maths, the beat timeline, the mode selection (static /
 * reduced / scrub) and the reason the ripple is the only non-scrubbed beat live
 * in ./use-banner-scrub. This file is only the markup.
 */
export function HeroBanner() {
  const { mode, sceneRef, pictureRef, glassRef, cursorRef, rippleRef } =
    useBannerScrub();

  return (
    <div className="lp-banner-scene" data-mode={mode} ref={sceneRef}>
      <div className="lp-banner-stage">
        <div className="lp-banner" ref={pictureRef}>
          {/* Decorative; the glass card carries the copy. Plain <img>: the asset
              is a static public/ file and the box is width-driven. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/landscape-banner.jpg"
            alt=""
            className="lp-banner-img"
            draggable={false}
          />

          {/* The wrapper carries the scrubbed box; LiquidGlass just fills it.
              `staticMap` during the scrub: the box animates every frame, and a
              per-resize map rebuild swaps the <feImage> data-URI whose async
              decode pops the refraction — the frozen map stretches with the
              box instead, so the rim scales with the panel. */}
          <div className="lp-banner-glass" ref={glassRef}>
            <LiquidGlass
              radius={18}
              staticMap={mode === "scrub"}
              className="lp-banner-glass-card"
            >
              <NotificationCard />

              {/* Click ripple. Inside the card so LiquidGlass's own
                  `overflow-hidden` clips it to the glass. The engine writes its
                  centre and fires it by class — see use-banner-scrub. */}
              <span className="lp-banner-ripple" ref={rippleRef} aria-hidden="true" />
            </LiquidGlass>

            {/* TODO(demo slot): this empty white panel is the PRODUCT-DEMO
                SLOT — drop the interactive Dopl demo in here. Deliberately
                blank. A CHILD of the glass wrapper with a fixed px inset, so
                its gap to the glass edge is the same on all four sides. */}
            <div className="lp-banner-demo-slot" aria-hidden="true" />
          </div>

          {/* macOS pointer, drawn inline (no asset). A SIBLING of the glass so
              it rides above it; the tip sits at the element's origin, so the
              engine's translate3d IS the tip position and `scale` keeps it
              pinned there. Hidden outside `scrub`. */}
          <div className="lp-banner-cursor" ref={cursorRef} aria-hidden="true">
            {/* Slim all-black pointer, rotated to aim right-and-down. The
                rotation's origin is the TIP (0.75,0.9 in viewBox units, 1:1
                with CSS px at this size), so the engine's translate — which
                treats the element origin as the tip — stays exact. */}
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
