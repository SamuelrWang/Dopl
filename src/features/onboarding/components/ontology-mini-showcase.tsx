"use client";

import { Plus } from "lucide-react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { OPEN_SCALE_ICON } from "@/shared/ui/open-scale-button";
import openScale from "@/shared/ui/open-scale-button.module.css";
import { useFitToRect } from "./use-fit-to-rect";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 4's card, Ontology face (Samuel 2026-10-13): the ontology's name top
 * left ("Pipeline") with a raised "+ New object" at the right, then one gray
 * lane per object template ("LinkedIn Outbound", "Email Inbound"), each holding ROWS
 * of that object — the person (initials disc + name) and, to the right, a few
 * of the template's field values as chips.
 *
 * ⚠ A MIRROR OF THE PRODUCT'S PIECES, not a mount: the lane header is
 * `ontology/components/kanban-column-header.tsx`'s (semibold name + the
 * `bg-surface-raised-4` count chip), the field chip is that file's template
 * field chip (`border-border-strong bg-bg-inset`), the lane is `SectionPanel`'s
 * ground, the row a `.bento` white face, and the button `OpenScaleButton`'s
 * `btn-light` + `.openScale`. Type a step above product size (the face is
 * drawn at ~0.75×); fitted to fill the area (`./use-fit-to-rect.ts`, fill
 * mode). Decorative: nothing focusable. Hexes/px are fine here: auth +
 * onboarding are the design system's standing exemption.
 */

/** Natural width the layout needs; the area's width sets the scale from it. */
const MIN_W = 440;
/** The content's shortest natural height (fill mode's floor). */
const MIN_H = 210;
const MAX_SCALE = 1.25;

const agentColor = (n: number) => `var(--agent-color-${String(n).padStart(2, "0")})`;

const TEMPLATES = [
  {
    name: "LinkedIn Outbound",
    count: 24,
    rows: [
      { person: "Maya Chen", color: 10, company: "Northwind", status: "Connected" },
      { person: "Leo Park", color: 6, company: "Brightline", status: "Messaged" },
    ],
  },
  {
    name: "Email Inbound",
    count: 18,
    rows: [{ person: "Ava Ruiz", color: 14, company: "Fernway", status: "Replied" }],
  },
] as const;

export function OntologyMiniShowcase({
  rect,
  on,
  still,
}: {
  /** The free area right of the stack, glass-box px. */
  rect: CardRect;
  /** The stack is on Ontology. */
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
        flexDirection: "column",
        gap: 6,
        opacity: on ? 1 : 0,
        // The stack's crossfade, so the board arrives with the Ontology pill.
        transition: still ? undefined : "opacity 360ms ease",
      }}
    >
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className={cn("min-w-0 flex-1 truncate", SECTION_HEADING_TEXT)}>Pipeline</span>
        <span className={cn("btn-light", openScale.openScale)}>
          <Plus size={OPEN_SCALE_ICON} />
          New object
        </span>
      </div>

      {/* Lanes share the spare height; their rows sit at the top of each. */}
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-1.5">
        {TEMPLATES.map((t) => (
          <div key={t.name} className={cn(SECTION_PANEL_GROUND, "flex min-w-0 flex-col gap-1 rounded-[12px] p-1.5")}>
            <span className="flex min-w-0 items-center gap-1.5 px-1">
              <span className="truncate text-title font-semibold tracking-tight text-text-primary">{t.name}</span>
              <span className="shrink-0 rounded-full bg-surface-raised-4 px-1.5 py-px text-small font-medium text-text-secondary">
                {t.count}
              </span>
            </span>
            {t.rows.map((r) => (
              <Row key={r.person} {...r} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ person, color, company, status }: { person: string; color: number; company: string; status: string }) {
  const initials = person
    .split(" ")
    .map((w) => w[0])
    .join("");
  return (
    <div className="bento flex min-w-0 items-center gap-2" style={{ padding: "3px 8px", borderRadius: 9 }}>
      <span
        className="flex shrink-0 items-center justify-center rounded-full text-label font-semibold text-text-on-cta"
        style={{ width: 22, height: 22, background: agentColor(color) }}
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-lead font-normal text-text-primary">{person}</span>
      <Chip>{company}</Chip>
      <Chip>{status}</Chip>
    </div>
  );
}

/** `kanban-column-header.tsx`'s template-field chip. */
function Chip({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-2 py-px text-small font-medium text-text-secondary">
      {children}
    </span>
  );
}
