"use client";

import {
  AGENT_PX,
  AgentCircle,
  BOT_PX,
  Pop,
  Profile,
  WebLine,
  type Ease,
} from "./web-pieces";

/**
 * Step 1's TEAM beat (Samuel 2026-10-13): three people fade in, then lines
 * grow out of each to agents. Some agents are one person's own; two are
 * SHARED, reached by lines from different people — collaboration, so here
 * (unlike the solo tree in `./agent-web.tsx`) a node may have several
 * parents. Uneven angles and lengths on purpose, like the solo web.
 *
 * Unit coordinates inside the web's padded box (`webFrame`); the timeline
 * that drives `shown` / `lines` / `agents` lives in `./solo-team-showcase.tsx`.
 */

/** The people: top-left, lower-left nearer the middle, mid-height right. */
const PEOPLE = [
  { u: 0.2, v: 0.22 },
  { u: 0.3, v: 0.7 },
  { u: 0.78, v: 0.5 },
];
const PERSON_PX = 44;
const PERSON_STAGGER = 160;

/** `color` is an agent colour-bank slot. */
const AGENTS: Record<string, { u: number; v: number; color: number }> = {
  // Shared — reached from more than one person.
  s1: { u: 0.52, v: 0.28, color: 6 },
  s2: { u: 0.57, v: 0.88, color: 12 },
  // Each person's own.
  p0a: { u: 0.42, v: 0.03, color: 2 },
  p0b: { u: 0.03, v: 0.56, color: 16 },
  p1a: { u: 0.1, v: 0.97, color: 8 },
  p2a: { u: 0.95, v: 0.13, color: 4 },
  p2b: { u: 0.93, v: 0.88, color: 1 },
};

/** Person index → agent. Order = grow order. */
const LINKS: { from: number; to: keyof typeof AGENTS }[] = [
  { from: 0, to: "s1" },
  { from: 2, to: "s1" },
  { from: 1, to: "s2" },
  { from: 0, to: "p0a" },
  { from: 2, to: "s2" },
  { from: 1, to: "p1a" },
  { from: 0, to: "p0b" },
  { from: 2, to: "p2a" },
  // Samuel 2026-10-13: the lower-left person joins the middle agent too
  // (shared three ways), and the right person gets a second agent of its own.
  { from: 1, to: "s1" },
  { from: 2, to: "p2b" },
];
export const TEAM_LINE_STAGGER = 120;

/** An agent pops in as its FIRST line lands. */
const firstLink = (id: string) => LINKS.findIndex((l) => l.to === id);

export function TeamWeb({
  s,
  place,
  ease,
  shown,
  lines,
  agents,
  srcs,
}: {
  s: number;
  place: (u: number, v: number) => { x: number; y: number };
  ease: Ease;
  /** The three people. */
  shown: boolean;
  lines: boolean;
  agents: boolean;
  /** Photos, person by person; a gap draws the placeholder. */
  srcs: (string | undefined)[];
}) {
  const person = (i: number) => {
    const p = PEOPLE[i] ?? PEOPLE[0];
    return place(p.u, p.v);
  };
  const agent = (id: string) => {
    const a = AGENTS[id];
    return place(a.u, a.v);
  };
  return (
    <>
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {LINKS.map((l, i) => (
          <WebLine
            key={`${l.from}-${l.to}`}
            a={person(l.from)}
            b={agent(l.to)}
            on={lines}
            delay={i * TEAM_LINE_STAGGER}
            ease={ease}
          />
        ))}
      </svg>

      {Object.entries(AGENTS).map(([id, a]) => (
        <Pop
          key={id}
          p={agent(id)}
          d={AGENT_PX * s}
          on={agents}
          delay={firstLink(id) * TEAM_LINE_STAGGER}
          ease={ease}
        >
          <AgentCircle color={a.color} d={AGENT_PX * s} bot={BOT_PX * s} />
        </Pop>
      ))}

      {PEOPLE.map((_, i) => (
        <Pop
          key={i}
          p={person(i)}
          d={PERSON_PX * s}
          on={shown}
          delay={i * PERSON_STAGGER}
          ease={ease}
          ms={480}
          from={0.92}
        >
          <Profile src={srcs[i]} d={PERSON_PX * s} />
        </Pop>
      ))}
    </>
  );
}
