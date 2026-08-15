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
 * "Framework" — the four-stage tour between the Multiplayer row and the folder
 * deck. Eyebrow + a large light-weight heading, then a wide photo banner with a
 * single white product window centred on it, a row of four tab options beneath
 * it, and the page's CTA pair.
 *
 * The window content IS the tab: selecting a tab swaps the vignette (a 200ms
 * fade, keyed on the tab id so React remounts and the animation replays). Add or
 * reorder stages by editing STAGES; the vignettes live in ./framework-windows.
 *
 * ⚠ THE `key` IS LOAD-BEARING, not a fade detail. "Define Objects" is a ~4.7s
 * CSS sequence with no state of its own, and remounting on tab change is the
 * ONLY thing that restarts it — drop the key and the animation plays once per
 * page load and never again.
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
          {/* Decorative; the window on top carries the meaning. Plain <img>: a
              static public/ file in a box the CSS already sizes — same call as
              the hero banner. The source is PORTRAIT, so `object-position` in
              marketing.css is what keeps the peak in frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/framework-banner.jpg"
            alt=""
            className="lp-fw-banner-img"
            draggable={false}
          />

          {/* The window rides a liquid-glass panel (same component as the
              hero's notification glass) — static here, so backdrop-filter is
              safe: nothing animates the glass's box. The white window keeps a
              uniform gap to the glass edge on all four sides. */}
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
