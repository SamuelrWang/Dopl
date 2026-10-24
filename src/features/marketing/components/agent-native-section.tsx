"use client";

import "@/features/marketing/agent-native.css";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { DOWNLOAD_URL, GET_STARTED_URL } from "../constants";
import { AGENTS_SCENE, AGENT_NATIVE_COPY, IDENTITY_SCENE, KNOWLEDGE_SCENE, STAGE_COPY, type StageId } from "./agent-native-content";
import { AgentsWindow, IdentitiesWindow, KnowledgeWindow } from "./agent-native-windows";
import { ArrowUpRight } from "./icons";
import { ScrollReveal } from "./scroll-reveal";
import { useGlassScrub } from "./use-glass-scrub";
import { useOntologyPlay } from "./use-ontology-play";

/**
 * "Agent native": everything a person can do in Dopl, their agent can do over
 * MCP. A three-stage tab tour cloned from the Orchestration section
 * (./ontology-section.tsx), sharing its shell classes (`.lp-ont-*`), its glass
 * scrub (./use-glass-scrub), its play gate (./use-ontology-play) and its play
 * contract (./ontology-bits). Windows: ./agent-native-windows; every word:
 * ./agent-native-content; the few section-only rules: ../agent-native.css.
 *
 * THE TOUR is Orchestration's: opens on the first tab; while the window is on
 * screen the active tab's meter fills over the window's animation and its
 * `animationend` advances the tour (the meter IS the clock). It only pauses
 * off screen, never on hover or focus. A click or arrow key jumps to a tab and
 * restarts its window and meter. Reduced motion / no JS: the meter shows full,
 * nothing advances, the windows show their end frames.
 *
 * ⚠ The panel CONTENT's `key` is load-bearing, as in Orchestration: only the
 * content inside the fixed white panel remounts on a tab switch.
 */
type Stage = { id: StageId; window: ReactNode; fillMs: number };

/** Just long enough for the last beat's own entrance to finish before the swap. */
const SETTLE_MS = 600;

const STAGES: readonly Stage[] = [
  { id: "identities", window: <IdentitiesWindow />, fillMs: IDENTITY_SCENE.endMs + SETTLE_MS },
  { id: "knowledge", window: <KnowledgeWindow />, fillMs: KNOWLEDGE_SCENE.endMs + SETTLE_MS },
  { id: "agents", window: <AgentsWindow />, fillMs: AGENTS_SCENE.endMs + SETTLE_MS },
];

export function AgentNativeSection() {
  const [active, setActive] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[active];
  const { mode: glassMode, bannerRef, glassRef } = useGlassScrub();
  const play = useOntologyPlay(bannerRef, glassMode);
  const touring = play !== "static";
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
    <ScrollReveal className="lp-ont lp-agn">
      <div className="lp-ont-inner">
        <p className="lp-ont-eyebrow">{AGENT_NATIVE_COPY.eyebrow}</p>
        <h2 className="lp-ont-heading">{AGENT_NATIVE_COPY.heading}</h2>

        <div>
          <div className="lp-ont-banner" data-glass={glassMode} ref={bannerRef}>
            {/* Decorative; the window on top carries the meaning. LANDSCAPE
                source (1116×730), so the shared `cover` crop is gentle. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/dev-clouds-v4.jpg" alt="" className="lp-ont-banner-img" draggable={false} />

            {/* ⚠ Scrubbed box in `scrub` mode: `staticMap` for the reason
                ./ontology-section.tsx records. */}
            <div className="lp-ont-glass" ref={glassRef}>
              <LiquidGlass radius={20} staticMap={glassMode === "scrub"} className="lp-ont-glass-card" edge="rim" tilt>
                <div id="lp-agn-panel" role="tabpanel" aria-labelledby={`lp-agn-tab-${stage.id}`} className="lp-ont-window">
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

          <div
            className="lp-ont-tabs"
            role="tablist"
            aria-label={AGENT_NATIVE_COPY.tablistLabel}
            onKeyDown={onKeyDown}
          >
            {STAGES.map((item, i) => {
              const selected = i === active;
              const copy = STAGE_COPY[item.id];
              return (
                <button
                  key={item.id}
                  id={`lp-agn-tab-${item.id}`}
                  ref={(node) => {
                    tabRefs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="lp-agn-panel"
                  tabIndex={selected ? 0 : -1}
                  className="lp-ont-tab"
                  data-active={selected}
                  onClick={() => choose(i)}
                >
                  {selected ? (
                    // The meter always shows on the selected tab (Orchestration's rule).
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
            {AGENT_NATIVE_COPY.primaryCta}
            <ArrowUpRight size={14} />
          </a>
          <a href={DOWNLOAD_URL} className="lp-ont-secondary">
            {AGENT_NATIVE_COPY.secondaryCta}
          </a>
        </div>
      </div>
    </ScrollReveal>
  );
}
