/**
 * ROOMS — the thread list as a persistent sidebar section.
 *
 * A breakout room IS a thread with a participant set (see
 * `docs/MULTIPLAYER-PLAN.md`); this module holds the two pure rules the sidebar
 * states: OPEN rooms come first, and a room says how many participants it has
 * WHEN it has them.
 *
 * PARTICIPANTS ARE READ DEFENSIVELY. The READ paths return
 * {@link ChannelThreadDetail} (row + `participants`), but the WRITE paths
 * (create / close / set mode / reopen) return the bare {@link ChannelThread},
 * and a room list can hold either. Rather than make every caller distinguish
 * "no participants" from "not loaded", the sidebar asks this module and gets
 * `[]` for both — a room with no readable set simply shows no count.
 */

import type { ChannelThread, ChannelThreadDetail, ThreadParticipant } from "../types";

function isParticipantLike(value: unknown): value is ThreadParticipant {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "user" || kind === "agent";
}

/**
 * The thread's participant set, or `[]`. Never throws on a shape it did not
 * expect: participants are a display detail, and a room with an unreadable set
 * simply shows no count.
 */
export function readThreadParticipants(
  thread: ChannelThread
): ThreadParticipant[] {
  const raw = (thread as Partial<ChannelThreadDetail>).participants;
  return Array.isArray(raw) ? raw.filter(isParticipantLike) : [];
}

/** "3 participants" / "1 participant", or null when the room has no set. */
export function participantCountLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} participant${count === 1 ? "" : "s"}`;
}

/**
 * Open rooms above closed ones, each group keeping the order it arrived in
 * (the server returns `created_at DESC`, so newest-first survives inside both
 * groups). A stable partition, not a re-sort: nothing else about the order is
 * this module's to decide.
 */
export function sortRoomThreads(threads: readonly ChannelThread[]): ChannelThread[] {
  const open: ChannelThread[] = [];
  const closed: ChannelThread[] = [];
  for (const thread of threads) {
    (thread.status === "open" ? open : closed).push(thread);
  }
  return [...open, ...closed];
}
