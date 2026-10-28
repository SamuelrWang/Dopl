"use client";

/**
 * Channels — THE MESSAGE CARD both halves of an exchange wear in the agent stream: what arrived for
 * the agent (`agent-stream-inbound-box.tsx`) and what it posted (`agent-stream-sent-box.tsx`).
 *
 * A white card whose whole border line is the author's colour (DESIGN-LANGUAGE §4, Message card),
 * over a header row: the author's face, one label, the addressee pills, the time. No filled banner.
 * Full stream width rather than a chat bubble: it is a delivery record, not a conversational turn.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { IdentityFace, type IdentityFacts } from "@/shared/ui/identity-face";
import { StatusPill } from "@/shared/ui/status-pill";
import type { RecipientTag } from "../lib/recipient-tags";

/** The edge with no author to paint: an unknown kind, an uncoloured agent, a post not yet out. */
const NEUTRAL_EDGE = "var(--border-strong)";

/**
 * WHO A POSTED BOX ADDRESSED, in order. ⚠ FACES, NEVER IDS — `lib/recipient-tags.ts` resolves them
 * upstream so a raw agent id never reaches this surface (`agent-id-visibility.test.ts`). Empty draws
 * nothing, never an "unaddressed" word.
 */
function CardTags({ tags }: { tags: readonly RecipientTag[] }) {
  return tags.map((tag) => (
    <StatusPill
      key={`${tag.kind}:${tag.id}`}
      className="min-w-0 shrink font-medium text-text-primary"
    >
      <span
        // The transcript's own tag row carries the same hook: one test vocabulary for both panes.
        data-recipient-tag={tag.kind}
        title={tag.title === tag.face ? undefined : tag.title}
        className="truncate"
      >
        {tag.face}
      </span>
    </StatusPill>
  ));
}

export function StreamCard({
  edge,
  face,
  label,
  tags = [],
  at,
  children,
  ...rest
}: {
  /** The author's colour as a CSS value; `null` is the neutral hairline-strong edge. */
  edge: string | null;
  /** The author's face; absent draws none rather than a placeholder. */
  face?: IdentityFacts | null;
  label: string;
  tags?: readonly RecipientTag[];
  /** Epoch ms. `0` or absent means unreadable: the stamp drops rather than printing an epoch date. */
  at?: number;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">) {
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  return (
    <div
      {...rest}
      className="white-card min-w-0 overflow-hidden border-(length:--stroke-mark)"
      style={{ borderColor: edge ?? NEUTRAL_EDGE }}
    >
      <div className="flex min-w-0 items-center gap-1.75 px-3 pt-2.25">
        {face && <IdentityFace size={18} {...face} />}
        <span data-stream-card-label className="min-w-0 truncate text-label font-medium text-text-secondary">
          {label}
        </span>
        <CardTags tags={tags} />
        {stamp && <span className="shrink-0 text-label text-text-muted">· {stamp}</span>}
      </div>
      {children}
    </div>
  );
}
