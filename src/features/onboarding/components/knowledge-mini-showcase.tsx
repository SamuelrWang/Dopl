"use client";

import type { CSSProperties } from "react";
import { ArrowRight, Bookmark } from "lucide-react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_GROUND, SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { OPEN_SCALE_ICON } from "@/shared/ui/open-scale-button";
import openScale from "@/shared/ui/open-scale-button.module.css";
import kv from "@/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";
import { kbCardLabel } from "@/features/knowledge/components/knowledge-v2/list-filters";
import { useFitToRect } from "./use-fit-to-rect";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 4's card, Knowledge face (Samuel 2026-10-13): a miniature of /home's
 * Knowledge page beside the tab stack (`./workspace-tabs-showcase.tsx`) — the
 * two gray wells side by side, "Personal" then "Shared", one simplified
 * knowledge card in each: name + scope pill, the inset with its left-ruled
 * italic description, the storage bar WITHOUT its text, and the foot's
 * bookmark + raised "Open →".
 *
 * ⚠ A MIRROR, BUILT FROM THE REAL PIECES — not a mount. The live cell is
 * `src/features/knowledge/components/home/home-knowledge-cards.tsx › BaseCell` around
 * `knowledge-v2/home/base-card.tsx › BaseCard`, which has no slot to drop its
 * meta line.
 * So this takes their CLASSES instead: the wells are `SectionPanel`'s shell +
 * ground + heading face, the card is `knowledge-v2.module.css`'s `.card*`
 * rules, the bar is `UsageMeter`'s `.concave-track` + success fill, and Open
 * is `OpenScaleButton`'s `btn-light` + `.openScale`. The `--kv-*` rebinds the
 * card reads are /home's (`home-knowledge.module.css › .kbCards`), restated inline.
 *
 * Laid out at the PRODUCT's size and scaled as a whole to fit `rect` — its
 * full width, no gap on the right (`./use-fit-to-rect.ts`) — so the
 * proportions are the real app's. Decorative: no buttons, nothing focusable.
 */

/** The pair's narrowest natural width — two wells a little narrower than
 *  /home's card columns. Wider areas stretch the wells (`useFitToRect`). */
const MIN_W = 480;
const WELL_GAP = 14;
/** Growth cap, so a 1920 card doesn't blow the type up past the stack's. */
const MAX_SCALE = 1.25;

/** `home-knowledge.module.css › .kbCards`'s rebinds, which `.card*` reads. */
const KV_VARS = {
  "--kv-border": "var(--border-default)",
  "--kv-border-strong": "var(--border-strong)",
  "--kv-text": "var(--text-primary)",
  "--kv-text-2": "var(--text-secondary)",
  "--kv-text-3": "var(--text-muted)",
  "--kv-card-desc-lines": 2,
} as CSSProperties;

const BASES = [
  {
    well: "Personal",
    name: "Travel Plans",
    pill: kbCardLabel("private", false),
    desc: "Flights, hotels and ideas for the summer trip.",
    used: 34,
  },
  {
    well: "Shared",
    name: "Team Docs",
    pill: kbCardLabel("private", true),
    desc: "Specs, notes and decisions the team shares.",
    used: 58,
  },
] as const;

export function KnowledgeMiniShowcase({
  rect,
  on,
  still,
}: {
  /** The free area right of the stack, glass-box px. */
  rect: CardRect;
  /** The stack is on Knowledge. */
  on: boolean;
  still: boolean;
}) {
  // Fills the area's full width; the wells (and their cards) stretch.
  const { ref, style } = useFitToRect(rect, MIN_W, MAX_SCALE);

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        ...style,
        display: "flex",
        gap: WELL_GAP,
        opacity: on ? 1 : 0,
        // The stack's crossfade, so the panel arrives with the Knowledge pill.
        transition: still ? undefined : "opacity 360ms ease",
        ...KV_VARS,
      }}
    >
      {BASES.map((b) => (
        <div key={b.well} className={cn(SECTION_PANEL_SHELL, SECTION_PANEL_GROUND, "min-w-0 flex-1")}>
          {/* `SectionPanel`'s header row, minus its create action. */}
          <div className="flex min-h-[22px] items-center px-1 pb-2.5">
            <span className={cn("truncate", SECTION_HEADING_TEXT)}>{b.well}</span>
          </div>
          <MiniCard {...b} />
        </div>
      ))}
    </div>
  );
}

function MiniCard({ name, pill, desc, used }: { name: string; pill: string; desc: string; used: number }) {
  return (
    <div className={cn(kv.card, kv.scopePrivate)} style={{ cursor: "default" }}>
      <div className={kv.cardHead}>
        <span className={kv.cardName}>{name}</span>
        <span className={kv.cardScope}>{pill}</span>
      </div>
      <div className={kv.cardInset}>
        <div className={kv.cardDescRow}>
          <span className={kv.cardAccent} />
          <span className={kv.cardDesc}>{desc}</span>
        </div>
        {/* `UsageMeter`'s bar alone — Samuel: no "Storage 52 B / 5 MB". */}
        <div className={kv.cardMetaRow}>
          <div className="concave-track">
            <div className="h-1.5 rounded-full bg-success" style={{ width: `${used}%` }} />
          </div>
        </div>
        <div className={kv.cardFoot}>
          <span className={kv.cardStar}>
            <Bookmark size={14} fill="none" />
          </span>
          <span className={cn("btn-light", openScale.openScale)}>
            Open
            <ArrowRight size={OPEN_SCALE_ICON} />
          </span>
        </div>
      </div>
    </div>
  );
}
