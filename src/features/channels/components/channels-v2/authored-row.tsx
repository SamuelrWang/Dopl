"use client";

/**
 * Channels v2 — THE SHELL EVERY AUTHORED ROW SHARES, split out of `transcript.tsx` on
 * 2026-08-28 when that file crossed the 500-line cap (INVARIANTS §1).
 *
 * ⚠ THE SEAM IS THE SHARING, NOT THE LINE COUNT. `transcript.tsx › Message` and
 * `thread-card-row.tsx › ThreadCardMessage` are its two consumers, and once those two live
 * in different files the shell cannot stay inside either without the other importing THROUGH
 * it — a cycle, and a file that changes for two reasons. It moved VERBATIM; nothing about
 * the row's behaviour changed in the move.
 */

import { cn } from "@/shared/lib/utils";
import { AttributionPill } from "./attribution-pill";
import type { MessageRow } from "./view-model-rows";

/**
 * The shell every authored row shares: the ATTRIBUTION PILL as the group header,
 * the body blocks under it, and the side.
 *
 * ⚠ THE HEADER IS A PILL AND THE AVATAR MOVED INSIDE IT (Samuel, 2026-08-22).
 * The `w-10` avatar gutter and the baseline name/chip/time row are GONE:
 * `attribution-pill.tsx › AttributionPill` carries avatar + name + time as one
 * capsule, and the message blocks stack BELOW it at full column width. That
 * changes the row from a horizontal pair into a column, so **the side is now
 * `items-end` / `items-start` on this element rather than `flex-row-reverse`** —
 * the RULE is unchanged (INVARIANTS §5: `authorUserId === currentUserId`), only
 * the axis it is expressed on. The bodies keep their own `items-end`, which is
 * what `MESSAGE_BLOCK`'s 92% cap gives them something to pull against.
 *
 * ⚠ A CONTINUATION STILL DROPS THE HEADER, and now drops NO indent with it.
 * Under the gutter layout a continuation had to keep a `w-10` spacer or it lined
 * up left of the row it continued; with the pill above the body, the first row's
 * body starts at the same edge a continuation's does, so the spacer would be the
 * thing that misaligned them.
 */
export function AuthoredRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agent,
  agentId = null,
  agentName = null,
  continuation,
  flash,
  onOpenAgent,
  children,
}: {
  id: string;
  side: "me" | "peer";
  author: MessageRow["author"];
  authorLabel: string;
  time: string;
  agent: boolean;
  /** WHICH agent, when the writer stamped it — see `attribution-pill.tsx`. */
  agentId?: string | null;
  /** ⚠ ITS CURRENT NAME, RESOLVED BY THE CALLER from `AuthorIndex.agents` and passed in — this
   *  shell takes no index. Never a field on the row (2026-08-27). */
  agentName?: string | null;
  continuation: boolean;
  flash: boolean;
  /** ⚠ ALREADY GATED BY THE CALLER — see `Message`. This shell takes no index either. */
  onOpenAgent?: () => void;
  children: React.ReactNode;
}) {
  const mine = side === "me";
  return (
    <article
      data-message-id={id}
      className={cn(
        // The negative margin + padding pair keeps the flash tint from
        // shifting layout: the row always owns the strip it may highlight.
        "-mx-2 flex flex-col gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-700",
        mine ? "items-end" : "items-start",
        flash && "bg-link/10 duration-150"
      )}
    >
      {!continuation && (
        <AttributionPill
          author={author}
          authorLabel={authorLabel}
          agent={agent}
          agentId={agentId}
          agentName={agentName}
          time={time}
          onOpenAgent={onOpenAgent}
        />
      )}
      {/* ⚠ `w-full` so the column is the row's full width whatever the article's
          align-items says — the pill hugs its content, the bodies must not. */}
      <div className={cn("flex w-full min-w-0 flex-col gap-1.5", mine && "items-end")}>
        {children}
      </div>
    </article>
  );
}
