"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { PairedAvatar, agentColor } from "@/features/onboarding/components/paired-avatar";
import { AGENTS, ASSISTANTS, PEOPLE, type Actor, type AgentId, type PersonId } from "./ontology-content";
import { at } from "./multiplayer-visuals";

/**
 * Small shared pieces for the Orchestration windows (./ontology-windows.tsx,
 * ./ontology-command.tsx).
 *
 * PLAY CONTRACT — the Multiplayer cards' (marketing.css › "Multiplayer
 * visuals"), restated under `.lp-ont-*`: every animated element carries its
 * start as `--d` (and a window length as `--w`) via `at()`; the section writes
 * `data-play` on the window's swap wrapper — `armed` = start frame, `in` = the
 * keyframes run once. ⚠ The BASE rules are the FINAL frame, so SSR, no JS and
 * reduced motion (which never get the attribute) render the finished window.
 *
 *   .lp-ont-rise / -fade  appear at --d (the base rule is where they land)
 *   .lp-ont-on            visible ONLY during [--d, --d + --w]; hidden at rest
 *   .lp-ont-off           hidden ONLY during [--d, --d + --w]; visible at rest
 *   .lp-ont-grow          a message row growing in at --d (pushes the lane up)
 */
export { at };

/** Merges a colour-bank slot into an element's style as `--ac`. */
export const accent = (color: number, style?: CSSProperties) =>
  ({ ...style, "--ac": agentColor(color) }) as CSSProperties;

/** An agent = an identity of the user: the user's photo ringed in the agent's
 *  colour, with the runtime's mark inset bottom-right, ringed the same — the
 *  onboarding demos' `PairedAvatar`, by import (Samuel, 2026-10-21). */
export function AgentFace({ id, d = 22, thinFrame = true }: { id: AgentId; d?: number; thinFrame?: boolean }) {
  const agent = AGENTS[id];
  return (
    <PairedAvatar d={d} photo={PEOPLE.sam.photo} agentLogo={agent.runtime.logo} color={agent.color} thinFrame={thinFrame} />
  );
}

/** ⚠ `alt=""`: every face sits beside its own name. */
export function PersonFace({ id, d = 22 }: { id: PersonId; d?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny decorative avatar
    <img
      src={PEOPLE[id].photo}
      alt=""
      className="lp-ont-avatar"
      style={{ width: d, height: d }}
      width={d}
      height={d}
      draggable={false}
    />
  );
}

/** Name, colour and runtime of anything that posts like an agent: one of
 *  Sam's agents or another person's assistant. `null` for a person. */
export function actorAgent(actor: Actor) {
  if ("agent" in actor) return AGENTS[actor.agent];
  if ("assistant" in actor) {
    const a = ASSISTANTS[actor.assistant];
    return a ? { ...a, name: `${PEOPLE[actor.assistant].name}'s Assistant` } : null;
  }
  return null;
}

export function ActorFace({ actor, d = 22 }: { actor: Actor; d?: number }) {
  if ("agent" in actor) return <AgentFace id={actor.agent} d={d} />;
  if ("assistant" in actor) {
    const a = ASSISTANTS[actor.assistant];
    return (
      <PairedAvatar d={d} photo={PEOPLE[actor.assistant].photo} agentLogo={a?.runtime.logo} color={a?.color ?? 1} thinFrame />
    );
  }
  return <PersonFace id={actor.person} d={d} />;
}

export const actorName = (actor: Actor) =>
  "person" in actor ? PEOPLE[actor.person].name : (actorAgent(actor)?.name ?? "");

/** Message text with every `@Name` (or `@Name's Assistant`) drawn as a mention pill. */
export function WithMentions({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@[A-Za-z]+(?:'s Assistant)?)/).map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="lp-ont-at">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Typed text: each character is zero-width until its own time. */
export function Typed({ text, start, step }: { text: string; start: number; step: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="lp-ont-type" style={at(start + i * step)}>
          {ch}
        </span>
      ))}
    </>
  );
}

/** Three bouncing dots, shown only inside their window. */
export function TypingDots({ from, length }: { from: number; length: number }) {
  return (
    <span className="lp-ont-dots lp-ont-on" style={at(from, length)}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * States that REPLACE one another in one slot (a task's status, a counter):
 * every state but the last is `.lp-ont-on` for its own span; the last fades in
 * at its time and is the end frame.
 */
export function Sequence<T>({
  steps,
  render,
  className = "lp-ont-stack",
}: {
  steps: readonly (readonly [T, number])[];
  render: (value: T) => ReactNode;
  className?: string;
}) {
  return (
    <span className={className}>
      {steps.map(([value, start], i) => {
        const last = i === steps.length - 1;
        return (
          <span
            key={i}
            className={last ? "lp-ont-fade" : "lp-ont-on"}
            style={last ? at(start) : at(start, steps[i + 1][1] - start)}
          >
            {render(value)}
          </span>
        );
      })}
    </span>
  );
}
