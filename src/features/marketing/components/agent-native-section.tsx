"use client";

import "@/features/marketing/agent-native.css";
import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { DOWNLOAD_URL, GET_STARTED_URL } from "../constants";
import { AGENT_NATIVE_COPY } from "./agent-native-content";
import { AgentAppWindow } from "./agent-native-window";
import { ArrowUpRight } from "./icons";
import { ScrollReveal } from "./scroll-reveal";
import { useGlassScrub } from "./use-glass-scrub";
import { useOntologyPlay } from "./use-ontology-play";

/**
 * "Agent native": Dopl is built for agents to operate, so everything you can
 * do in it your agent can do over MCP. ONE demo, no tabs (Samuel 2026-10-24):
 * the user inside an agent's own desktop app while it builds identities and
 * knowledge and runs agents in Dopl (./agent-native-window.tsx).
 *
 * Shell = the Orchestration section's (./ontology-section.tsx): the root wears
 * `.lp-ont` for its eyebrow, heading, banner, scrubbed glass, white window and
 * CTA rules, with ./use-glass-scrub driving the glass and ./use-ontology-play
 * gating the clock. Every word: ./agent-native-content.ts; section-only rules:
 * ../agent-native.css.
 */
export function AgentNativeSection() {
  const { mode: glassMode, bannerRef, glassRef } = useGlassScrub();
  const play = useOntologyPlay(bannerRef, glassMode);

  return (
    <ScrollReveal className="lp-ont lp-agn">
      <div className="lp-ont-inner">
        <p className="lp-ont-eyebrow">{AGENT_NATIVE_COPY.eyebrow}</p>
        <h2 className="lp-ont-heading">{AGENT_NATIVE_COPY.heading}</h2>
        <p className="lp-agn-lede">{AGENT_NATIVE_COPY.lede}</p>

        <div className="lp-ont-banner" data-glass={glassMode} ref={bannerRef}>
          {/* Decorative; the window on top carries the meaning. LANDSCAPE
              source (1116×730), so the shared `cover` crop is gentle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/dev-clouds-v4.jpg" alt="" className="lp-ont-banner-img" draggable={false} />

          {/* ⚠ Scrubbed box in `scrub` mode: `staticMap` for the reason
              ./ontology-section.tsx records. */}
          <div className="lp-ont-glass" ref={glassRef}>
            <LiquidGlass radius={20} staticMap={glassMode === "scrub"} className="lp-ont-glass-card" edge="rim" tilt>
              <div className="lp-ont-window">
                <AgentAppWindow play={play} />
              </div>
            </LiquidGlass>
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
