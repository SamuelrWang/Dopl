"use client";

import "@/features/marketing/sdk.css";

import { ArrowRight } from "lucide-react";

import { MultiplayerCard, type MultiplayerCardProps } from "./multiplayer-card";
import { SDK_COPY as C } from "./sdk-content";
import { CapabilitiesVisual, EmbeddedVisual, RoutingVisual } from "./sdk-visuals";
import { useMultiplayerScrub } from "./use-multiplayer-scrub";

/** Developers section: the reach layer, pitched to agent builders.
 *  Copy: ./sdk-content.ts. Visuals: ./sdk-visuals.tsx. Story: Dopl KB
 *  "Reach Layer Strategy" (dopl-development).
 *
 *  ⚠ The identity section's ENTRANCE, by reuse, not by copy (Samuel
 *  2026-10-22): this is multiplayer-section.tsx's exact scene markup
 *  (`.lp-mp-scene` > `.lp-mp-stage` > `.lp-mp` > `.lp-mp-inner`, eyebrow,
 *  heading, `.lp-mp-cards`) driven by its own instance of
 *  `useMultiplayerScrub`, so the pin, scrub, heading fade, card rise, reveal
 *  fallback and reduced-motion handling all come from that hook and
 *  marketing.css › "Multiplayer". The hook is per-instance (its own refs and
 *  mode), so the identity section is untouched. Keep the class names; they
 *  ARE the contract. Card visuals start via use-visual-play once the cards
 *  are on screen, the same as the identity cards.
 *
 *  The CTA sits OUTSIDE the scene so it never has to fit the pinned stage. */
const CARDS: MultiplayerCardProps[] = [
  { visual: <CapabilitiesVisual />, title: C.capabilities.title, body: C.capabilities.body },
  { visual: <RoutingVisual />, title: C.routing.title, body: C.routing.body },
  { visual: <EmbeddedVisual />, title: C.embedded.title, body: C.embedded.body },
];

export function SdkSection() {
  const { mode, sceneRef, cardsRef } = useMultiplayerScrub();

  return (
    <div className="lp-sdk">
      <div className="lp-mp-scene" data-mode={mode} ref={sceneRef}>
        <div className="lp-mp-stage">
          <section className="lp-mp">
            <div className="lp-mp-inner">
              <p className="lp-mp-eyebrow lp-sdk-eyebrow">
                {C.eyebrow}
                <span className="lp-sdk-tag">{C.tag}</span>
              </p>
              <h2 className="lp-mp-heading">{C.heading}</h2>

              {/* ⚠ The engine addresses the cards as this row's CHILDREN. */}
              <div className="lp-mp-cards" ref={cardsRef}>
                {CARDS.map((card) => (
                  <MultiplayerCard key={card.title} {...card} />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="lp-sdk-cta">
        <a href={C.ctaHref} className="lp-btn lp-btn--sm lp-btn--3d">
          {C.cta}
          <ArrowRight size={14} strokeWidth={2} aria-hidden />
        </a>
      </div>
    </div>
  );
}
