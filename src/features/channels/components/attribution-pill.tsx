"use client";

/**
 * Channels — the pill heading every message group: a face, then name over time. An agent wears its
 * operator's photo (INVARIANTS §5) inside its row's accent frame; a person's avatar sits on the
 * bento capsule. Display only: inputs are derived in `view-model-rows.ts › toMessageRow`.
 */

import { BadgeCheck } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { IdentityFace } from "@/shared/ui/identity-face";
import { cn } from "@/shared/lib/utils";
import { agentFaceName } from "@/shared/lib/agent-name";
import { agentAccent } from "./bits";
import type { MessageVia } from "../lib/message-via";

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

/** An outside session's provenance beside the name: the client it declared ("via <client>", the
 *  verified ones marked), else "outside session". Grey: an outside session holds no colour. */
export function ProvenanceChip({ via = null }: { via?: MessageVia | null }) {
  // Explicit height + `items-center` centres the text box at every font size.
  const shape =
    "inline-flex h-4 shrink-0 items-center justify-center rounded-full bg-bg-inset px-1.5 text-micro leading-none text-text-muted";
  if (!via) return <span className={shape}>outside session</span>;
  return (
    <span
      data-via-verified={via.verified ? "" : undefined}
      title={via.detail || undefined}
      className={cn(shape, "max-w-40 gap-0.5")}
    >
      <span className="truncate">via {via.label}</span>
      {via.verified && (
        <BadgeCheck size={10} strokeWidth={2.25} aria-label="verified" className="shrink-0" />
      )}
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
  via = null,
  agentId = null,
  agentName = null,
  radius,
  framed = false,
  time,
  onOpenAgent,
}: {
  author: AvatarPerson;
  authorLabel: string;
  /** An outside session wrote it — narrows {@link agent}, never a sibling. */
  external?: boolean;
  /** That outside session's client — see {@link ProvenanceChip}. */
  via?: MessageVia | null;
  /** Display claim off `authorKind` — never a side, never an identity. */
  agent: boolean;
  /** WHICH agent, when the writer stamped it; `null` is "cannot say". */
  agentId?: string | null;
  /** Its current operator-given name, resolved at render from `AuthorIndex.agents`. */
  agentName?: string | null;
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
    "inline-flex max-w-full items-center gap-2 pr-3.5",
    agent ? "py-1.25 pl-1.25" : "py-1 pl-1",
    !framed && "bento",
    !framed && agentId && agentAccent(agentId),
    // Neutralisers last: of `agentAccent`'s triple only the border colour survives.
    "bg-bg-elevated text-text-primary",
    // No hover lift here: `authored-row.tsx › ACCENT_FRAME` owns it, and every openable pill is
    // framed (`agentBoxOf` ⊇ openable) — a second transform would double it.
    openable && "cursor-pointer text-left"
  );
  // An agent wears its operator's photo on the neutral hairline: the frame is its one coloured line.
  const body = agent ? (
    <>
      <IdentityFace size={32} photo={author.avatarUrl} name={author.displayName ?? author.email} />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* `wrap-anywhere`: an unbroken name must not size the pill past the pane. */}
          <span className="wrap-anywhere text-lead font-semibold leading-tight">{label}</span>
          {external && <ProvenanceChip via={via} />}
        </span>
        <span className="text-micro leading-tight text-text-muted">{time}</span>
      </span>
    </>
  ) : (
    <>
      <Avatar person={author} size="px36" />
      <span className="flex min-w-0 flex-col">
        <span className="wrap-anywhere text-body font-semibold leading-tight">{label}</span>
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
