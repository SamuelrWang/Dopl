"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The shared pieces of step 1's two webs (`./agent-web.tsx` the solo tree,
 * `./team-web.tsx` the team's): the circles, the glyphs and the growing line.
 * Pure presentation. Agent rims are the launch dialog's colour bank
 * (`--agent-color-NN`, declared in both trees); the raised face reads the
 * `--raised-light-*` tokens. Hexes elsewhere are fine: auth + onboarding are
 * the design system's standing exemption (docs/DESIGN-SYSTEM.md).
 */

export const INK = "#181818";
/** ONE glyph size for every agent, whatever its circle's size. */
export const BOT_PX = 12;
/** Every agent circle, in both phases (Samuel 2026-10-13: one size). */
export const AGENT_PX = 26;
export const LINE_MS = 600;
export const NODE_MS = 380;

/** The raised-light bevel with a fuller drop under it — the light raised
 *  button's lifted state (`.auth-btn-3d-light:hover`), so each circle sits
 *  visibly above the card. */
const CIRCLE_SHADOW =
  "var(--raised-light-bevel), 0 4px 7px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.08)";

const agentColor = (n: number) =>
  `var(--agent-color-${String(n).padStart(2, "0")})`;

/** A transition string, or `none` when motion is off (reduced motion, or the
 *  cycle's reset frame, which must snap rather than visibly retract). */
export type Ease = (ms: number, delay: number, props: string[]) => string;
export const makeEase =
  (animate: boolean): Ease =>
  (ms, delay, props) =>
    animate
      ? props.map((p) => `${p} ${ms}ms ease ${delay}ms`).join(", ")
      : "none";

/** Region-relative px of a unit point, with the web's padding. */
export function webFrame(rect: { w: number; h: number }) {
  const s = Math.min(
    1.45,
    Math.max(0.85, Math.min(rect.w / 273, rect.h / 171)),
  );
  const padX = 18 * s;
  const padY = 16 * s;
  const iw = Math.max(0, rect.w - padX * 2);
  const ih = Math.max(0, rect.h - padY * 2);
  return {
    s,
    place: (u: number, v: number) => ({ x: padX + u * iw, y: padY + v * ih }),
  };
}

/** A straight black line that GROWS from `a` to `b` when `on` turns true. */
export function WebLine({
  a,
  b,
  on,
  delay,
  ease,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  on: boolean;
  delay: number;
  ease: Ease;
}) {
  return (
    <path
      d={`M${a.x},${a.y} L${b.x},${b.y}`}
      pathLength={1}
      fill="none"
      stroke={INK}
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeDasharray="1 1"
      strokeDashoffset={on ? 0 : 1}
      style={{ transition: ease(LINE_MS, delay, ["stroke-dashoffset"]) }}
    />
  );
}

/** A circle centred on `p` that pops (scale + fade) in when `on`. */
export function Pop({
  p,
  d,
  on,
  delay,
  ease,
  ms = NODE_MS,
  from = 0.4,
  children,
}: {
  p: { x: number; y: number };
  d: number;
  on: boolean;
  delay: number;
  ease: Ease;
  ms?: number;
  from?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: p.x,
        top: p.y,
        width: d,
        height: d,
        transform: `translate(-50%, -50%) scale(${on ? 1 : from})`,
        opacity: on ? 1 : 0,
        transition: ease(ms, delay, ["transform", "opacity"]),
      }}
    >
      {children}
    </div>
  );
}

/** An agent: the raised white circle, its colour as the rim, the bot glyph. */
export function AgentCircle({
  color,
  d,
  bot,
}: {
  color: number;
  d: number;
  bot: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        background: "var(--raised-light-face)",
        border: `${Math.max(1.5, d * 0.08)}px solid ${agentColor(color)}`,
        boxShadow: CIRCLE_SHADOW,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <BotGlyph size={bot} />
    </div>
  );
}

/** A person: the raised white circle with a photo in it, or a drawn
 *  placeholder when the mount passed none. */
export function Profile({ src, d }: { src?: string; d: number }) {
  const inner: CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "50%",
        background: "var(--raised-light-face)",
        // Hairline and white border scale with the circle (login: 48px inner
        // circle → 1px + 3.84px); no px floor, so small avatars keep the same
        // share of photo instead of a thick fixed frame (paired-avatar.tsx).
        border: `${Math.min(1, d / 48)}px solid var(--raised-light-line)`,
        boxShadow: CIRCLE_SHADOW,
        padding: d * 0.08,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
        <img
          src={src}
          alt=""
          draggable={false}
          style={{ ...inner, objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            ...inner,
            background: "linear-gradient(135deg, #FEBCD9, #B8DBF7)",
          }}
        >
          <PersonGlyph size={d * 0.62} />
        </div>
      )}
    </div>
  );
}

function BotGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5V7" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <circle cx="12" cy="3" r="1.6" fill={INK} />
      <rect
        x="4"
        y="7"
        width="16"
        height="12.5"
        rx="4"
        stroke={INK}
        strokeWidth={2}
      />
      <circle cx="9" cy="13.2" r="1.7" fill={INK} />
      <circle cx="15" cy="13.2" r="1.7" fill={INK} />
      <path
        d="M1.8 12v3M22.2 12v3"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PersonGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="9" r="4.2" fill="#fff" fillOpacity={0.95} />
      <path
        d="M3.5 22c.9-4.6 4.3-7.2 8.5-7.2s7.6 2.6 8.5 7.2z"
        fill="#fff"
        fillOpacity={0.95}
      />
    </svg>
  );
}
