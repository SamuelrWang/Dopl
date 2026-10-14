"use client";

import type { GlassCardContext } from "@/shared/layout/auth-split";
import { TeamWeb } from "./team-web";
import {
  AGENT_PX,
  AgentCircle,
  BOT_PX,
  Pop,
  Profile,
  WebLine,
  makeEase,
  webFrame,
} from "./web-pieces";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * The agent web drawn on step 1's glass card. The timeline that decides what
 * is on screen lives in `./solo-team-showcase.tsx`; this file is presentation,
 * driven by the `WebStage` booleans, and the circles / lines / glyphs are
 * `./web-pieces.tsx`.
 *
 * Phase A is a TREE, not a mesh (Samuel 2026-10-13): the user in the middle,
 * black lines growing out to a few agents, then each of those launching its
 * own sub-agents, fanning AWAY from the centre. Every sub-agent has exactly
 * one parent, and the first ring is deliberately uneven — angles and lengths
 * both — so it never reads as a perfect X. Phase B fades the whole web out
 * and hands over to `./team-web.tsx`: three people and their agents.
 *
 * Laid out in UNIT coordinates and mapped onto the region, so it fits the
 * card from a 1280 to a 1920 window.
 */

export interface WebStage {
  you: boolean;
  lines1: boolean;
  agents1: boolean;
  lines2: boolean;
  agents2: boolean;
  /** Phase B: the whole web fades out… */
  webOut: boolean;
  /** …then the three team profiles fade in… */
  team: boolean;
  /** …then their lines grow… */
  teamLines: boolean;
  /** …and their agents pop in as each first line lands. */
  teamAgents: boolean;
  /** Cycle restart: snap everything hidden with no transition, so lines do
   *  not visibly retract while the card fades back in. */
  reset: boolean;
  /** Reduced motion: the finished frame, no transitions. */
  still: boolean;
}

interface WebNode {
  id: string;
  /** Centre, as a fraction of the drawing box. */
  u: number;
  v: number;
  /** 0 the user · 1 first ring · 2 sub-agents. */
  tier: 0 | 1 | 2;
  /** Tier 1–2: the one node it hangs off. */
  parent?: string;
  /** Agent colour-bank slot, 1–16. */
  color?: number;
  /** Stagger slot within its tier's reveal. */
  slot: number;
}

const NODES: WebNode[] = [
  { id: "you", u: 0.5, v: 0.52, tier: 0, slot: 0 },
  // First ring — uneven on purpose (angle and length both).
  { id: "a", u: 0.27, v: 0.22, tier: 1, parent: "you", color: 1, slot: 0 },
  { id: "b", u: 0.66, v: 0.15, tier: 1, parent: "you", color: 10, slot: 1 },
  { id: "c", u: 0.79, v: 0.62, tier: 1, parent: "you", color: 7, slot: 2 },
  { id: "d", u: 0.36, v: 0.8, tier: 1, parent: "you", color: 13, slot: 3 },
  // Sub-agents, each fanning outward from its own parent.
  { id: "a1", u: 0.08, v: 0.12, tier: 2, parent: "a", color: 3, slot: 0 },
  { id: "a2", u: 0.12, v: 0.44, tier: 2, parent: "a", color: 15, slot: 1 },
  { id: "b1", u: 0.88, v: 0.1, tier: 2, parent: "b", color: 11, slot: 2 },
  { id: "c1", u: 0.95, v: 0.4, tier: 2, parent: "c", color: 5, slot: 3 },
  { id: "c2", u: 0.93, v: 0.88, tier: 2, parent: "c", color: 9, slot: 4 },
  { id: "d1", u: 0.14, v: 0.9, tier: 2, parent: "d", color: 14, slot: 5 },
];

const YOU_PX = 40;
const STAGGER: Record<WebNode["tier"], number> = { 0: 0, 1: 220, 2: 130 };

export function AgentWeb({
  rect,
  stage,
  avatarSrc,
  teamSrcs = [],
}: {
  rect: CardRect;
  stage: WebStage;
  avatarSrc?: string;
  /** Phase B's other two people (the first profile reuses `avatarSrc`). */
  teamSrcs?: (string | undefined)[];
}) {
  const { s, place } = webFrame(rect);
  const at = new Map(NODES.map((n) => [n.id, place(n.u, n.v)]));
  const pos = (id: string) => at.get(id) ?? { x: 0, y: 0 };
  const ease = makeEase(!stage.still && !stage.reset);
  const shown = (tier: WebNode["tier"]) =>
    tier === 0 ? stage.you : tier === 1 ? stage.agents1 : stage.agents2;

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
    >
      {/* The solo web — faded out WHOLE (lines and circles together) for
          phase B, and absent from the reduced-motion frame, which is B's. */}
      {!stage.still && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: stage.webOut ? 0 : 1,
            transition: ease(450, 0, ["opacity"]),
          }}
        >
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            {NODES.filter((n) => n.parent).map((n) => (
              <WebLine
                key={n.id}
                a={pos(n.parent ?? "you")}
                b={pos(n.id)}
                on={n.tier === 1 ? stage.lines1 : stage.lines2}
                delay={n.slot * STAGGER[n.tier]}
                ease={ease}
              />
            ))}
          </svg>

          {NODES.map((n) => {
            const d = (n.tier === 0 ? YOU_PX : AGENT_PX) * s;
            return (
              <Pop
                key={n.id}
                p={pos(n.id)}
                d={d}
                on={shown(n.tier)}
                delay={n.slot * STAGGER[n.tier]}
                ease={ease}
              >
                {n.tier === 0 ? (
                  <Profile src={avatarSrc} d={d} />
                ) : (
                  <AgentCircle color={n.color ?? 1} d={d} bot={BOT_PX * s} />
                )}
              </Pop>
            );
          })}
        </div>
      )}

      {/* Phase B — the team: the first person reuses `avatarSrc`. */}
      <TeamWeb
        s={s}
        place={place}
        ease={ease}
        shown={stage.team}
        lines={stage.teamLines}
        agents={stage.teamAgents}
        srcs={[avatarSrc, ...teamSrcs]}
      />
    </div>
  );
}
