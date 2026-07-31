"use client";

import type { ChannelThread } from "../types";

/**
 * Who a thread belongs to, and how the web says so.
 *
 * A THREAD is one exchange between two members: its creator and its addressee.
 * The server enforces exactly that on writes — `isThreadParticipant`
 * (`server/service-writes-metadata.ts`) throws `TaskForbiddenError` for a post
 * carrying a thread id from anyone else, even a full member of the channel.
 * READS are deliberately channel-transparent (every member sees every thread),
 * so from three members up a reader routinely looks at threads they cannot
 * write into. These two exports are the single client-side statement of that
 * rule, so the thread panel and the session card say the same thing rather than
 * each presenting a channel as if it held one pair's exchange.
 */

/**
 * True when `viewerUserId` is one of the thread's two parties. Mirrors the
 * server write gate exactly (creator OR addressee, and a null addressee matches
 * nobody). An UNKNOWN viewer (`undefined`) is not a party and must not be
 * claimed to be one — but see {@link ReadOnlyThreadBadge}: not-a-party and
 * we-don't-know-the-viewer are different states, and only the first may be
 * shown.
 */
export function isThreadParty(
  thread: Pick<ChannelThread, "createdBy" | "targetUserId">,
  viewerUserId: string | undefined
): boolean {
  if (!viewerUserId) return false;
  return (
    thread.createdBy === viewerUserId || thread.targetUserId === viewerUserId
  );
}

/**
 * The marker for a thread the viewer may read but not write into. Render it
 * ONLY when both facts are known — a first-class thread row AND the viewer's
 * id — because the alternative is a surface that looks writable and is refused
 * server-side.
 */
export function ReadOnlyThreadBadge() {
  return (
    <span
      title="You aren't in this thread. You can read it, but only its two members can post into it."
      className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-muted"
    >
      Read-only
    </span>
  );
}
