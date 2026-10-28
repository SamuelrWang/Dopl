"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { DOWNLOAD_URL, GET_STARTED_URL } from "../constants";
import { CommandWindow } from "./ontology-command";
import { COMMAND, CONTEXT, ORCH_COPY, STAGE_COPY, TASKS } from "./ontology-content";
import { CHANNEL_END_MS, ChannelsWindow, ContextWindow, TasksWindow } from "./ontology-windows";
import { ArrowUpRight } from "./icons";
import { ScrollReveal } from "./scroll-reveal";
import { useGlassScrub } from "./use-glass-scrub";
import { useOntologyPlay } from "./use-ontology-play";

/**
 * "Orchestration" (was "Ontology" — the file names kept theirs): a four-stage
 * tab tour. Window content IS the tab; windows live in ./ontology-windows and
 * ./ontology-command, every word in ./ontology-content.
 *
 * THE TOUR. Opens on the first tab. While the window is on screen (./use-ontology-play)
 * the active tab's meter fills over the window's animation and its
 * `animationend` advances the tour — the meter IS the clock,
 * so it can never drift from the window. It only pauses while the window is
 * off screen; hover and focus do NOT pause it. A click or arrow key jumps to that tab
 * and restarts its window and meter; the tour carries on from there. The
 * meter always shows on the selected tab. Reduced motion / no JS: the meter
 * shows full, nothing advances, the windows show their end frames.
 *
 * ⚠ The panel CONTENT's `key` is load-bearing — see `.lp-ont-window-swap`.
 */
type Stage = {
  id: keyof typeof STAGE_COPY;
  window: ReactNode;
  /** The window's last beat + SETTLE_MS: the meter fills over exactly this and
   *  the tour advances the moment it is full (no hold, Samuel 2026-10-22). */
  fillMs: number;
};

/** Just long enough for the last beat's own entrance to finish before the swap. */
const SETTLE_MS = 600;

const STAGES: readonly Stage[] = [
  { id: "context", window: <ContextWindow />, fillMs: CONTEXT.endMs + SETTLE_MS },
  { id: "channels", window: <ChannelsWindow />, fillMs: CHANNEL_END_MS + SETTLE_MS },
  { id: "tasks", window: <TasksWindow />, fillMs: TASKS.endMs + SETTLE_MS },
  { id: "command", window: <CommandWindow />, fillMs: COMMAND.endMs + SETTLE_MS },
];

// Opens on the first tab, Build & share memory (Samuel, 2026-10-21).
const DEFAULT_STAGE = 0;

