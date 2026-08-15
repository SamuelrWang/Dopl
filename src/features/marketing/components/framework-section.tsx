"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { DOWNLOAD_URL, GET_STARTED_URL } from "../constants";
import {
  AgentWindow,
  KnowledgeWindow,
  ObjectWindow,
  RelationshipWindow,
} from "./framework-windows";
import { ArrowUpRight } from "./icons";

/**
 * "Framework" — four-stage tab tour. Window content IS the tab; vignettes live
 * in ./framework-windows. Add/reorder stages via STAGES.
 *
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

export function FrameworkSection() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stage = STAGES[active];

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
    <section className="lp-fw">
      <div className="lp-fw-inner">
        <p className="lp-fw-eyebrow">Framework</p>
        <h2 className="lp-fw-heading">
          Unify disconnected data into structured context systems
        </h2>

        <div className="lp-fw-banner">
          {/* Decorative; the window on top carries the meaning. Plain <img>:
              static public/ file in a CSS-sized box. ⚠ Source is PORTRAIT —
              `object-position` in marketing.css keeps the peak in frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/framework-banner.jpg"
            alt=""
            className="lp-fw-banner-img"
            draggable={false}
          />

          {/* Glass is static here, so backdrop-filter is safe — nothing
              animates its box. */}
          <div className="lp-fw-glass">
            <LiquidGlass radius={20} className="lp-fw-glass-card">
              <div
                key={stage.id}
                id="lp-fw-panel"
                role="tabpanel"
                aria-labelledby={`lp-fw-tab-${stage.id}`}
                className="lp-fw-window"
              >
                {stage.window}
              </div>
            </LiquidGlass>
          </div>
        </div>

        <div
          className="lp-fw-tabs"
          role="tablist"
          aria-label="Framework stages"
          onKeyDown={onKeyDown}
        >
          {STAGES.map((item, i) => {
            const selected = i === active;
            return (
              <button
                key={item.id}
                id={`lp-fw-tab-${item.id}`}
                ref={(node) => {
                  tabRefs.current[i] = node;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="lp-fw-panel"
                tabIndex={selected ? 0 : -1}
                className="lp-fw-tab"
                data-active={selected}
                onClick={() => setActive(i)}
              >
                <span className="lp-fw-tab-title">{item.title}</span>
                {selected ? (
                  <span className="lp-fw-tab-blurb">{item.blurb}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="lp-fw-cta">
          <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
            Get started
            <ArrowUpRight size={14} />
          </a>
          <a href={DOWNLOAD_URL} className="lp-fw-secondary">
            Download the app
          </a>
        </div>
      </div>
    </section>
  );
}
