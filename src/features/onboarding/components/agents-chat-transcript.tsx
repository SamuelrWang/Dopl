"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import {
  CAST,
  tokens,
  type AgentsFrame,
  type CastFace,
  type CastId,
  type ChatItem,
} from "./agents-chat-script";
import {
  CHAT_REVEAL_KEYFRAMES,
  CHAT_ROW_ANIMATION,
  CHAT_WORD_ANIMATION,
} from "@/shared/ui/chat-reveal";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 3's channel chat — pure presentation of one `AgentsFrame`. The script
 * and timing are `./agents-chat-script.ts`; the clock is `./agents-showcase.tsx`.
 *
 * ⚠ A SCALED REDRAW OF THE LANDING CHANNEL DEMO'S ROWS, not a mount of them.
 * The landing mounts the real `channels/components/transcript.tsx`, whose rows
 * need the whole channel view-model and are sized for a pane; this card is
 * ~250px wide. So the LOOK is copied, piece by piece, from the files that own it:
 *   - authored row: `authored-row.tsx` — 3px agent-colour bar on the outer
 *     side, the header pill framed in that colour, body under it; the user's
 *     own row mirrored to the right with a plain bento pill.
 *   - header pill: `attribution-pill.tsx` — avatar, bold name, the coloured
 *     "agent" chip (`AgentChip`).
 *   - launch line: `transcript.tsx`'s system row — one centred muted line.
 *   - @-mention: `message-markdown-mentions.tsx` — medium weight, `--link`.
 *   - working pills: `agent-activity.tsx › AgentActivityRows` — agent-colour
 *     fill, white name, the `.working-dots` ellipsis (a kit class in both trees).
 * Colours are the agent bank's tokens (`--agent-color-NN`); hexes elsewhere
 * are fine: auth + onboarding are the design system's standing exemption.
 */

const INK = "#1C1C1F";
const MUTED = "#8C8C92";
const color = (n: number) => `var(--agent-color-${String(n).padStart(2, "0")})`;
const BENTO = "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)";

export type CastImages = Partial<Record<CastFace, string>>;

/** The reveal now lives in `@/shared/ui/chat-reveal` (also used by the landing demo). */
export const AGENTS_KEYFRAMES = CHAT_REVEAL_KEYFRAMES;

