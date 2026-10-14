"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { AgentWeb, type WebStage } from "./agent-web";

/**
 * Step 1's glass card, filled (Samuel 2026-10-13): the step's old description
 * line moved OFF the form and onto the card, told in two beats.
 *
 *   A — SOLO. The card's short side reads "Dopl works whether you're flying
 *       solo…" while its tall side grows the whole tree: lines from the user
 *       out to a first ring of agents, then each of those launching its own
 *       sub-agents — one person orchestrating many.
 *   B — TEAM. The line fades to "…or building with your entire team", the
 *       web fades out, three people fade in, and lines grow from each to
 *       agents — some their own, some SHARED between people.
 *
 * Then the whole card's content fades and the cycle starts over.
 *
 * Mounted through `AuthSplitLayout` › glassCardContent, keyed to step 1's
 * pose, so it rides the card's own fade: `active` is false whenever the card
 * is not settled and shown, and the clock freezes on that — nothing moves
 * under a fade, and every return to step 1 starts from beat zero.
 *
 * `still` (prefers-reduced-motion) draws ONE calm frame: phase B's finished
 * team web, and the sentence whole.
 */

/** Beat times in ms from the cycle's start. Text and web switch phase on the
 *  SAME marks, so the two halves of the card never disagree. */
const T = {
  aYou: 250,
  aLines1: 500, // centre → first ring (staggered inside `AgentWeb`)
  aAgents1: 1100,
  aLines2: 1900, // first ring → their own sub-agents
  aAgents2: 2500, // last one lands ~3.5s: the full tree holds ~3s
  aOut: 6400, // line A + the whole web fade out
  bIn: 6900, // line B fades in
  bTeam: 7000, // three people fade in, once the web is gone
  bLines: 7700, // lines out of each person (staggered inside `TeamWeb`)
  bAgents: 8300, // each agent lands with its first line

  end: 13600, // everything fades
  cycle: 14200,
} as const;

const MARKS = Object.values(T).filter((v) => v !== T.cycle);

/**
 * The cycle clock. Only ever SET at a mark, never ticked, so it re-renders
 * ~12 times per 14s cycle instead of every frame. Restarts from 0 each time
 * `active` turns on; freezes (keeps the last mark) when it turns off.
 */
function useCycleClock(active: boolean, still: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active || still) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers.push(setTimeout(() => setT(0), 0));
      for (const at of MARKS) timers.push(setTimeout(() => setT(at), at));
      timers.push(setTimeout(run, T.cycle));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [active, still]);
  return t;
}

export function SoloTeamShowcase({
  regions,
  active,
  still,
  avatarSrc,
  teamSrcs,
}: GlassCardContext & {
  /** The centre person's photo. A bundled/inlined URL from the mount (shared
   *  files cannot import images); absent → a drawn placeholder. */
  avatarSrc?: string;
  /** Phase B's two other people, same rules as `avatarSrc`. */
  teamSrcs?: (string | undefined)[];
}) {
  const clock = useCycleClock(active, still);
  // `still` pins every beat past its mark: the finished team frame.
  const at = (ms: number) => still || clock >= ms;
  const team = still || at(T.bIn);
  const solo = !still && !at(T.aOut);
  const fading = !still && at(T.end);
  const stage: WebStage = {
    you: at(T.aYou),
    lines1: at(T.aLines1),
    agents1: at(T.aAgents1),
    lines2: at(T.aLines2),
    agents2: at(T.aAgents2),
    webOut: at(T.aOut),
    team: at(T.bTeam),
    teamLines: at(T.bLines),
    teamAgents: at(T.bAgents),
    reset: !still && clock < T.aYou,
    still,
  };

  const { main, side } = regions;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        opacity: fading ? 0 : 1,
        transition: "opacity 500ms ease",
      }}
    >
      {/* LEFT — the web, laid out from the region's own size. */}
      <AgentWeb rect={main} stage={stage} avatarSrc={avatarSrc} teamSrcs={teamSrcs} />

      {/* RIGHT — the line, under the bite. */}
      {side && <Line rect={side} solo={solo} team={team && !solo} still={still} />}
    </div>
  );
}

