/** Split out of `service-writes-metadata.ts` (2026-09-14, 500-line cap): the two DM THREAD-INHERITANCE resolvers fold 4 spends — the pair's peer and the pair's one thread — whose behaviour is pinned by `service-writes-metadata-inherit.test.ts`. */
import "server-only";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";
import * as repoTasks from "./repository-tasks";

/**
 * Other member of a DIRECT channel, or undefined when ambiguous. A DM is exactly
 * two members; any other shape resolves to nothing rather than guessing.
 *
 * ⚠ ITS ONLY SURVIVING READER IS THREAD INHERITANCE. Until 2026-08-18 this also
 * fed DM AUTO-ADDRESS — a DM post with no caller `to` was stamped with the peer
 * — and that fallback is RETIRED (wiring plan Phase 3). Addressing is now
 * explicit at every member count, in every channel shape: a post with no `to`
 * addresses nobody, and nobody's agent is started by it. Do not reinstate the
 * fallback here; the "New agent thread" panel is the one surface that raises an
 * agent request, and it always names its addressees.
 *
 * ⚠ TAKES THE ROSTER AS A MEMOIZED LOADER rather than reading it. Mention
 * resolution (fold 9) needs the same rows, and a post that needs both must pay
 * for ONE `channel_members` read, not two — see the loader in
 * {@link resolvePostMetadata}.
 */
export async function resolveDirectPeer(
  channel: ChannelRow,
  authorUserId: string,
  roster: () => Promise<ChannelMemberRow[]>
): Promise<string | undefined> {
  if (!channel.is_direct) return undefined;
  const members = await roster();
  if (members.length !== 2) return undefined;
  const peers = members.filter((m) => m.user_id !== authorUserId);
  if (peers.length !== 1) return undefined;
  return peers[0].user_id;
}

/**
 * Single task of a direct channel whose participants are exactly {author, peer},
 * else null. All-or-nothing: with 2+ candidates a guess would attach a turn to
 * the wrong card and route it to the wrong session window on the peer's machine.
 *
 * ⚠ THE `status === "open"` FILTER IS GONE (wiring plan Phase 4, 2026-08-18).
 * Threads do not close, so the only rows it could ever exclude are legacy ones
 * closed before the removal — and excluding those makes a pair with one old
 * thread inherit nothing, which reads as inheritance being broken. The column is
 * legacy and unread; this was one of its readers.
 */
export async function resolveInheritableTask(
  channel: ChannelRow,
  authorUserId: string,
  peerUserId: string
): Promise<ChannelTaskRow | null> {
  // ⚠ Reads the ACTIVITY-ordered page (the one thread read there is). Order is
  // irrelevant here — this is an all-or-nothing match, not a pick-the-first —
  // and the bound is not a risk on this path: it runs only for a DIRECT
  // channel, i.e. one pair's threads.
  const { rows: tasks } = await repoTasks.listTasksByChannel(channel.id);
  const candidates = tasks.filter(
    (task) =>
      (task.created_by === authorUserId &&
        task.target_user_id === peerUserId) ||
      (task.created_by === peerUserId && task.target_user_id === authorUserId)
  );
  return candidates.length === 1 ? candidates[0] : null;
}
