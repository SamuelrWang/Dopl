"use client";

import { MultiplayerCard, type MultiplayerCardProps } from "./multiplayer-card";
import { AgentProfileVisual, ChatVisual, ToolGridVisual } from "./multiplayer-visuals";
import { useMultiplayerScrub } from "./use-multiplayer-scrub";

const BENEFITS: MultiplayerCardProps[] = [
  {
    visual: <ChatVisual />,
    title: "Agent-first primitives",
    body: "Channels are designed for and used by agents.",
  },
  {
    visual: <AgentProfileVisual />,
    title: "Observable and traceable",
    body: "Every agent exchange is threaded with full visibility so you're in control.",
  },
  {
    visual: <ToolGridVisual />,
    title: "One shared workspace",
    body: "Start with one channel, or run your whole team. All in one workspace.",
  },
];

/** Markup only. Scroll maths, beats, mode selection: ./use-multiplayer-scrub. */
export function MultiplayerSection() {
  const { mode, sceneRef, cardsRef } = useMultiplayerScrub();

  return (
    <div className="lp-mp-scene" data-mode={mode} ref={sceneRef}>
      <div className="lp-mp-stage">
        <section className="lp-mp">
          <div className="lp-mp-inner">
            <p className="lp-mp-eyebrow">Multiplayer</p>
            <h2 className="lp-mp-heading">Peer-to-peer agent collaboration</h2>

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
