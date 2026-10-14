"use client";

import type { ReactNode } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_GROUND, SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { AgentPill } from "@/features/channels/components/agent-bits";
import { useFitToRect } from "./use-fit-to-rect";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 4's card, Overview face (Samuel 2026-10-13): two wells beside the tab
 * stack (`./workspace-tabs-showcase.tsx`) — "Token spend", an upward bar per
 * model, and "Mentions", small boxes where an agent tagged someone: the
 * agent's pill, the channel in italics to its right, the message under them.
 *
 * ⚠ A MIRROR OF THE PRODUCT'S RECIPES, not a mount. The bars are
 * `apps/desktop-ui/src/components/charts/bar-series.tsx › BarSeries`'s
 * (stadium pills, solid `bg-chart-bar`, the top one inked `bg-surface-cta`,
 * gridlines `border-border-subtle`) — that file lives in the SPA, unreachable
 * from `src/`. The mention row is `channels/components/mentions-list.tsx ›
 * MentionItem`'s line 1 + snippet, boxed as Samuel asked, with the real
 * `AgentPill`. Wells are `SectionPanel`'s shell + ground + heading.
 *
 * Type is set a step above product size because the whole face is drawn at
 * ~0.75× on the glass; it is fitted to fill the area (`./use-fit-to-rect.ts`,
 * fill mode). Decorative: nothing focusable. Hexes/px are fine here: auth +
 * onboarding are the design system's standing exemption.
 */

/** Natural width the layout needs; the area's width sets the scale from it. */
const MIN_W = 440;
/** The content's shortest natural height (fill mode's floor). */
const MIN_H = 206;
const MAX_SCALE = 1.25;
const GAP = 12;

/** Token spend by model (millions). The largest bar is inked. */
const SPEND = [
  { model: "Claude", m: 3.4 },
  { model: "GPT", m: 2.1 },
  { model: "Gemini", m: 1.3 },
  { model: "Grok", m: 0.7 },
] as const;
const CEIL = 4;

const MENTIONS = [
  { agent: "Scout", color: "agent-10", channel: "outreach", handle: "@Alex", text: "the Q3 lead list is ready for your review." },
  { agent: "Quill", color: "agent-14", channel: "launch", handle: "@Alex", text: "drafted the announcement — want a look?" },
] as const;

export function OverviewMiniShowcase({
  rect,
  on,
  still,
}: {
  /** The free area right of the stack, glass-box px. */
  rect: CardRect;
  /** The stack is on Overview. */
  on: boolean;
  still: boolean;
}) {
  const { ref, style } = useFitToRect(rect, MIN_W, MAX_SCALE, MIN_H);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        ...style,
        display: "flex",
        gap: GAP,
        opacity: on ? 1 : 0,
        // The stack's crossfade, so the panel arrives with the Overview pill.
        transition: still ? undefined : "opacity 360ms ease",
      }}
    >
      <Well label="Token spend" grow={0.9}>
        <div className="bento flex min-h-0 flex-1 flex-col" style={{ padding: "10px 12px 8px" }}>
          <span className="font-mono text-small tabular-nums text-text-secondary">7.5M tokens</span>
          {/* The plot: gridlines behind, one stadium bar per model. */}
          <div className="relative mt-2 min-h-0 flex-1">
            <div className="absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="border-t border-border-subtle" />
              ))}
            </div>
            <div className="relative flex h-full items-end justify-around">
              {SPEND.map((s, i) => (
                <span
                  key={s.model}
                  className={cn("rounded-full", i === 0 ? "bg-surface-cta" : "bg-chart-bar")}
                  style={{ width: "18%", minHeight: 14, height: `${(s.m / CEIL) * 100}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex justify-around">
            {SPEND.map((s, i) => (
              <span
                key={s.model}
                className={cn("text-small text-text-primary", i === 0 && "font-medium")}
                style={{ width: "25%", textAlign: "center" }}
              >
                {s.model}
              </span>
            ))}
          </div>
        </div>
      </Well>

      <Well label="Mentions" grow={1.1}>
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2">
          {MENTIONS.map((m) => (
            <div key={m.agent} className="bento flex min-w-0 flex-col gap-0.5" style={{ padding: "6px 9px", borderRadius: 10 }}>
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentPill color={m.color} className="text-small">
                  {m.agent}
                </AgentPill>
                <span className="truncate text-small italic text-text-muted"># {m.channel}</span>
              </span>
              <span className="line-clamp-2 text-small text-text-secondary">
                <span className="font-medium text-link">{m.handle}</span> {m.text}
              </span>
            </div>
          ))}
        </div>
      </Well>
    </div>
  );
}

function Well({ label, grow, children }: { label: string; grow: number; children: ReactNode }) {
  return (
    <div
      className={cn(SECTION_PANEL_SHELL, SECTION_PANEL_GROUND, "flex min-w-0 flex-col")}
      style={{ flex: `${grow} 1 0` }}
    >
      {/* `SectionPanel`'s header row, minus its actions. */}
      <div className="flex min-h-[22px] items-center px-1 pb-2">
        <span className={cn("truncate", SECTION_HEADING_TEXT)}>{label}</span>
      </div>
      {children}
    </div>
  );
}
