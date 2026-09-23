"use client";

/**
 * Channels — the pill heading every message group (avatar, name over time), one face for every
 * author. An agent wears its operator's avatar (INVARIANTS §5). Display only: inputs are derived
 * in `view-model-rows.ts › toMessageRow`.
 */

import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { agentFaceName } from "@/shared/lib/agent-name";
import { agentAccent } from "./bits";

/** The name line: a human's `authorLabel`; a stamped agent's `agentFaceName(agentName)` (the
 *  rename, else "New Agent"); an unstamped agent's "Agent" (no session to name). */
export function attributionName({
  agent,
  agentId,
  authorLabel,
  agentName = null,
}: {
  agent: boolean;
  agentId: string | null;
  authorLabel: string;
  /** The operator's current name for it, resolved at render — never a row field. */
  agentName?: string | null;
}): string {
  if (!agent) return authorLabel;
  return agentId ? agentFaceName(agentName) : "Agent";
}

/** The "agent" (or "outside session") chip beside the name, filled with the agent's paint. */
export function AgentChip({
  paint,
  external = false,
}: {
  paint?: string | null;
  /** An outside session wrote the row: replaces the word, always grey (it holds no colour). */
  external?: boolean;
}) {
  // Explicit height + `items-center` centres the text box at every font size.
  const shape =
    "inline-flex h-[16px] shrink-0 items-center justify-center rounded-full px-1.5 text-micro leading-none";
  if (external) {
    return (
      <span className={cn(shape, "bg-bg-inset text-text-muted")}>
        outside session
      </span>
    );
  }
  if (!paint) {
    return <span className={cn(shape, "bg-bg-inset text-text-muted")}>agent</span>;
  }
  // `paint` is a caller-resolved `var()` reference; inline because the palette key is data.
  return (
    <span style={{ backgroundColor: paint }} className={cn(shape, "text-text-on-cta")}>
      agent
    </span>
  );
}

/** The kit's `.bento` at a capsule radius (the utility outranks the component layer). An agent pill
 *  is a `<button>` only when handed `onOpenAgent`; both elements share one face. */
export function AttributionPill({
  author,
  authorLabel,
  agent,
  // Default is load-bearing: without it `external` resolves to the DOM global and reads truthy.
  external = false,
  agentId = null,
  agentName = null,
  agentPaint = null,
  radius,
  framed = false,
  time,
  onOpenAgent,
}: {
  author: AvatarPerson;
  authorLabel: string;
  /** An outside session wrote it — narrows {@link agent}, never a sibling. */
  external?: boolean;
  /** Display claim off `authorKind` — never a side, never an identity. */
  agent: boolean;
  /** WHICH agent, when the writer stamped it; `null` is "cannot say". */
  agentId?: string | null;
  /** Its current operator-given name, resolved at render from `AuthorIndex.agents`. */
  agentName?: string | null;
  /** `var()` paint from `agent-box-rule.ts › agentPostAccent`; `null` keeps the grey chip. */
  agentPaint?: string | null;
  /** Replaces `rounded-full` (bar-side corners squared); a radius, not a className escape hatch. */
  radius?: string;
  /** The row's frame draws stroke + shadow: drop `.bento` and the `agentAccent` hairline. */
  framed?: boolean;
  time: string;
  /** Opens THIS agent's pane; absent makes the pill inert. Ignored on human/unstamped rows. */
  onOpenAgent?: () => void;
}) {
  const label = attributionName({ agent, agentId, authorLabel, agentName });
  const openable = agent && agentId !== null && onOpenAgent !== undefined;
  const face = cn(
    // Replaces rather than layers: `tailwind-merge` keeps both `rounded-full` and `rounded-r-none`.
    radius ?? "rounded-full",
    "inline-flex max-w-full items-center gap-2 py-1 pl-1 pr-3.5",
    !framed && "bento",
    !framed && agentId && agentAccent(agentId),
    // Neutralisers last: of `agentAccent`'s triple only the border colour survives.
    "bg-bg-elevated text-text-primary",
    // No hover lift here: `authored-row.tsx › ACCENT_FRAME` owns it, and every openable pill is
    // framed (`agentBoxOf` ⊇ openable) — a second transform would double it.
    openable && "cursor-pointer text-left"
  );
  const body = (
    <>
      <Avatar person={author} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* `wrap-anywhere`: an unbroken name must not size the pill past the pane. */}
          <span className="wrap-anywhere text-body font-semibold leading-tight">{label}</span>
          {agent && <AgentChip paint={agentPaint} external={external} />}
        </span>
        <span className="text-micro leading-tight text-text-muted">{time}</span>
      </span>
    </>
  );

  /* `data-attribution-pill` is a styling hook the `[data-frame-skin]` rule selects on
     (docs/DESIGN-SYSTEM.md); both elements carry it. */
  if (openable) {
    return (
      <button
        type="button"
        data-agent-id={agentId ?? undefined}
        data-attribution-pill=""
        /* `label` is the display name, never the raw id. */
        aria-label={`Open agent ${label}`}
        onClick={onOpenAgent}
        className={face}
      >
        {body}
      </button>
    );
  }
  return (
    <span data-agent-id={agentId ?? undefined} data-attribution-pill="" className={face}>
      {body}
    </span>
  );
}
