"use client";

/**
 * Scripted product demo for the hero banner's slot (hero-banner.tsx). Decorative
 * and non-interactive — the slot keeps `pointer-events: none`.
 *
 * (2026-09-17) The scene is /home's CHANNEL RECORD. The tree is
 * `demo-scene.tsx`; this file owns the clock, the design box, the scripted cursor
 * and its ripple. The cursor presses the REAL buttons via programmatic `.click()`,
 * so every transition runs the product's own handlers and state.
 *
 * (2026-08-30) The canvas FILLS the slot edge to edge: CANVAS_W is fixed and the
 * scale is `slotWidth / CANVAS_W`, never a `min()` contain-fit, which is what left
 * white gutters. The height is derived from that scale, so the design box is
 * exactly the slot in design units. See `fit()`.
 *
 * CANVAS_W is the desktop window's width (1280) and that is what sets the scene's
 * scale — see `demo-steps.ts › CANVAS_W`. Nothing here shrinks a component.
 */

import { useEffect, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W, at, reached } from "./demo-steps";
import { CHANNEL_NAME, OPEN_THREAD } from "./demo-data";
import { DemoScene } from "./demo-scene";
import { DemoCursorGlyph } from "../demo-cursor";
import { useDemoTimeline } from "./use-demo-timeline";
import { typedMessageAt } from "./demo-transcript";
import { typedDmAt } from "./demo-narration";
import { useTypedWords } from "./typed-reveal";
import {
  CHAT_REVEAL_KEYFRAMES,
  CHAT_ROW_ANIMATION,
} from "@/shared/ui/chat-reveal";

/**
 * Rows that arrive whole (agents, system lines) fade and slide in, onboarding
 * step 3's row motion (`@/shared/ui/chat-reveal`). Plays on MOUNT, so a row
 * appears smoothly however the step got there; scrolling back unmounts it.
 * Human lines get it too (as in onboarding), then type word by word on top.
 */
const ROW_REVEAL_CSS = `${CHAT_REVEAL_KEYFRAMES}
@media (prefers-reduced-motion: no-preference) {
  .lp-demo-record [data-message-id] { animation: ${CHAT_ROW_ANIMATION}; }
}`;

type Cursor = { x: number; y: number; shown: boolean; instant: boolean };

/** First button under `root` whose visible label matches. */
function findButton(
  root: HTMLElement | null,
  match: (label: string) => boolean,
): HTMLButtonElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll("button")) {
    // A product card the demo re-faces is hidden (`demo-swap.ts`), so its buttons
    // have no box to glide to; the demo face's own button is the one to press.
    if (el.closest("[data-lp-swapped]")) continue;
    if (match((el.textContent ?? "").trim())) return el;
  }
  return null;
}

