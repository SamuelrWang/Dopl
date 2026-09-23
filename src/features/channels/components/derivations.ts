"use client";

/** Channels — everything the three columns render that is a pure function of the read hooks.
 *  A hook only for `useMemo`; it fetches nothing and holds no state. */

import { useMemo } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { agentIndexFromKey, agentIndexKey, indexAgents, indexMembers } from "./view-model";
import { recentAgentsAddressedBy } from "../lib/agent-post-stamp";
import { channelRows, threadRows } from "./view-model-rows";
import { unfoldedMessages, withArtifactCards } from "./view-model-artifacts";
import { sidebarThreads } from "./view-model-requested";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelReadEntry,
  ChannelThread,
} from "../types";

export interface ChannelsDerivations {
  index: AuthorIndex;
  /** The open thread, or null when `openThreadId` is not in this channel's list. */
  openThread: ChannelThread | null;
  /** The threads the sidebar may nest under the open channel. */
  treeThreads: ChannelThread[];
  /** The center pane's rows — the thread's own transcript, or the channel's. */
  rows: TranscriptRow[];
  /** The agents this user last addressed, most recent first — the composer's RR3 default. */
  recentAgentIds: string[];
}

export function useChannelsDerivations({
  members,
  currentUserId,
  messages,
  entries = null,
  threads,
  openThreadId,
  agentSessions = null,
  peerSessions = null,
}: {
  members: ChannelMember[];
  currentUserId: string;
  messages: ChannelMessage[];
  /** The folded (artifact) rendering, or null when nothing is folded. When set it must be total
   *  over `messages` — rows come from `unfoldedMessages(entries)` alone, so a missing message
   *  silently vanishes; build it only via `lib/message-window.ts › mergeEntries`. */
  entries?: ChannelReadEntry[] | null;
  threads: ChannelThread[];
  /** The thread the operator asked for; resolved against `threads`. */
  openThreadId: string | null;
  /** This machine's agents (`null` = no desktop feed), retained ended sessions included for
   *  attribution; `state` is read only for "has it ended". */
  agentSessions?: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
    state?: string | null;
  }> | null;
  /** Other members' agents from the server projection; `name` is the agent id. */
  peerSessions?: ReadonlyArray<{
    name?: string | null;
    displayName?: string | null;
    /** Server-assigned colour key; `unknown` for `view-model.ts › indexAgents`' reason. */
    color?: unknown;
  }> | null;
}): ChannelsDerivations {
  // Memoised on the feeds' identity content, not their arrays: telemetry alone pushes a new
  // array ~5×/s. The key round trip keeps `agents` stable until a name, end or colour moves.
  const agentKey = useMemo(
    () =>
      agentIndexKey(
        indexAgents([
          // Peers first, own last: last write wins, and the local name and liveness are fresher.
          ...(peerSessions ?? []).map((p) => ({
            agentId: p.name,
            displayName: p.displayName,
            // Only the server assigns colours, own agents included (`indexAgents` carries it over).
            color: p.color,
          })),
          ...(agentSessions ?? []),
        ])
      ),
    [agentSessions, peerSessions]
  );
  const agents = useMemo(() => agentIndexFromKey(agentKey), [agentKey]);
  const index = useMemo(
    () => indexMembers(members, currentUserId, agents),
    [members, currentUserId, agents]
  );
  // Derived, never stored: a thread id not in this channel's list is a stale pick → channel view.
  const openThread = openThreadId
    ? (threads.find((t) => t.id === openThreadId) ?? null)
    : null;
  const treeThreads = useMemo(() => sidebarThreads(threads), [threads]);

  // The thread view never folds: the server refuses to fold a read that names messages
  // (`server/service-artifacts.ts › readNamesMessages`), so a thread page has `entries === null`.
  const rows = useMemo(
    () =>
      openThread
        ? threadRows(messages, openThread.id, index, formatChannelTimestamp)
        : entries
          ? // Unfolded arms only — the full page would redraw folded messages under their card.
            withArtifactCards(
              channelRows(
                unfoldedMessages(entries),
                threads,
                index,
                formatChannelTimestamp
              ),
              entries,
              messages,
              index,
              formatChannelTimestamp
            )
          : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, entries, threads, openThread, index]
  );

  // The server's routing runs the same rule, so the composer's line names the agent the stored
  // verdict will (`draft-reach-parity.test.ts`). Needs `authorKind` on `messages` (F-704).
  const recentAgentIds = useMemo(
    () => recentAgentsAddressedBy(currentUserId, messages),
    [currentUserId, messages]
  );

  return { index, openThread, treeThreads, rows, recentAgentIds };
}
