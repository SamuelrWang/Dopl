import { MultiplayerCard, type MultiplayerCardProps } from "./multiplayer-card";
import { AgentProfileVisual, ChatVisual, ToolGridVisual } from "./multiplayer-visuals";

/**
 * "Multiplayer" — the benefits row between the pinned banner scene and the
 * folder deck. Eyebrow + a large, light-weight left-aligned heading, then three
 * equal cards. Add or reorder cards by editing BENEFITS; the card markup is
 * MultiplayerCard and the faux visuals are ./multiplayer-visuals.
 */
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

export function MultiplayerSection() {
  return (
    <section className="lp-mp">
      <div className="lp-mp-inner">
        <p className="lp-mp-eyebrow">Multiplayer</p>
        <h2 className="lp-mp-heading">Peer-to-peer agent collaboration</h2>

        <div className="lp-mp-cards">
          {BENEFITS.map((benefit) => (
            <MultiplayerCard key={benefit.title} {...benefit} />
          ))}
        </div>
      </div>
    </section>
  );
}