export function BannerDemo() {
  const { step, run, rootRef } = useDemoTimeline();
  const typedText = typedMessageAt(step)?.body ?? typedDmAt(step)?.text ?? null;
  const typedWords = useTypedWords(step, typedText);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** The record pane, and the cursor's search root — NOT the canvas. The /home
   *  header also carries a button labelled "Agents" (the surface selector), and
   *  `findButton` takes the first match in DOM order, so scoping the search to the
   *  pane is what keeps it off the header. */
  const paneRef = useRef<HTMLDivElement>(null);
  /** Design box + its scale, as one write: `w` is fixed, `h` is derived so the
   *  scaled canvas is EXACTLY the slot (see the file docblock). */
  const [box, setBox] = useState({ scale: 1, h: CANVAS_H });

  /**
   * Set by the REAL components' own callbacks when the cursor clicks them, then gated on
   * the step so a loop reset closes everything with no teardown effect.
   *
   * ⚠ **THE THREAD IS A `reached` WINDOW, NOT A LATCH** (v3). It opens on `click-thread`
   * and closes on `click-crumb`, which is what lets the channel animate again for step 8
   * while the agent view stays open. Deriving it from the step rather than storing a
   * boolean is what makes the loop reset free: at `step = 0` both reads are false.
   */
  const [agentClicked, setAgentClicked] = useState(false);
  const agentOpen = agentClicked && reached(step, "click-agent");
  const [threadClicked, setThreadClicked] = useState(false);
  const threadOpen =
    threadClicked && reached(step, "click-thread") && !reached(step, "click-crumb");

  const [cursor, setCursor] = useState<Cursor>({
    x: CANVAS_W + 40,
    y: 60,
    shown: false,
    instant: true,
  });
  const cursorPos = useRef(cursor);
  useEffect(() => {
    cursorPos.current = cursor;
  }, [cursor]);
  const [ripple, setRipple] = useState({ x: 0, y: 0, n: 0 });

  // Fill the slot, never contain-fit it. Width sets the scale; height follows in
  // design units, so `CANVAS_W × h` scaled by `scale` is the slot to the pixel on
  // both axes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      const r = root.getBoundingClientRect();
      // A slot with no box yet (first paint, a hidden tab) would divide by zero
      // and park the canvas at Infinity; keep the last good box instead.
      if (r.width <= 0 || r.height <= 0) return;
      const scale = r.width / CANVAS_W;
      setBox({ scale, h: r.height / scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef]);


  /* ── Cursor choreography — glide to and press the REAL controls ──── */

  useEffect(() => {
    const canvas = canvasRef.current;
    // Searched in the pane, measured against the canvas — see `paneRef`.
    const pane = paneRef.current;
    const target = (): HTMLElement | null => {
      // ⚠ EVERY ARM PRESSES A REAL CONTROL, found by its own visible label. Nothing here
      // is a demo-only hook, which is why the product's handlers run and the scene
      // reacts the way the app does.
      if (at(step, "cursor-to-thread") || at(step, "click-thread"))
        // The thread card's own button (`channels/components/thread-card-row.tsx`).
        return findButton(pane, (l) => l === "Open thread");
      if (at(step, "cursor-to-tab") || at(step, "click-tab"))
        // The count badge concatenates into textContent ("Agents3").
        return findButton(pane, (l) => l.startsWith("Agents"));
      if (at(step, "cursor-to-agent") || at(step, "click-agent"))
        // The demo's agent card face (`demo-agent-card.tsx`).
        return findButton(pane, (l) => l === "Open");
      if (at(step, "cursor-to-crumb") || at(step, "click-crumb"))
        // The breadcrumb's channel crumb, which is a button in thread view only
        // (`message-pane-header.tsx`). Its label IS the channel name.
        return findButton(pane, (l) => l === CHANNEL_NAME);
      return null;
    };
    const locate = (el: HTMLElement) => {
      if (!canvas) return null;
      const cr = canvas.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const s = cr.width / CANVAS_W;
      return {
        x: (er.left - cr.left + er.width * 0.55) / s,
        y: (er.top - cr.top + er.height * 0.55) / s,
      };
    };

    // Everything runs from a 0ms timer, never the effect body: synchronous
    // setState in an effect is a lint error, and the choreography needs the
    // step's DOM committed anyway.
    let raf = 0;
    const t = window.setTimeout(() => {
      if (
        at(step, "cursor-to-thread") ||
        at(step, "cursor-to-tab") ||
        at(step, "cursor-to-agent") ||
        at(step, "cursor-to-crumb")
      ) {
        const el = target();
        const to = el && locate(el);
        if (!to) return;
        // Fresh entry spawns offscreen, then glides (CSS transition); a cursor
        // already on stage just glides to the next control.
        setCursor((c) =>
          c.shown
            ? { ...to, shown: true, instant: false }
            : { x: CANVAS_W + 40, y: 60, shown: true, instant: true },
        );
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() =>
            setCursor({ ...to, shown: true, instant: false }),
          );
        });
        return;
      }

      if (
        at(step, "click-thread") ||
        at(step, "click-tab") ||
        at(step, "click-agent") ||
        at(step, "click-crumb")
      ) {
        const { x, y } = cursorPos.current;
        setRipple((r) => ({ x, y, n: r.n + 1 }));
        const el = target();
        // The REAL control's own handler runs — this is the product reacting,
        // not the demo repainting.
        el?.click();
        if (at(step, "click-thread")) setThreadClicked(true);
        if (at(step, "click-agent")) setAgentClicked(true);
        return;
      }

      // ⚠ `click-crumb` is NOT in this list: the cursor stays on stage through step 8,
      // because the channel it just came back to is the thing the reader should be
      // watching and a pointer vanishing mid-scene reads as the demo ending.
      if (
        at(step, "thread-open") ||
        at(step, "tab-open") ||
        at(step, "agent-open")
      ) {
        setCursor((c) => (c.shown ? { ...c, shown: false } : c));
      }
    }, 0);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [step]);

  const resetting = at(step, "reset-fade");

  return (
    <div className="lp-demo" ref={rootRef} aria-hidden="true">
      <style>{ROW_REVEAL_CSS}</style>
      <div
        className={`lp-demo-canvas${resetting ? " is-resetting" : ""}`}
        ref={canvasRef}
        style={{
          height: box.h,
          transform: `translate(-50%, -50%) scale(${box.scale})`,
        }}
      >
        <DemoScene
          step={step}
          run={run}
          paneRef={paneRef}
          agentOpen={agentOpen}
          onOpenAgent={() => setAgentClicked(true)}
          thread={threadOpen ? OPEN_THREAD : null}
          onOpenThread={() => setThreadClicked(true)}
          onExitThread={() => setThreadClicked(false)}
          typedWords={typedWords}
        />

        <div
          className={`lp-demo-cursor${cursor.shown ? " is-shown" : ""}`}
          style={{
            transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
            transition: cursor.instant ? "none" : undefined,
          }}
        >
          {/* ⚠ ONE CURSOR ACROSS THE WHOLE BANNER (Samuel, 2026-10-12) — and, since
              2026-10-14, across /get-started's install drawing too. The artwork, its
              tip-pivoted 45deg turn, the white keyline and the drop shadow all live in
              `../demo-cursor.tsx › DemoCursorGlyph`; read the why there. */}
          <DemoCursorGlyph />
        </div>

        {ripple.n > 0 && (
          <span
            key={ripple.n}
            className="lp-demo-ripple"
            style={{ left: ripple.x, top: ripple.y }}
          />
        )}
      </div>
    </div>
  );
}
