"use client";

import { MultiplayerCard, type MultiplayerCardProps } from "./multiplayer-card";
import { RotatingWord } from "./rotating-word";
import { MULTIPLAYER_COPY as C } from "./multiplayer-content";
import { DeployVisual } from "./multiplayer-thread";
import { IdentityVisual, RulesVisual } from "./multiplayer-visuals";
import { useMultiplayerScrub } from "./use-multiplayer-scrub";

/** Copy lives in ./multiplayer-content.ts. */
const BENEFITS: MultiplayerCardProps[] = [
  { visual: <IdentityVisual />, title: C.identity.title, body: C.identity.body },
  { visual: <RulesVisual />, title: C.rules.title, body: C.rules.body },
  { visual: <DeployVisual />, title: C.deploy.title, body: C.deploy.body },
];

/** The heading's cycling verb. */
const IDENTITY_VERBS = ["work", "think", "write", "choose"] as const;

/** Markup only. Scroll maths, beats, mode selection: ./use-multiplayer-scrub. */
export function MultiplayerSection() {
  const { mode, sceneRef, cardsRef } = useMultiplayerScrub();

  return (
    <div className="lp-mp-scene" data-mode={mode} ref={sceneRef}>
      <div className="lp-mp-stage">
        <section className="lp-mp">
          <div className="lp-mp-inner">
            <p className="lp-mp-eyebrow">Multiplayer</p>
            <h2 className="lp-mp-heading">
              Digital identities to <RotatingWord words={IDENTITY_VERBS} /> like you
            </h2>

            {/* ⚠ Cards are addressed as this row's CHILDREN by the engine —
                keep it a plain list, one element per benefit. */}
            <div className="lp-mp-cards" ref={cardsRef}>
              {BENEFITS.map((benefit) => (
                <MultiplayerCard key={benefit.title} {...benefit} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
