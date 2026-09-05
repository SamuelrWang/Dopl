import "server-only";
import type { ChannelMessage, ChannelMessagePosted } from "../types";
import { mapMessageRow, type ChannelMessageRow } from "./dto";
import { profilesById } from "./service-shared";

/**
 * **THE SHAPE OF A WRITE'S ANSWER** — the stored row, hydrated, and the one
 * notice a post-time result may carry (§1 split, 2026-09-04).
 *
 * ⚠ ITS OWN FILE BECAUSE `service-writes.ts` REACHED THE 500-LINE CAP, and the
 * seam is real: everything here changes when what a WRITE HANDS BACK changes,
 * and that file when the write RULES do. Same arrangement `service-writes.ts` /
 * `service-writes-direct.ts` already have; this is a leaf with no caller of its
 * own outside that file.
 */

/**
 * **AN ACK THAT SAYS THE WRITE CONVERGED** (2026-09-04).
 *
 * ⚠ **IT EXISTS BECAUSE THE TWO ACKS WERE INDISTINGUISHABLE.** A converged
 * retry returns the STORED row and writes nothing, with a success shape
 * identical to a first post — so the agent's own transcript showed the 3:48 PM
 * message posted twice over one row (seq 963). "Did my message land once or
 * twice" is not a question a caller can answer from the row: the seq is the
 * same, the id is the same, and both calls returned `ok`.
 *
 * ⚠ **A NOTICE ABOUT THE CALL, NOT A COLUMN.** Nothing is written and nothing is
 * stored; a later `read` of the same message carries no such key. That is why it
 * lives on `ChannelMessagePosted` — the alias kept apart from the READ shape for
 * exactly this — and never in `metadata`.
 */
export function replayOf(message: ChannelMessage): ChannelMessagePosted {
  return { ...message, replayed: true };
}

export async function hydrateOne(row: ChannelMessageRow): Promise<ChannelMessage> {
  if (!row.author_user_id) return mapMessageRow(row, undefined);
  const profiles = await profilesById([row.author_user_id]);
  return mapMessageRow(row, profiles.get(row.author_user_id));
}
