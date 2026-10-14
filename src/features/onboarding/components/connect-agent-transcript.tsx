"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { words, type ChatFrame, type ScriptMsg } from "./connect-agent-script";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 2's chat mimicry — pure presentation of one `ChatFrame`. The script and
 * its timing are `./connect-agent-script.ts`; the clock is
 * `./connect-agent-showcase.tsx`.
 *
 * Codex-transcript look (Samuel's reference, 2026-10-13): user lines are
 * right-aligned grey bubbles; the agent speaks in plain left-aligned text;
 * each Dopl call is a quiet row — the Dopl mark in a small rounded square and
 * a muted label — that shimmers while it runs, then settles.
 *
 * The transcript is BOTTOM-anchored: when it outgrows its box the whole column
 * slides up and the oldest lines fade under a top mask, the way a live chat
 * scrolls. Hexes are fine here: auth + onboarding are the design system's
 * standing exemption (docs/DESIGN-SYSTEM.md).
 */

const INK = "#1C1C1F";
const MUTED = "#8C8C92";
const FAINT = "#B6B6BB";
const BUBBLE = "#EFEFF2";

/** Keyframes the transcript animates with. Rendered once, by the showcase,
 *  in a `<style>` — inline styles cannot declare keyframes. */
export const TRANSCRIPT_KEYFRAMES = `
@keyframes dopl-chat-word { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@keyframes dopl-chat-row { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes dopl-chat-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes dopl-chat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
`;

export function ChatTranscript({
  rect,
  msgs,
  frame,
  fs,
  doplSrc,
  still,
}: {
  /** The chat's box, in the glass box's px. */
  rect: CardRect;
  msgs: ScriptMsg[];
  frame: ChatFrame;
  /** Body type size, px — sized off the card by the showcase. */
  fs: number;
  doplSrc?: string;
  still: boolean;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const empty = frame.count === 0;

  // Bottom-anchor by translating the column, written straight to the DOM:
  // a state round-trip would paint one frame un-scrolled every word.
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const over = Math.max(0, i.offsetHeight - o.clientHeight);
    i.style.transition = empty || still ? "none" : "transform 340ms cubic-bezier(0.2, 0.7, 0.2, 1)";
    i.style.transform = `translateY(${-over}px)`;
  }, [frame, empty, still, rect.w, rect.h, fs]);

  const fade = Math.round(fs * 2.2);
  // ONE gap between every pair of items — bubbles, agent text and tool rows
  // alike. Stacked tool rows had a tighter one and read as jammed (Samuel
  // 2026-10-13).
  const gap = Math.round(fs * 0.8);
  return (
    <div
      ref={outer}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        overflow: "hidden",
        maskImage: `linear-gradient(to bottom, transparent 0, #000 ${fade}px)`,
        WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${fade}px)`,
        opacity: frame.clearing ? 0 : 1,
        transition: empty ? "none" : "opacity 380ms ease",
      }}
    >
      <div
        ref={inner}
        style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", flexDirection: "column" }}
      >
        {/* Spacer: lets the first lines start low rather than hugging the
            mask, then scroll away like everything else. */}
        <div style={{ height: fade }} />
        {msgs.slice(0, frame.count).map((msg, i) => {
          const last = i === frame.count - 1;
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : gap, display: "flex" }}>
              {msg.kind === "tool" ? (
                <ToolRow msg={msg} running={last && frame.words === 0} fs={fs} doplSrc={doplSrc} still={still} />
              ) : (
                <Words
                  msg={msg}
                  shown={last ? frame.words : words(msg.text).length}
                  fs={fs}
                  still={still}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A user bubble or an agent line, typed out word by word. */
function Words({
  msg,
  shown,
  fs,
  still,
}: {
  msg: Extract<ScriptMsg, { kind: "user" | "agent" }>;
  shown: number;
  fs: number;
  still: boolean;
}) {
  const all = words(msg.text);
  const user = msg.kind === "user";
  const style: CSSProperties = user
    ? {
        marginLeft: "auto",
        maxWidth: "86%",
        background: BUBBLE,
        color: INK,
        borderRadius: fs * 1.05,
        padding: `${fs * 0.36}px ${fs * 0.8}px`,
      }
    : { color: INK, maxWidth: "100%" };
  return (
    <p style={{ ...style, margin: user ? "0 0 0 auto" : 0, fontSize: fs, lineHeight: 1.38 }}>
      {all.slice(0, shown).map((w, k) => (
        <span key={k}>
          {k > 0 ? " " : ""}
          <span
            style={{
              display: "inline-block",
              animation: still ? undefined : "dopl-chat-word 220ms ease-out both",
            }}
          >
            {w}
          </span>
        </span>
      ))}
    </p>
  );
}

/** One Dopl call: mark tile + label (+ its argument, lighter). */
function ToolRow({
  msg,
  running,
  fs,
  doplSrc,
  still,
}: {
  msg: Extract<ScriptMsg, { kind: "tool" }>;
  running: boolean;
  fs: number;
  doplSrc?: string;
  still: boolean;
}) {
  const icon = Math.round(fs * 1.4);
  const live = running && !still;
  const label: CSSProperties = live
    ? {
        color: "transparent",
        backgroundImage: `linear-gradient(90deg, ${MUTED} 0%, ${MUTED} 35%, #DADADF 50%, ${MUTED} 65%, ${MUTED} 100%)`,
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        animation: "dopl-chat-shimmer 1.1s linear infinite",
      }
    : { color: MUTED, transition: "color 300ms ease" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: fs * 0.55,
        minWidth: 0,
        maxWidth: "100%",
        fontSize: fs * 0.94,
        lineHeight: 1.3,
        animation: still ? undefined : "dopl-chat-row 260ms ease-out both",
      }}
    >
      <span
        style={{
          flex: "none",
          width: icon,
          height: icon,
          borderRadius: icon * 0.28,
          overflow: "hidden",
          background: "#111",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.12)",
          animation: live ? "dopl-chat-pulse 1.1s ease-in-out infinite" : undefined,
        }}
      >
        {doplSrc && (
          // next/image forbidden — this file also renders in the Vite SPA.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doplSrc} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />
        )}
      </span>
      <span style={{ ...label, flex: "none", whiteSpace: "nowrap" }}>{msg.label}</span>
      <span
        style={{
          color: FAINT,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {msg.arg}
      </span>
    </div>
  );
}
