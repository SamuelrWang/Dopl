"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { GlassCardContent, GlassCardContext } from "@/shared/layout/auth-split";
import { Blue, Pink } from "./solo-team-showcase";
import { INK, LINE_MS, Pop, Profile, makeEase } from "./web-pieces";
import { Face, Img, PairedAvatar } from "./paired-avatar";
import { NODES, WAVES, routePath, type JNode, type LoginJourneyImages, type Pt } from "./login-journey-layout";

export type { LoginJourneyImages } from "./login-journey-layout";

/**
 * The login card (Samuel 2026-10-13): "Welcome to Dopl, a new interface / for
 * human-agent interactions." set top-centre in the strips' italic serif, and
 * around it a journey that runs a U — up the left beside the title, along the
 * bottom, up the right beside the title — lines growing node to node along
 * circuit-board routes (`./login-journey-layout.ts` holds the map and the
 * routing). Every node is ONE size: people (and people paired with an agent)
 * are circles; software is a rounded-square app tile.
 *
 * A person paired with an agent is their photo ringed in the agent's colour
 * with the agent's logo inset bottom-right, half overlapping, ringed the same.
 * Loops like step 1; the clock freezes while the card is hidden (`active`).
 * Reduced motion: the finished frame. Hexes are fine here: auth + onboarding
 * are the design system's standing exemption.
 */

/** The login card's `glassCardKey`: it shares pose `"default"` with step 4. */
export const LOGIN_CARD_KEY = "login";

/** The login card on the default pose — for every login surface that shows
 *  it (the desktop signed-out screen, onboarding preview's Login page). */
export function loginGlassCard(images: LoginJourneyImages): GlassCardContent {
  return { default: (ctx) => <LoginJourneyShowcase {...ctx} images={images} /> };
}

const FIRST = 250;
const STEP = 760;
const popAt = (wave: number) => FIRST + wave * STEP;
/** A node starts popping this long BEFORE its line lands, so a line never
 *  ends on an empty spot (Samuel's screenshot caught exactly that window). */
const POP_LEAD = 250;
const HOLD_END = popAt(WAVES - 1) + 4600;
const CYCLE = HOLD_END + 600;
/** Every mark the clock is set at: each wave's line start and pop, the fade. */
const MARKS = Array.from({ length: WAVES }, (_, w) => [popAt(w) - LINE_MS, popAt(w) - POP_LEAD])
  .flat()
  .filter((t) => t > 0)
  .concat(HOLD_END);

function useJourneyClock(active: boolean, still: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active || still) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers.push(setTimeout(() => setT(0), 0));
      for (const at of MARKS) timers.push(setTimeout(() => setT(at), at));
      timers.push(setTimeout(run, CYCLE));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [active, still]);
  return t;
}

/** App tile size relative to a circle — the optical match. */
const TILE_K = 0.9;

const SERIF: CSSProperties = {
  fontFamily: "var(--font-playfair), Georgia, serif",
  fontStyle: "italic",
  lineHeight: 1.22,
  letterSpacing: "-0.01em",
  color: INK,
  margin: 0,
  textAlign: "center",
};

