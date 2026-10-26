"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-agent-view-faces.tsx`. Only change:
 * faces resolve through `../data/staging-agents.ts`, so every staging agent (not just the
 * demo's six) gets its owner photo + runtime badge.
 *
 * --- original docblock ---
 *
 * **THE AGENT VIEW'S HEADER AND STATS BOX, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel,
 * 2026-10-22: "change the actual icons to the actual agent icons" and "that little box
 * ... with the context token · 1 hour ago, 91k token spent").
 *
 * ⚠ **THE PRODUCT PARTS ARE UNTOUCHED AND STILL MOUNTED.** `demo-agent-view.tsx` renders
 * the real `AgentPanelHeader` and `AgentStats`; this hides each and places its face after
 * it (`demo-swap.ts`):
 *  - the header: the identity avatar (owner photo + runtime badge in the agent's colour
 *    ring) where the product draws a bot glyph, the name, "↳ in <thread>", a status pill,
 *    and the same close control;
 *  - the stats: the landing's info well (`.lp-ont-info`), the context label with its value
 *    right-aligned over a 3px meter in the agent's colour, and the muted meta line.
 * The stats' figures and meta line are READ off the product box, so they cannot drift.
 */

import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { CornerDownRight, X } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  agentDisplayName,
  agentLiveness,
} from "@/features/channels/components/agents-model";
import { agentColorVar } from "@/features/channels/lib/agent-colors";
import { IdentityFace } from "@/shared/ui/identity-face";
import { useDemoSwap } from "@/features/marketing/components/banner-demo/demo-swap";
import { stagingIdentityFace as identityFace } from "../data/staging-agents";

const VIEW = 'aside[aria-label="Agent view"]';

function statsFacts(source: HTMLElement) {
  const row = source.querySelector(".justify-between");
  const spans = row ? [...row.querySelectorAll("span")] : [];
  const bar = source.querySelector<HTMLElement>('[style*="width"]');
  return {
    label: spans[0]?.textContent?.trim() ?? "",
    value: spans[spans.length - 1]?.textContent?.trim() ?? "",
    width: bar?.style.width || "0%",
    meta: source.querySelector("p")?.textContent?.trim() ?? "",
  };
}

export function StagingAgentViewFaces({
  paneRef,
  agent,
  onClose,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  agent: DesktopSessionSummary;
  onClose: () => void;
}) {
  const swaps = useDemoSwap(
    paneRef,
    (pane) => {
      const header = pane.querySelector<HTMLElement>(`${VIEW} > header`);
      // The stats box is the header's next product sibling (`demo-agent-view.tsx`).
      const stats = header?.parentElement?.querySelector<HTMLElement>(
        ":scope > div.border-b"
      );
      return [
        ...(header ? [{ key: "header", source: header }] : []),
        ...(stats ? [{ key: "stats", source: stats }] : []),
      ];
    },
    "lp-demo-avh-host"
  );
  const face = identityFace(agent.agentId);
  const liveness = agentLiveness(agent);
  const paint = face.color ? agentColorVar(face.color) : undefined;

  return (
    <>
      {swaps.map(({ key, source, host }) => {
        if (key === "header") {
          return createPortal(
            <div className="lp-demo-avh">
              <IdentityFace
                size={30}
                photo={face.photo}
                runtimeLogo={face.logo}
                ring={face.color ?? "neutral"}
              />
              <span className="lp-demo-avh-id">
                <span className="lp-demo-avh-name">{agentDisplayName(agent)}</span>
                {agent.threadTitle && (
                  <span className="lp-demo-avh-where">
                    <CornerDownRight size={11} aria-hidden />
                    in {agent.threadTitle}
                  </span>
                )}
              </span>
              <span className="lp-demo-ac-status" data-tone={liveness.tone}>
                <i />
                {liveness.label}
              </span>
              <button
                type="button"
                className="lp-demo-avh-close"
                aria-label="Close agent view"
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>,
            host,
            key
          );
        }
        const f = statsFacts(source);
        return createPortal(
          <div className="lp-demo-avs">
            <div className="lp-demo-avs-well">
              <p className="lp-demo-avs-row">
                {f.label}
                <span className="lp-demo-avs-value">{f.value}</span>
              </p>
              <span className="lp-demo-avs-track">
                <b style={{ width: f.width, background: paint }} />
              </span>
              <p className="lp-demo-avs-meta">{f.meta}</p>
            </div>
          </div>,
          host,
          key
        );
      })}
    </>
  );
}