export function AgentsTranscript({
  rect,
  frame,
  fs,
  images,
  still,
  script,
}: {
  rect: CardRect;
  frame: AgentsFrame;
  fs: number;
  images?: CastImages;
  still: boolean;
  script: ChatItem[];
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const empty = frame.count === 0;
  const stripH = Math.round(fs * 2.2);
  const gap = Math.round(fs * 1.15);

  // Bottom-anchor by translating the column (same as step 2's transcript).
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const over = Math.max(0, i.offsetHeight - o.clientHeight);
    i.style.transition = empty || still ? "none" : "transform 380ms cubic-bezier(0.2, 0.7, 0.2, 1)";
    i.style.transform = `translateY(${-over}px)`;
  }, [frame, empty, still, rect.w, rect.h, fs]);

  const fade = Math.round(fs * 2.4);
  const rows = script.slice(0, frame.count).flatMap((item, i) => {
    if (item.kind === "work") return [];
    const last = i === frame.count - 1;
    return [{ item, i, shown: last ? frame.words : Number.MAX_SAFE_INTEGER }];
  });

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        opacity: frame.clearing ? 0 : 1,
        transition: empty ? "none" : "opacity 420ms ease",
      }}
    >
      <div
        ref={outer}
        style={{
          position: "absolute",
          inset: `0 0 ${stripH}px 0`,
          overflow: "hidden",
          maskImage: `linear-gradient(to bottom, transparent 0, #000 ${fade}px)`,
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${fade}px)`,
        }}
      >
        <div
          ref={inner}
          style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", flexDirection: "column", gap }}
        >
          <div style={{ height: fade - gap }} />
          {rows.map(({ item, i, shown }) =>
            item.kind === "system" ? (
              <p
                key={i}
                style={{
                  margin: 0,
                  textAlign: "center",
                  fontSize: fs * 0.86,
                  color: MUTED,
                  animation: still ? undefined : CHAT_ROW_ANIMATION,
                }}
              >
                {item.text}
              </p>
            ) : item.kind === "msg" ? (
              <MessageRow key={i} item={item} shown={shown} fs={fs} images={images} still={still} />
            ) : null
          )}
        </div>
      </div>
      <WorkingStrip working={frame.working} fs={fs} height={stripH} still={still} />
    </div>
  );
}

function Avatar({ face, size, images }: { face: CastFace; size: number; images?: CastImages }) {
  const src = images?.[face];
  const person = face === "you";
  return (
    <span
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        background: "#FFFFFF",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
        display: "grid",
        placeItems: "center",
      }}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
        <img
          src={src}
          alt=""
          draggable={false}
          style={
            person
              ? { width: "100%", height: "100%", objectFit: "cover", display: "block" }
              : { width: Math.round(size * 0.6), height: Math.round(size * 0.6), display: "block" }
          }
        />
      )}
    </span>
  );
}

/** `authored-row.tsx`'s shell at card scale: pill header over the body. */
function MessageRow({
  item,
  shown,
  fs,
  images,
  still,
}: {
  item: Extract<ChatItem, { kind: "msg" }>;
  shown: number;
  fs: number;
  images?: CastImages;
  still: boolean;
}) {
  const who = CAST[item.who];
  const mine = item.who === "you";
  const paint = who.color === null ? null : color(who.color);
  const bar = Math.max(2, Math.round(fs * 0.22));
  const pill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: fs * 0.45,
    maxWidth: "100%",
    padding: `${fs * 0.22}px ${fs * 0.9}px ${fs * 0.22}px ${fs * 0.22}px`,
    background: "#FFFFFF",
    boxShadow: BENTO,
    borderRadius: 999,
  };
  const header = (
    <span
      style={
        paint
          ? { ...pill, border: `${bar}px solid ${paint}`, borderLeft: 0, borderRadius: "0 999px 999px 0", marginLeft: -fs * 0.6 }
          : pill
      }
    >
      <Avatar face={who.face} size={Math.round(fs * 1.55)} images={images} />
      <span style={{ fontSize: fs, fontWeight: 600, color: INK, whiteSpace: "nowrap" }}>{who.name}</span>
      {paint && (
        <span
          style={{
            background: paint,
            color: "#FFFFFF",
            fontSize: fs * 0.78,
            lineHeight: 1,
            padding: `${fs * 0.18}px ${fs * 0.45}px`,
            borderRadius: 999,
          }}
        >
          agent
        </span>
      )}
    </span>
  );
  const body = (
    <p style={{ margin: 0, fontSize: fs, lineHeight: 1.42, color: INK, textAlign: mine ? "right" : "left" }}>
      <Typed parts={item.parts} shown={shown} still={still} />
    </p>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: mine ? "row-reverse" : "row",
        alignItems: "stretch",
        animation: still ? undefined : CHAT_ROW_ANIMATION,
      }}
    >
      {paint && <span style={{ width: bar, flex: "none", background: paint, borderRadius: "0 0 999px 999px" }} />}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: mine ? "flex-end" : "flex-start",
          gap: fs * 0.45,
          minWidth: 0,
          flex: 1,
          paddingLeft: paint ? fs * 0.6 : 0,
        }}
      >
        {header}
        {body}
      </div>
    </div>
  );
}

/** Word-by-word reveal; @-mentions in the landing's link blue. */
function Typed({ parts, shown, still }: { parts: Parameters<typeof tokens>[0]; shown: number; still: boolean }) {
  const out: ReactNode[] = [];
  tokens(parts)
    .slice(0, shown)
    .forEach((t, k) => {
      if (k > 0) out.push(" ");
      out.push(
        <span
          key={k}
          style={{
            display: "inline-block",
            animation: still ? undefined : CHAT_WORD_ANIMATION,
            ...(t.mention ? { color: "var(--link)", fontWeight: 500 } : null),
          }}
        >
          {t.w}
        </span>
      );
    });
  return <>{out}</>;
}

/** `AgentActivityRows` at card scale: newest launch first, pill per agent. */
const STRIP_ORDER: CastId[] = ["cal", "reply", "inbox"];

function WorkingStrip({
  working,
  fs,
  height,
  still,
}: {
  working: CastId[];
  fs: number;
  height: number;
  still: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      {STRIP_ORDER.map((id) => {
        const on = working.includes(id);
        const who = CAST[id];
        return (
          <span
            key={id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              flex: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              background: who.color === null ? "#111" : color(who.color),
              color: "#FFFFFF",
              fontSize: fs * 0.82,
              fontWeight: 500,
              lineHeight: 1.45,
              borderRadius: Math.round(fs * 0.5),
              padding: on ? `1px ${fs * 0.6}px` : `1px 0`,
              marginRight: on ? fs * 0.45 : 0,
              maxWidth: on ? fs * 12 : 0,
              opacity: on ? 1 : 0,
              transition: still
                ? undefined
                : "max-width 360ms ease, opacity 260ms ease, padding 360ms ease, margin 360ms ease",
            }}
          >
            {who.name}
            <span aria-hidden className="working-dots" style={{ flex: "none" }}>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
