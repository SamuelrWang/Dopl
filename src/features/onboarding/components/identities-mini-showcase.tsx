"use client";

import { cn } from "@/shared/lib/utils";
import openScale from "@/shared/ui/open-scale-button.module.css";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { useFitToRect } from "./use-fit-to-rect";
import { PairedAvatar } from "./paired-avatar";

type CardRect = GlassCardContext["regions"]["main"];

/**
 * Step 4's card, Identities face (Samuel 2026-10-13): one row of three identity
 * cards beside the tab stack (`./workspace-tabs-showcase.tsx`). An identity is
 * a ROLE OF THE USER — their digital twin as a coder, an emailer… — so every
 * card wears the USER's photo paired with the agent it runs on — the login's
 * paired avatar (`./paired-avatar.tsx`),
 * not a bot glyph. Under a hairline, the knowledge entries attached to make it
 * better at that job: each a name over a black rule. "Launch" bottom-right.
 *
 * Card face = the knowledge cards' (`knowledge-v2.module.css › .card`: white,
 * hairline border, soft two-layer shadow, 12px radius); Launch = the Open
 * button's (`btn-light` + `.openScale`); rings = the agent colour bank
 * (`--agent-color-NN`, as `./agent-web.tsx` paints its agents). Laid out at
 * product size and fitted to the area's full width (`./use-fit-to-rect.ts`).
 * Decorative: no buttons, nothing focusable. Hexes are fine here: auth +
 * onboarding are the design system's standing exemption.
 */

/** Three columns at their narrowest natural width: avatar + "Researcher" at
 *  the name size, plus padding, ×3 + gaps. */
const MIN_W = 528;
/** The cards' shortest natural height (every row at its content size). The
 *  grid FILLS the face area's height (`useFitToRect`'s fill mode); the spare
 *  height goes between the entries, so the cards stand full-height rather
 *  than floating in a band of empty card (Samuel 2026-10-13). */
const MIN_H = 216;
const MAX_SCALE = 1.25;
const GAP = 12;

/** The agent logos the cards pair their people with. */
export interface IdentityAgentLogos {
  claude?: string;
  chatgpt?: string;
  muse?: string;
}

/** Samuel's pick (2026-10-13): Coder, Writer, Researcher, one row. Three
 *  entries each so the cards stand level. Each runs on an agent, worn as the
 *  login's paired avatar: Claude (orange ring, as on the login), ChatGPT
 *  (green, as on the login), Muse (blue). */
const IDENTITIES = [
  { name: "Coder", agent: "claude", color: 2, entries: ["Style guide", "Repo map", "Review checklist"] },
  { name: "Writer", agent: "chatgpt", color: 7, entries: ["Writing voice", "Words to avoid", "Style examples"] },
  { name: "Researcher", agent: "muse", color: 10, entries: ["Sources I trust", "Note format", "Topics to track"] },
] as const;

export function IdentitiesMiniShowcase({
  rect,
  on,
  still,
  photos,
  logos,
}: {
  /** The free area right of the stack, glass-box px. */
  rect: CardRect;
  /** The stack is on Identities. */
  on: boolean;
  still: boolean;
  /** The user's photos, cycled across the cards. Empty → drawn placeholders. */
  photos: readonly string[];
  /** Inlined agent logos for the paired avatars; absent → drawn fallbacks. */
  logos?: IdentityAgentLogos;
}) {
  const { ref, style } = useFitToRect(rect, MIN_W, MAX_SCALE, MIN_H);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: GAP,
        // Fill mode sets the height; the cards stretch to it.
        alignItems: "stretch",
        opacity: on ? 1 : 0,
        // The stack's crossfade, so the grid arrives with the Identities pill.
        transition: still ? undefined : "opacity 360ms ease",
      }}
    >
      {IDENTITIES.map((id, i) => (
        <IdentityCard
          key={id.name}
          {...id}
          photo={photos.length ? photos[i % photos.length] : undefined}
          agentLogo={logos?.[id.agent]}
        />
      ))}
    </div>
  );
}

function IdentityCard({
  name,
  color,
  entries,
  photo,
  agentLogo,
}: {
  name: string;
  color: number;
  entries: readonly string[];
  photo?: string;
  agentLogo?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        padding: "13px 12px 12px",
        borderRadius: 12,
        border: "1px solid var(--border-default)",
        background: "var(--bg-elevated)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 6px 18px rgba(0,0,0,0.05)",
      }}
    >
      {/* The user, as this role: the login's paired avatar (`./paired-avatar.tsx`)
          — their photo, the agent's logo inset, both ringed in its colour. */}
      {/* Type a step up from the product card (Samuel 2026-10-13): the row is
          drawn small enough on the glass that product sizes read as specks. */}
      {/* 10px: the badge hangs ~5px past the circle's right edge. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <PairedAvatar d={32} photo={photo} agentLogo={agentLogo} color={color} />
        <span className="truncate font-semibold text-text-primary" style={{ fontSize: 16, lineHeight: 1.35 }}>
          {name}
        </span>
      </div>

      <div style={{ height: 1, background: "var(--border-default)", margin: "12px 0 10px" }} />

      {/* Attached knowledge: each entry's name over a black rule. */}
      {/* `space-between`: fill mode's spare height opens up between the entries. */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8, flex: 1 }}>
        {entries.map((e) => (
          <div key={e} style={{ minWidth: 0 }}>
            <span
              className="block truncate text-text-secondary"
              // Samuel 2026-10-13 round 2: a step down from 16 ("too large").
              style={{ fontSize: 14, lineHeight: 1.35, paddingBottom: 4 }}
            >
              {e}
            </span>
            <span style={{ display: "block", height: 1, background: "#1C1C1F" }} />
          </div>
        ))}
      </div>

      <span className={cn("btn-light", openScale.openScale)} style={{ alignSelf: "flex-end", marginTop: 12, fontSize: "var(--text-body)" }}>
        Launch
      </span>
    </div>
  );
}
