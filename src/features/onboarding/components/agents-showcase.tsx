"use client";

import { useEffect, useState } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import {
  SCRIPT,
  agentsFinalFrame,
  buildAgentsTimeline,
  type AgentsFrame,
} from "./agents-chat-script";
import { AGENTS_KEYFRAMES, AgentsTranscript, type CastImages } from "./agents-chat-transcript";
import { Blue, Pink } from "./solo-team-showcase";

/**
 * Step 3's glass card ("Bring Your Agent", the vertical pose — Samuel
 * 2026-10-13). The strip beside the top-left bite carries the step's line; the
 * big region under it holds the Dopl tile at its top-left and, under that, a
 * channel chat (Samuel 2026-10-13, "Handle my inbox before vacation"): an
 * Orchestrator launches three agents, briefs them, they work and report back.
 * Script `./agents-chat-script.ts`, rows `./agents-chat-transcript.tsx`.
 *
 * Mounted through `AuthSplitLayout` › glassCardContent like steps 1–2, so it
 * fades with the card: the clock freezes when `active` drops and restarts from
 * frame zero when it returns. `still` (reduced motion) is the finished story.
 * Hexes are fine here: auth + onboarding are the design system's standing
 * exemption (docs/DESIGN-SYSTEM.md).
 */

/** Set line by line, as Samuel wrote it; "Launch" in the mark's pink,
 *  "orchestrate" in its blue (`./solo-team-showcase.tsx` › Pink / Blue). */
const LINE = (
  <>
    <Pink>Launch</Pink> and
    <br />
    <Blue>orchestrate</Blue>
    <br />
    your agents
    <br />
    inside Dopl.
  </>
);

const TIMELINE = buildAgentsTimeline();
const STILL = agentsFinalFrame();

/** Walks the timeline one frame at a time — `./connect-agent-showcase.tsx`'s clock. */
function useAgentsClock(active: boolean, still: boolean): AgentsFrame {
  const [frame, setFrame] = useState<AgentsFrame>(TIMELINE.frames[0]);
  useEffect(() => {
    if (!active || still) return;
    const { frames, cycle } = TIMELINE;
    let timer: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      setFrame(frames[i]);
      const next = i + 1;
      timer =
        next < frames.length
          ? setTimeout(() => step(next), frames[next].at - frames[i].at)
          : setTimeout(() => step(0), cycle - frames[i].at);
    };
    timer = setTimeout(() => step(0), 0);
    return () => clearTimeout(timer);
  }, [active, still]);
  return still ? STILL : frame;
}

export function AgentsShowcase({
  regions,
  active,
  still,
  mark,
  images,
}: GlassCardContext & {
  mark?: string;
  /** Avatars: the user's photo and the agents' logos. Bundled URLs from the
   *  mount — shared files cannot import images. */
  images?: CastImages;
}) {
  const frame = useAgentsClock(active, still);
  const { main, side } = regions;
  // Same tile and inset as step 2's (`./connect-agent-showcase.tsx` › LogoTile).
  const fs = Math.min(13, Math.max(11, main.w / 27));
  const pad = Math.round(fs * 1.15);
  const tile = 32;
  // Chat type: the landing's micro/body scale, shrunk to the card (10–12px).
  const chatFs = Math.min(12, Math.max(10, main.w / 26));
  const chatTop = main.y + pad + tile + Math.round(pad * 0.6);
  const chat = {
    x: main.x + pad,
    y: chatTop,
    w: Math.max(0, main.w - pad * 2),
    h: Math.max(0, main.y + main.h - pad * 0.7 - chatTop),
  };
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0 }}>
      <style>{AGENTS_KEYFRAMES}</style>
      {side && <StripLine rect={side} />}
      <AgentsTranscript rect={chat} frame={frame} fs={chatFs} images={images} still={still} script={SCRIPT} />
      <div
        style={{
          position: "absolute",
          left: main.x + pad,
          top: main.y + pad,
          width: tile,
          height: tile,
          borderRadius: 8,
          background: "var(--raised-light-face)",
          border: "1px solid var(--raised-light-line)",
          boxShadow:
            "var(--raised-light-bevel), 0 4px 7px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.08)",
          boxSizing: "border-box",
          display: "grid",
          placeItems: "center",
        }}
      >
        {mark && (
          // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
          <img
            src={mark}
            alt=""
            draggable={false}
            style={{ width: Math.round(tile * 0.58), height: Math.round(tile * 0.58), borderRadius: 4 }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The line, in step 1's voice: the wordmark's italic serif, four set lines.
 * Sized off the strip's WIDTH: the block is `BLOCK_W` font sizes wide and
 * `BLOCK_H` tall (Charter italic at this tracking and leading, measured
 * 2026-10-13), so a font of (width − 2·gap) / BLOCK_W leaves `gap` left and
 * right (more, equally, once capped) — and, because the geometry makes this strip SQUARE
 * (`auth-glass-geometry.ts › poseDepths`), the same gap above and below. The
 * block is centred both ways; its lines stay left-aligned inside it.
 */
const BLOCK_W = 4.86;
const BLOCK_H = 4.88;
const GAP = 0.12;

function StripLine({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  const gap = rect.w * GAP;
  // Capped at step 1's 22px so the two strips speak at one size; past the cap
  // the gaps simply grow — still equal all round, the strip and block being
  // square.
  const fs = Math.max(10, Math.min(22, (rect.w - gap * 2) / BLOCK_W, (rect.h - gap * 2) / BLOCK_H));
  return (
    <p
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: 0,
        fontFamily: "var(--font-playfair), Georgia, serif",
        fontStyle: "italic",
        fontSize: fs,
        lineHeight: 1.22,
        letterSpacing: "-0.01em",
        color: "#181818",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-block" }}>{LINE}</span>
    </p>
  );
}
