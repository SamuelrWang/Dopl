"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { DOWNLOAD_URL, GET_STARTED_URL } from "../constants";
import {
  AgentWindow,
  KnowledgeWindow,
  ObjectWindow,
  RelationshipWindow,
} from "./ontology-windows";
import { ArrowUpRight } from "./icons";
import { ScrollReveal } from "./scroll-reveal";
import { useGlassScrub } from "./use-glass-scrub";

/**
 * "Ontology" — four-stage tab tour. Window content IS the tab; vignettes live
 * in ./ontology-windows. Add/reorder stages via STAGES.
 * *
 * ⚠ THE `key` IS LOAD-BEARING, not a fade detail. "Define Objects" is a ~4.7s
 * CSS sequence with no state of its own, and remount on tab change is the ONLY
 * thing that restarts it — drop the key and it plays once per page load.
 */
type Stage = {
  id: string;
  title: string;
  blurb: string;
  window: ReactNode;
};

const STAGES: readonly Stage[] = [
  {
    id: "unify",
    title: "Unify Data",
    blurb:
      "Pull docs, notes, and scattered files into shared knowledge bases your agents can actually read.",
    window: <KnowledgeWindow />,
  },
  {
    id: "objects",
    title: "Define Objects",
    blurb:
      "Turn raw context into typed objects — clients, projects, playbooks — with fields agents understand.",
    window: <ObjectWindow />,
  },
  {
    id: "relationships",
    title: "Form Relationships",
    blurb:
      "Link objects into a living map so the right context finds the right work on its own.",
    window: <RelationshipWindow />,
  },
  {
    id: "action",
    title: "Enable Action",
    blurb:
      "Agents act on your workspace over MCP — reading bases, running skills, and writing results back.",
    window: <AgentWindow />,
  },
];

export function OntologySection() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[active];
  // Tab-independent: the window height is pinned in CSS, so the full box is the
  // same whichever stage is selected and this never sees `active`.
  const { mode: glassMode, bannerRef, glassRef } = useGlassScrub();

  /** Roving tabindex: only the selected tab is tabbable, arrows move between. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;

    event.preventDefault();
    const next = (active + step + STAGES.length) % STAGES.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <ScrollReveal className="lp-ont">
      <div className="lp-ont-inner">
        <p className="lp-ont-eyebrow">Ontology</p>
        <h2 className="lp-ont-heading">
          Unify disconnected data into structured context systems
        </h2>

        <div className="lp-ont-banner" data-glass={glassMode} ref={bannerRef}>
          {/* Decorative; the window on top carries the meaning. Plain <img>:
              static public/ file in a CSS-sized box. ⚠ Source is PORTRAIT —
              `object-position` in marketing.css keeps the peak in frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/framework-banner.jpg"
            alt=""
            className="lp-ont-banner-img"
            draggable={false}
          />

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
            >
              <div
                id="lp-ont-panel"
                role="tabpanel"
                aria-labelledby={`lp-ont-tab-${stage.id}`}
                className="lp-ont-window"
              >
                {/* ⚠ The key is on the CONTENT, not the white panel: the panel
                    itself must sit fixed across tab switches (matching the dev
                    terminal, which keys only its command line) — only what is
                    inside fades. The key is still LOAD-BEARING for stage 2's
                    stamp sequence: that ~4.7s CSS run has no state of its own
                    and the remount of this wrapper is the only thing that
                    restarts it. */}
                <div key={stage.id} className="lp-ont-window-swap">
                  {stage.window}
                </div>
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div
          className="lp-ont-tabs"
          role="tablist"
          aria-label="Ontology stages"
          onKeyDown={onKeyDown}
        >
          {STAGES.map((item, i) => {
            const selected = i === active;
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
                onClick={() => setActive(i)}
              >
                <span className="lp-ont-tab-title">{item.title}</span>
                {selected ? (
                  <span className="lp-ont-tab-blurb">{item.blurb}</span>
                ) : null}
              </button>
            );
          })}
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