export function LoginJourneyShowcase({
  regions,
  active,
  still,
  images = {},
}: GlassCardContext & { images?: LoginJourneyImages }) {
  const clock = useJourneyClock(active, still);
  const at = (ms: number) => still || clock >= ms;
  const ease = makeEase(!still && clock >= FIRST - 1);
  const fading = !still && clock >= HOLD_END;
  const { main } = regions;

  const fs = Math.min(24, Math.max(15, main.w / 28));
  const pad = 14;
  const box = { x: main.x + pad, y: main.y + pad, w: Math.max(0, main.w - pad * 2), h: Math.max(0, main.h - pad * 2) };
  const titleTop = 4;
  const titleH = fs * 1.22 * 2;

  // The title's real width, so the side zones hug its actual edges.
  const titleRef = useRef<HTMLSpanElement>(null);
  const [titleW, setTitleW] = useState(fs * 14.6);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const read = () => setTitleW(el.offsetWidth || fs * 14.6);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fs]);
  const titleL = (box.w - titleW) / 2;
  const titleR = titleL + titleW;
  const sideW = Math.max(0, titleL);

  // ONE size for every node. Bounded by: the width (~9 across), the height
  // (the under-title row and the bottom row must clear each other), and the
  // side zones (two nodes abreast plus half a node of clearance).
  const hangK = 0.15; // a badge hangs ~0.15·D past the bottom-right
  const freeH = (D: number) => box.h - D - D * hangK;
  const D = Math.round(
    Math.min(
      52,
      box.w / 9,
      // Two nodes side by side in a zone, half a node clear of the title.
      sideW / 2.9,
      // BOT − MID of the free height must clear a node + 8px.
      ((1 - 0.55) * (box.h - 8)) / (1 + 0.45 * (1 + hangK)),
    ),
  );
  const hang = D * hangK;
  const bend = D * 0.85;
  const place = (n: JNode): Pt => {
    const y = D / 2 + n.v * freeH(D) + (n.underMid ? bend : 0);
    // In the title's band: centred a node-and-a-half off the title's edge.
    if (n.zone === "left") return { x: titleL - D, y };
    if (n.zone === "right") return { x: titleR + D, y };
    return { x: D / 2 + n.u * (box.w - D - hang), y };
  };
  const byId = new Map(NODES.map((n) => [n.id, n]));

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}>
        <p style={{ ...SERIF, position: "absolute", left: 0, top: titleTop, width: box.w, fontSize: fs, height: titleH }}>
          <span ref={titleRef} style={{ display: "inline-block" }}>
            Welcome to Dopl, a new <Pink>interface</Pink>
            <br />
            for human-agent <Blue>interactions</Blue>.
          </span>
        </p>

        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: fading ? 0 : 1,
            transition: still ? undefined : "opacity 500ms ease",
          }}
        >
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            {NODES.filter((n) => n.from).map((n) => (
              <Trace
                key={n.id}
                d={routePath(place(byId.get(n.from ?? "") ?? n), place(n), n.route ?? "line", D / 3, bend)}
                on={at(popAt(n.wave) - LINE_MS)}
                ease={ease}
              />
            ))}
          </svg>
          {NODES.map((n) => {
            // A square reads bigger than a circle of the same width, so app
            // tiles are a smidge smaller (Samuel 2026-10-13), same centre.
            const d = n.kind === "app" ? Math.round(D * TILE_K) : D;
            return (
              <Pop key={n.id} p={place(n)} d={d} on={at(popAt(n.wave) - POP_LEAD)} delay={0} ease={ease}>
                <Node node={n} d={d} images={images} />
              </Pop>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A routed black line that GROWS along its path when `on` turns true. */
function Trace({ d, on, ease }: { d: string; on: boolean; ease: ReturnType<typeof makeEase> }) {
  return (
    <path
      d={d}
      pathLength={1}
      fill="none"
      stroke={INK}
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1 1"
      strokeDashoffset={on ? 0 : 1}
      style={{ transition: ease(LINE_MS, 0, ["stroke-dashoffset"]) }}
    />
  );
}

function Node({ node, d, images }: { node: JNode; d: number; images: LoginJourneyImages }) {
  const src = node.img ? images[node.img] : undefined;
  if (node.kind === "app") {
    // The step-2 logo tile's raised white rounded square, the mark inside.
    // The Dopl mark is its own dark rounded square, so it sits inset like
    // every other logo rather than bleeding to the tile's edge.
    return (
      <Face d={d} round={false} style={{ position: "absolute", inset: 0 }}>
        {node.img === "dopl" ? (
          <Img src={src} px={d * 0.66} radius={d * 0.66 * 0.24} />
        ) : (
          <Img src={src} px={d * 0.56} />
        )}
      </Face>
    );
  }
  if (!node.badge) return <Profile src={src} d={d} />;
  return <PairedAvatar d={d} photo={src} agentLogo={images[node.badge]} color={node.color ?? 1} />;
}
