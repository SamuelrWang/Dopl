import type { AgentColorKey } from "@dopl/contracts";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import {
  agentDisplayName,
  agentKey,
  agentLiveness,
  ownAgentsFor,
  peerCardsFor,
  type AgentLivenessState,
} from "./agents-model";
import { ownAgentRuntime } from "./agent-face";
import type { AuthorIndex } from "./view-model";

/** One agent working a thread, as the thread card draws it. */
export interface ThreadCardAgent {
  key: string;
  name: string;
  /** "Yours" / "Grace's agent". */
  owner: string;
  photo: string | null;
  color: AgentColorKey | null;
  runtime: string | null;
  liveness: AgentLivenessState;
  /** The viewer's own agents only: a peer's agent runs on their machine, with no view to open here. */
  own: boolean;
}

/** Who the agents on a thread are, read off the viewer's feed and the peer projection. */
export interface ThreadCardAgentFeeds {
  /** This machine's feed; `null` is "could not ask" and contributes no own rows. */
  sessions: readonly DesktopSessionSummary[] | null;
  peers: readonly ChannelPeerSession[];
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "A teammate";
}

/**
 * The viewer's agents on the thread, then everyone else's, through the Agents tab's own
 * derivations (`ownAgentsFor` / `peerCardsFor`) so the card and the tab cannot disagree. `null`
 * when nothing can be said: no own feed and no peer on it is unknown, not empty (INVARIANTS §11).
 */
export function threadCardAgents(
  feeds: ThreadCardAgentFeeds,
  channelId: string,
  threadId: string,
  index: AuthorIndex
): ThreadCardAgent[] | null {
  const viewerPhoto = index.byId.get(index.currentUserId)?.avatarUrl ?? null;
  const own = ownAgentsFor(feeds.sessions ?? [], channelId, threadId).map(
    (s): ThreadCardAgent => ({
      key: agentKey(s),
      name: agentDisplayName(s),
      owner: "Yours",
      photo: viewerPhoto,
      color: (s.agentId ? index.agents.get(s.agentId)?.color : null) ?? null,
      runtime: ownAgentRuntime(s, feeds.peers),
      liveness: agentLiveness(s),
      own: true,
    })
  );
  const theirs = peerCardsFor(feeds.peers, index.currentUserId, threadId).map(
    (p): ThreadCardAgent => {
      const owner = index.byId.get(p.userId);
      return {
        key: `peer:${p.userId}:${p.name}`,
        name: p.displayName?.trim() || p.name,
        owner: `${firstName(owner?.displayName)}'s agent`,
        photo: owner?.avatarUrl ?? null,
        color: p.color ?? index.agents.get(p.name)?.color ?? null,
        runtime: p.runtime ?? null,
        liveness: agentLiveness(p),
        own: false,
      };
    }
  );
  const all = [...own, ...theirs];
  return feeds.sessions === null && all.length === 0 ? null : all;
}

/**
 * The footer's attribution. An agent posts on its operator's account (INVARIANTS §5), so the row's
 * author is always a person and only the opening message's `authorKind` says an agent wrote it.
 */
export function openedByLabel(authorLabel: string, agent: boolean): string {
  const me = authorLabel === "You";
  if (agent) return me ? "Opened by your agent" : `Opened by ${firstName(authorLabel)}'s agent`;
  return me ? "Opened by you" : `Opened by ${authorLabel}`;
}
