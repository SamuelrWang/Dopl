"use client";

import { useEffect, useState } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import {
  SEGMENTS,
  buildTimeline,
  finalFrame,
  type AgentLogo,
  type ChatFrame,
} from "./connect-agent-script";
import { ChatTranscript, TRANSCRIPT_KEYFRAMES } from "./connect-agent-transcript";
import { Blue, Pink, TICK_H, TICKS_BOTTOM, Tick } from "./solo-team-showcase";

/**
 * Step 2's glass card, filled (Samuel 2026-10-13): an agent's app icon at the
 * column's top-RIGHT (moved there 2026-10-13), and under it a live-looking chat in which that agent works
 * through Dopl tools. Claude plays two turns, the icon turns into Gemini, the
 * transcript clears, Gemini plays two turns with different tools, and it loops.
 *
 * Layout, on `"raised-bottom-notch"`'s L (`cardRegions`): `main` is the
 * full-height right column, `side` the top-left strip over the bite. The icon
 * and the chat both live in `main`, the icon top-right above the chat. No name or
 * status line (Samuel: icon only). `side` carries the step's line in step 1's
 * voice and two beat dots, Claude then Gemini (Samuel 2026-10-13).
 *
 * Mounted through `AuthSplitLayout` › glassCardContent, keyed to step 2's
 * pose, so it rides the card's own fade: the clock freezes when `active`
 * drops and restarts from frame zero each time it returns — same contract as
 * `./solo-team-showcase.tsx`. `still` (reduced motion) is segment 1's
 * finished frame.
 */

/** Bundled image URLs from the mount — shared files cannot import images. */
export interface ConnectAgentLogos {
  claude?: string;
  gemini?: string;
  /** The Dopl mark, for the tool rows. */
  dopl?: string;
  /** Step 3's channel chat avatars (it shares this bag). */
  chatgpt?: string;
  muse?: string;
  /** Step 3's "Sign in to Grok" mark (rides the same bag). */
  grok?: string;
}

const TIMELINE = buildTimeline();
const STILL = finalFrame(0);

/**
 * Walks the timeline one frame at a time (one timer live at once). Each frame
 * is a word or a tool state, so this re-renders ~110 times per ~35s cycle.
 */
function useChatClock(active: boolean, still: boolean): ChatFrame {
  const [frame, setFrame] = useState<ChatFrame>(TIMELINE.frames[0]);
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

export function ConnectAgentShowcase({
  regions,
  active,
  still,
  logos,
}: GlassCardContext & { logos?: ConnectAgentLogos }) {
  const frame = useChatClock(active, still);
  const segment = SEGMENTS[frame.seg];
  const { main, side } = regions;

  // Sized off the column, so the same layout holds from 1280 to 1920.
  const fs = Math.min(13, Math.max(11, main.w / 27));
  const pad = Math.round(fs * 1.15);
  // Same size as the corner lockup's Dopl mark (`BrandLockup`, h-8 w-8).
  const tile = 32;
  const tileTop = main.y + pad;
  const chatTop = tileTop + tile + Math.round(fs * 0.8);
  const chat = {
    x: main.x + pad,
    y: chatTop,
    w: Math.max(0, main.w - pad * 2),
    h: Math.max(0, main.y + main.h - pad * 0.7 - chatTop),
  };

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0 }}>
      <style>{TRANSCRIPT_KEYFRAMES}</style>

      {side && <StripCaption rect={side} beat={segment.logo} />}

      {/* Top-RIGHT of the column (Samuel 2026-10-13), above the chat. */}
      <LogoTile
        x={main.x + main.w - pad - tile}
        y={tileTop}
        size={tile}
        current={segment.logo}
        logos={logos}
        still={still}
      />

      <ChatTranscript
        rect={chat}
        msgs={segment.msgs}
        frame={frame}
        fs={fs}
        doplSrc={logos?.dopl}
        still={still}
      />
    </div>
  );
}

/**
 * The app-icon tile, as the light RAISED BUTTON (same recipe as the agent
 * web's circles, `./agent-web.tsx` › CIRCLE_SHADOW) with the corner mark's
 * 8px radius. Both logos are always mounted and crossfade with a small turn,
 * so the swap reads as the same tile changing face rather than a new one.
 */
function LogoTile({
  x,
  y,
  size,
  current,
  logos,
  still,
}: {
  x: number;
  y: number;
  size: number;
  current: AgentLogo;
  logos?: ConnectAgentLogos;
  still: boolean;
}) {
  const glyph = Math.round(size * 0.58);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: 8,
        background: "var(--raised-light-face)",
        border: "1px solid var(--raised-light-line)",
        boxShadow:
          "var(--raised-light-bevel), 0 4px 7px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.08)",
        boxSizing: "border-box",
      }}
    >
      {(["claude", "gemini"] as const).map((logo) => {
        const on = logo === current;
        const src = logos?.[logo];
        return (
          <div
            key={logo}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              opacity: on ? 1 : 0,
              transform: on ? "none" : "scale(0.6) rotate(-35deg)",
              transition: still ? undefined : "opacity 420ms ease, transform 520ms cubic-bezier(0.3, 1.4, 0.5, 1)",
            }}
          >
            {src ? (
              // next/image forbidden — this file also renders in the Vite SPA.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" draggable={false} style={{ width: glyph, height: glyph, display: "block" }} />
            ) : (
              <span style={{ fontSize: size * 0.42, fontWeight: 600, color: "#1C1C1F" }}>
                {logo === "claude" ? "C" : "G"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Two set lines; "Charge" in the mark's pink, "powerful tools" in its blue. */
const CAPTION = (
  <>
    <Pink>Charge</Pink> your agents
    <br />
    with <Blue>powerful tools</Blue>.
  </>
);

/**
 * The strip's line, typeset exactly like step 1's (`./solo-team-showcase.tsx`
 * › Line: the wordmark's italic serif, sized off the strip's width, centred
 * between the strip's top and the dots), plain ink. The two dots are step 1's
 * `Tick`s: Claude's segment, then Gemini's. Reduced motion keeps the dots —
 * the still frame is Claude's, and they say so.
 */
function StripCaption({
  rect,
  beat,
}: {
  rect: { x: number; y: number; w: number; h: number };
  beat: AgentLogo;
}) {
  const padX = 16;
  const fs = Math.min(22, Math.max(14, (rect.w - padX) / 10));
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <p
        style={{
          position: "absolute",
          left: padX,
          right: padX,
          top: 0,
          bottom: TICKS_BOTTOM + TICK_H,
          display: "flex",
          alignItems: "center",
          margin: 0,
          fontFamily: "var(--font-playfair), Georgia, serif",
          fontStyle: "italic",
          fontSize: fs,
          lineHeight: 1.22,
          letterSpacing: "-0.01em",
          color: "#181818",
        }}
      >
        <span>{CAPTION}</span>
      </p>
      <span
        style={{
          position: "absolute",
          left: rect.w / 2,
          bottom: TICKS_BOTTOM,
          transform: "translateX(-50%)",
          display: "flex",
          gap: 4,
        }}
      >
        <Tick on={beat === "claude"} />
        <Tick on={beat === "gemini"} />
      </span>
    </div>
  );
}