export function OntologySection() {
  const [active, setActive] = useState(DEFAULT_STAGE);
  // Bumped on every tab click so re-choosing (even the same tab) restarts the
  // window AND its meter together. The tour never stops: a click just jumps it.
  const [runKey, setRunKey] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[active];
  // Tab-independent: the window height is pinned in CSS, so the full box is the
  // same whichever stage is selected and this never sees `active`.
  const { mode: glassMode, bannerRef, glassRef } = useGlassScrub();
  const play = useOntologyPlay(bannerRef, glassMode);
  const touring = play !== "static";
  // 🔒 No hover/focus pause (Samuel, 2026-10-22): clicking a tab always meant
  // hovering the tabs and focusing one, so a click froze the window and its bar.
  // The tour only pauses while the window is off screen (`play` = armed).
  const running = play === "in";

  function choose(index: number) {
    setActive(index);
    setRunKey((k) => k + 1);
  }

  /** Roving tabindex: only the selected tab is tabbable, arrows move between. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = (active + step + STAGES.length) % STAGES.length;
    choose(next);
    tabRefs.current[next]?.focus();
  }


  return (
    <ScrollReveal className="lp-ont">
      <div className="lp-ont-inner">
        <p className="lp-ont-eyebrow">{ORCH_COPY.eyebrow}</p>
        <h2 className="lp-ont-heading">{ORCH_COPY.heading}</h2>

        <div>
          <div className="lp-ont-banner" data-glass={glassMode} ref={bannerRef}>
            {/* Decorative; the window on top carries the meaning. Plain <img>:
                static public/ file in a CSS-sized box. ⚠ Source is PORTRAIT —
                `object-position` in marketing.css keeps the peak in frame. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/framework-banner.jpg" alt="" className="lp-ont-banner-img" draggable={false} />

            {/* ⚠ The wrapper's box is SCRUBBED in `scrub` mode — square → full
                rectangle and back, driven by ./use-glass-scrub. `staticMap`
                goes with that for the reason hero-banner records: an animating
                box would otherwise rebuild the displacement map every frame and
                the <feImage> swap pops the refraction. */}
            <div className="lp-ont-glass" ref={glassRef}>
              <LiquidGlass
                radius={20}
                staticMap={glassMode === "scrub"}
                className="lp-ont-glass-card"
                // Onboarding's edge + hover tilt (Samuel 2026-10-13). The tilt
                // lives on the glass's own layers, so it composes with the
                // scrub, which only ever writes this WRAPPER's box.
                edge="rim"
                tilt
              >
                <div
                  id="lp-ont-panel"
                  role="tabpanel"
                  aria-labelledby={`lp-ont-tab-${stage.id}`}
                  className="lp-ont-window"
                >
                  {/* ⚠ The key is on the CONTENT, not the white panel: the panel
                      itself must sit fixed across tab switches — only what is
                      inside fades. The remount is also what restarts a window's
                      CSS sequence on a tab switch; `data-play` flipping
                      armed → in restarts it on re-entry. */}
                  <div
                    key={`${stage.id}-${runKey}`}
                    className="lp-ont-window-swap"
                    data-play={play === "static" ? undefined : play}
                  >
                    {stage.window}
                  </div>
                </div>
              </LiquidGlass>
            </div>
          </div>

          <div className="lp-ont-tabs" role="tablist" aria-label={ORCH_COPY.tablistLabel} onKeyDown={onKeyDown}>
            {STAGES.map((item, i) => {
              const selected = i === active;
              const copy = STAGE_COPY[item.id];
              return (
                <button
                  key={item.id}
                  id={`lp-ont-tab-${item.id}`}
                  ref={(node) => {
                    tabRefs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="lp-ont-panel"
                  tabIndex={selected ? 0 : -1}
                  className="lp-ont-tab"
                  data-active={selected}
                  onClick={() => choose(i)}
                >
                  {selected ? (
                    // 🔒 THE METER ALWAYS SHOWS on the selected tab (Samuel,
                    // 2026-10-22): before hydration, off screen, after a click,
                    // on reload or back. It fills in step with the window
                    // (fillMs) and the tour advances the moment it is full (no
                    // hold); a click restarts it on the chosen
                    // tab and the tour carries on from there. Paused (not hidden)
                    // while the window is off screen; static
                    // (reduced motion, no JS) shows it full and never advances.
                    <span className="lp-ont-tab-meter" aria-hidden="true">
                      <i
                        key={`${item.id}-${play}-${runKey}`}
                        style={{ animationDuration: `${item.fillMs}ms` }}
                        data-running={running}
                        data-static={touring ? undefined : "true"}
                        onAnimationEnd={() => {
                          if (touring) setActive((a) => (a + 1) % STAGES.length);
                        }}
                      />
                    </span>
                  ) : null}
                  <span className="lp-ont-tab-title">{copy.title}</span>
                  {selected ? <span className="lp-ont-tab-blurb">{copy.blurb}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lp-ont-cta">
          <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
            Get started
            <ArrowUpRight size={14} />
          </a>
          <a href={DOWNLOAD_URL} className="lp-ont-secondary">
            Download the app
          </a>
        </div>
      </div>
    </ScrollReveal>
  );
}
