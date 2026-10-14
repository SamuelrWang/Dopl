"use client";

import type { CSSProperties, ReactNode } from "react";
import { Profile } from "./web-pieces";

/**
 * A PERSON PAIRED WITH AN AGENT, and the raised faces it is built from —
 * shared by the login journey (`./login-journey-showcase.tsx`) and step 4's
 * identity cards (`./identities-mini-showcase.tsx`), so the two cannot drift
 * (Samuel 2026-10-13: "the same icons we have on the login").
 *
 * The person's photo in a circle ringed in the agent's colour, with the
 * agent's logo inset bottom-right, half overlapping, ringed the same. Hexes
 * are fine here: auth + onboarding are the design system's standing exemption.
 */

const RAISED_SHADOW =
  "var(--raised-light-bevel), 0 4px 7px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.08)";
export const agentColor = (n: number) => `var(--agent-color-${String(n).padStart(2, "0")})`;

export function PairedAvatar({
  d,
  photo,
  agentLogo,
  color,
}: {
  /** The person circle's diameter; the badge is half of it. */
  d: number;
  photo?: string;
  agentLogo?: string;
  /** Agent colour-bank slot, 1–16, for both rings. */
  color: number;
}) {
  const ring = agentColor(color);
  const b = d * 0.5;
  return (
    <div style={{ position: "relative", width: d, height: d, flex: "none" }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${ring}` }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <Profile src={photo} d={d - 4} />
        </div>
      </div>
      <Face d={b} round ring={ring} style={{ position: "absolute", width: b, height: b, right: -b * 0.3, bottom: -b * 0.3 }}>
        <Img src={agentLogo} px={b * 0.58} />
      </Face>
    </div>
  );
}

/** The raised light face — a circle, or the app tile's rounded square (28%
 *  radius). A `ring` swaps the hairline for a colour. */
export function Face({
  d,
  round,
  ring,
  style,
  children,
}: {
  d: number;
  round: boolean;
  ring?: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        ...style,
        borderRadius: round ? "50%" : d * 0.28,
        background: "var(--raised-light-face)",
        border: ring ? `2px solid ${ring}` : "1px solid var(--raised-light-line)",
        boxShadow: RAISED_SHADOW,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
      }}
    >
      {children}
    </div>
  );
}

export function Img({ src, px, radius = 0 }: { src?: string; px: number; radius?: number }) {
  if (!src) return <span style={{ width: px * 0.6, height: px * 0.6, borderRadius: 4, background: "#E4E4E8" }} />;
  return (
    // next/image forbidden — this file also renders in the Vite SPA.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      style={{ width: px, height: px, objectFit: "contain", display: "block", borderRadius: radius }}
    />
  );
}
