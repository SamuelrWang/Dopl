"use client";

import { MockAgentFace, Sequence, accent, at } from "./ontology-bits";
import {
  AGENTS,
  CHANNEL,
  RAIL_STATUS_LABEL,
  type RailEdge,
  type RailStatus,
} from "./ontology-content";
import { THREAD_SLOTS } from "./ontology-thread";

/**
 * The Channels window's right-hand rail: one card per agent in the channel —
 * the app's agent card (avatar, name, status pill; "↳ thread · identity";
 * context tokens over a track; tokens spent) at landing scale.
 *
 * ⚠ NO CLOCK OF ITS OWN. Every step names a feed line and a moment of it
 * (./ontology-content.ts › CHANNEL.rail), resolved here against the feed's
 * own slots (./ontology-thread.ts), so a card flips to "Posting" on the same
 * `--d` its post's typing row starts. Same play contract as the feed
 * (./ontology-bits.tsx): base rules = the final frame.
 */

/** A beat after a line lands before its author's card settles. */
const AFTER_MS = 400;

function beat(line: number, edge: RailEdge): number {
  const slot = THREAD_SLOTS[line];
  if (edge === "start") return 0;
  if (edge === "typing") return slot.typing ?? slot.at;
  return edge === "land" ? slot.at : slot.at + AFTER_MS;
}

/** Every rail step resolved to ms — exported so the tour test can pin that
 *  none lands after the window's last beat. */
export const RAIL_CARDS = CHANNEL.rail.agents.map((card) => {
  const steps = card.steps.map(([status, line, edge]): [RailStatus, number] => [status, beat(line, edge)]);
  return { ...card, steps, joinAt: steps[0][1], lastAt: steps[steps.length - 1][1] };
});

export function AgentRail() {
  const r = CHANNEL.rail;
  return (
    <div className="lp-ont-rail">
      {RAIL_CARDS.map((card) => {
        const agent = AGENTS[card.agent];
        const [k0, k1] = card.context;
        const span = Math.max(1, card.lastAt - card.joinAt);
        return (
          <div key={card.agent} className="lp-ont-grow" style={at(card.joinAt)}>
            <div>
              <div className="lp-ont-acard" style={accent(agent.color)}>
                <div className="lp-ont-acard-head">
                  <MockAgentFace id={card.agent} d={22} />
                  <span className="lp-ont-acard-name">{agent.name}</span>
                  <Sequence
                    className="lp-ont-stack lp-ont-stack--end"
                    steps={card.steps}
                    render={(s) => <span className={`lp-ont-apill lp-ont-apill--${s}`}>{RAIL_STATUS_LABEL[s]}</span>}
                  />
                </div>
                <p className="lp-ont-acard-where">
                  <span>
                    ↳ #{CHANNEL.name} · {card.identity}
                  </span>
                  <span className="lp-ont-acard-spent">
                    {card.spent} {r.spentLabel}
                  </span>
                </p>
                <p className="lp-ont-acard-row">
                  {r.contextLabel}
                  <Sequence
                    className="lp-ont-stack lp-ont-stack--end"
                    steps={[
                      [k0, card.joinAt],
                      [k1, card.lastAt],
                    ]}
                    render={(k) => (
                      <span className="lp-ont-acard-value">
                        {k}k / {card.limit}
                      </span>
                    )}
                  />
                </p>
                <span className="lp-ont-acard-track">
                  <b
                    className="lp-ont-ramp"
                    style={{
                      ...at(card.joinAt, span),
                      width: `${(k1 / card.limitK) * 100}%`,
                      ["--k0" as string]: String(k0 / k1),
                    }}
                  />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