/**
 * The sentence, in the wordmark's italic serif (`BrandLockup`) rather than the
 * form's sans: the card speaks in the brand's voice, the form in the UI's.
 * Sized off the region's width so three lines fit from 1280 to 1920.
 * "solo" wears the mark's pink, "entire team" its blue (`DOPL_PINK` /
 * `DOPL_BLUE`).
 */
function Line({
  rect,
  solo,
  team,
  still,
}: {
  rect: { x: number; y: number; w: number; h: number };
  solo: boolean;
  team: boolean;
  still: boolean;
}) {
  const padX = 16;
  const fs = Math.min(22, Math.max(14, (rect.w - padX) / 10)) * (still ? 0.86 : 1);
  const text = {
    position: "absolute",
    // Centred between the card's top edge and the TOP of the beat ticks
    // (they sit `TICKS_BOTTOM` up, `TICK_H` tall), not the card's bottom.
    inset: still ? 0 : `0 0 ${TICKS_BOTTOM + TICK_H}px 0`,
    display: "flex",
    alignItems: "center",
    margin: 0,
    fontFamily: "var(--font-playfair), Georgia, serif",
    fontStyle: "italic",
    fontSize: fs,
    lineHeight: 1.22,
    letterSpacing: "-0.01em",
    color: "#181818",
    transition: "opacity 420ms ease, transform 420ms ease",
  } as const;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x + padX,
        top: rect.y,
        width: Math.max(0, rect.w - padX - 6),
        height: rect.h,
      }}
    >
      {still ? (
        <p style={text}>
          <span>
            Dopl works whether you&apos;re flying <Pink>solo</Pink> or building with your{" "}
            <Blue>entire team</Blue>.
          </span>
        </p>
      ) : (
        <>
          <p style={{ ...text, opacity: solo ? 1 : 0, transform: solo ? "none" : "translateY(-4px)" }}>
            <span>
              Dopl works whether you&apos;re flying <Pink>solo</Pink>…
            </span>
          </p>
          <p style={{ ...text, opacity: team ? 1 : 0, transform: team ? "none" : "translateY(4px)" }}>
            <span>
              …or building with
              <br />
              your <Blue>entire team</Blue>.
            </span>
          </p>
          {/* Two ticks: which beat this is. Centred on the REGION (this box
              starts `padX` in), and lifted off the card's bottom edge. */}
          <span
            style={{
              position: "absolute",
              left: rect.w / 2 - padX,
              bottom: TICKS_BOTTOM,
              transform: "translateX(-50%)",
              display: "flex",
              gap: 4,
            }}
          >
            <Tick on={solo} />
            <Tick on={team} />
          </span>
        </>
      )}
    </div>
  );
}

/** Beat ticks: gap off the card's bottom edge, and their height. */
export const TICKS_BOTTOM = 14;
export const TICK_H = 3;

/** The mark's two colours, sampled from `dopl-mark.png` (most saturated pixel
 *  of each hue: #FEBCD9 / #B8DBF7), then 7 points of lightness darker so the
 *  words read on white (Samuel 2026-10-13). */
const DOPL_PINK = "#FD99C5";
const DOPL_BLUE = "#98CBF3";

export function Pink({ children }: { children: ReactNode }) {
  return <span style={{ color: DOPL_PINK }}>{children}</span>;
}

export function Blue({ children }: { children: ReactNode }) {
  return <span style={{ color: DOPL_BLUE }}>{children}</span>;
}

export function Tick({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: on ? 14 : 5,
        height: TICK_H,
        borderRadius: 999,
        background: on ? "#181818" : "#D6D6DA",
        transition: "width 420ms ease, background 420ms ease",
      }}
    />
  );
}
