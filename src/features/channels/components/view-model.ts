/** Channels — pure base readers for the three columns (no fetching, no React). Built on by
 *  `view-model-rows.ts` and `view-model-requested.ts`; nothing here imports either. */

import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
  parseEscalation,
  parseEscalationAnswer,
  type ChannelEscalation,
  type ChannelEscalationAnswer,
} from "../escalation";
import { agentColorOrNull } from "../lib/agent-colors";
import type {
  AgentColorKey,
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/** A message's thread, or null; `metadata.taskId` is its storage key (INVARIANTS §5). */
export function threadIdOf(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A thread opener's fan-out group, or null (a group of one). Server-stamped and reserved
 *  (`server/service-writes-metadata.ts › resolvePostMetadata`), so no member can forge one. */
export function fanoutGroupOf(message: ChannelMessage): string | null {
  const value = message.metadata.fanoutGroup;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The structured escalation on a message, or null (the body carries it in prose). Reserved and
 *  server-stamped: a caller-set value would hang a working control, and a wake, off any words. */
export function escalationOf(message: ChannelMessage): ChannelEscalation | null {
  return parseEscalation(message.metadata[ESCALATION_METADATA_KEY]);
}

/** The escalation answer on a message, or null; its `agentId` is server-derived, never rendered. */
export function escalationAnswerOf(
  message: ChannelMessage
): ChannelEscalationAnswer | null {
  return parseEscalationAnswer(message.metadata[ESCALATION_ANSWER_METADATA_KEY]);
}

/** The people-lookup the rows are built against. */
export interface AuthorIndex {
  currentUserId: string;
  byId: ReadonlyMap<string, ChannelMember>;
  /** Agents by instance id (own desktop feed + peer projection); names resolve at render,
   *  never stamped at send. */
  agents: ReadonlyMap<string, AgentRosterEntry>;
}

/** An agent's name and purpose; `null` when never set — render the absence (INVARIANTS §11). */
export interface AgentRosterEntry {
  displayName: string | null;
  description: string | null;
  /** The session stopped (its handle stops tinting; the entry stays for attribution). A boolean,
   *  not `state`, because it rides the memo key; absent is live. */
  ended?: boolean;
  /** Colour key in this channel, resolved at render and never stamped on a message: it returns
   *  to the channel's bank when the session ends, so an ended agent reads `null`. */
  color?: AgentColorKey | null;
}

/** Shared empty map: `AuthorIndex` is a memo dependency, so a fresh map would re-derive rows. */
const NO_AGENTS: ReadonlyMap<string, AgentRosterEntry> = new Map();

export function indexMembers(
  members: ChannelMember[],
  currentUserId: string,
  /** Omitted by surfaces with no desktop feed (`thread-window.tsx`). */
  agents: ReadonlyMap<string, AgentRosterEntry> = NO_AGENTS
): AuthorIndex {
  return { currentUserId, byId: new Map(members.map((m) => [m.userId, m])), agents };
}

/** Control-character separators: any printable one is forgeable in a display name. The desktop
 *  refuses these at write (`main/agent-names.js › sanitizeName` / `› sanitizeDescription`). */
const KEY_FIELD_SEP = "\u0000";
const KEY_ROW_SEP = "\u0001";

/** An agent index as one comparable string, so a memo keyed on it survives telemetry pushes;
 *  fields that churn (`lastActivityAt`, `tokensSpent`, `contextUsed`) must never ride it. */
export function agentIndexKey(agents: ReadonlyMap<string, AgentRosterEntry>): string {
  const parts: string[] = [];
  for (const [agentId, entry] of agents) {
    parts.push(
      [
        agentId,
        entry.displayName ?? "",
        entry.description ?? "",
        // `ended` and `color` must ride the key: the transcript's agent map is rebuilt FROM this
        // string, and dropping them re-tints dead agents / loses colours.
        entry.ended ? "1" : "",
        entry.color ?? "",
      ].join(KEY_FIELD_SEP)
    );
  }
  return parts.join(KEY_ROW_SEP);
}

/** {@link agentIndexKey}'s inverse, so the map's identity is a function of its content without a
 *  render-phase cache (`react-hooks/refs`). An empty key is the shared {@link NO_AGENTS}. */
export function agentIndexFromKey(key: string): ReadonlyMap<string, AgentRosterEntry> {
  if (key === "") return NO_AGENTS;
  const out = new Map<string, AgentRosterEntry>();
  for (const row of key.split(KEY_ROW_SEP)) {
    const [agentId, displayName, description, ended, color] = row.split(KEY_FIELD_SEP);
    if (!agentId) continue;
    out.set(agentId, {
      displayName: displayName || null,
      description: description || null,
      ended: ended === "1",
      // Narrowed, not trusted: an unknown peer key reads as no colour, not an invisible border.
      color: agentColorOrNull(color),
    });
  }
  return out;
}

/** Agent feeds → {@link AuthorIndex.agents}, last write wins per id. A widened local type, not
 *  `spa-bridge-shapes.ts › DesktopSessionSummary`, so either desktop version works. */
export function indexAgents(
  sessions: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
    /** Read only for {@link AgentRosterEntry.ended}. */
    state?: string | null;
    /** `unknown` on purpose: a union type would make {@link agentColorOrNull}'s refusal
     *  branch look unreachable to the compiler. */
    color?: unknown;
  }> | null
): ReadonlyMap<string, AgentRosterEntry> {
  if (!sessions || sessions.length === 0) return NO_AGENTS;
  const out = new Map<string, AgentRosterEntry>();
  for (const session of sessions) {
    const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
    if (!id) continue;
    const ended = session.state === "ended";
    // A row with no colour must not clear one already indexed: the local feed (merged last)
    // carries none, and would wipe the server-assigned key of the operator's own agents.
    const carried = out.get(id)?.color ?? null;
    out.set(id, {
      displayName: session.displayName?.trim() || null,
      description: session.description?.trim() || null,
      ended,
      // An ended session's key is back in the bank, whatever the feed still reports.
      color: ended ? null : (agentColorOrNull(session.color) ?? carried),
    });
  }
  return out;
}

/** The server's `agentOnline` verdict; the `lastSeenAt` arm is only for a stale cached payload
 *  without the flag (INVARIANTS §8). */
export function isPresent(
  /** Widened local type: `agentOnline` is required in the DTO, which would hide the fallback. */
  member: { agentOnline?: boolean | null; lastSeenAt?: string | null },
  now: number = Date.now()
): boolean {
  if (typeof member.agentOnline === "boolean") return member.agentOnline;
  if (!member.lastSeenAt) return false;
  const ts = new Date(member.lastSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < PRESENCE_ONLINE_WINDOW_MS;
}

/** Presence, with the viewer's own row always online in the desktop app (the app being open is
 *  the definition). Keyed on `isSpaRenderer()`, never `window.dopl` truthiness (§7). */
export function isPresentForViewer(
  member: {
    userId: string;
    agentOnline?: boolean | null;
    lastSeenAt?: string | null;
  },
  viewerUserId: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (viewerUserId && member.userId === viewerUserId && isSpaRenderer()) {
    return true;
  }
  return isPresent(member, now);
}

/** An `AvatarPerson` for a roster row. */
export function memberPerson(member: ChannelMember): AvatarPerson {
  return {
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
  };
}

/** The viewer, read off the transcript (callers hold no roster); `null` is "cannot say"
 *  (INVARIANTS §11). The name comes only from a `user` row — an agent row's is the agent's. */
export function viewerPerson(
  messages: readonly ChannelMessage[],
  currentUserId: string
): AvatarPerson | null {
  if (!currentUserId) return null;
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.authorUserId !== currentUserId) continue;
    if (!avatarUrl) avatarUrl = message.authorAvatarUrl;
    if (!displayName && message.authorKind === "user") {
      displayName = message.authorName;
    }
    if (avatarUrl && displayName) break;
  }
  if (!avatarUrl && !displayName) return null;
  return { userId: currentUserId, email: null, displayName, avatarUrl };
}

/** An author's `AvatarPerson`: roster first, else the row's own fields (a departed member). */
export function personFor(
  message: ChannelMessage,
  index: AuthorIndex
): AvatarPerson {
  const member = message.authorUserId
    ? index.byId.get(message.authorUserId)
    : undefined;
  return {
    userId: message.authorUserId ?? `unknown-${message.id}`,
    email: member?.email ?? null,
    displayName: member?.displayName ?? message.authorName,
    avatarUrl: member?.avatarUrl ?? message.authorAvatarUrl,
  };
}

/** "You" for the viewer, else the roster name, else whatever the row carried. */
export function labelFor(message: ChannelMessage, index: AuthorIndex): string {
  if (message.authorUserId === index.currentUserId) return "You";
  const member = message.authorUserId
    ? index.byId.get(message.authorUserId)
    : undefined;
  return (
    member?.displayName ?? member?.email ?? message.authorName ?? "Member"
  );
}

/** A thread's two parties (INVARIANTS §5), via the roster; unknown ids are dropped, not faked. */
export function threadParties(
  thread: ChannelThread,
  index: AuthorIndex
): AvatarPerson[] {
  const ids = [thread.createdBy, thread.targetUserId].filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  return [...new Set(ids)]
    .map((id) => index.byId.get(id))
    .filter((m): m is ChannelMember => m !== undefined)
    .map(memberPerson);
}

/** "Diana Taylor" → "Diana T."; the viewer is always "you". */
export function shortName(person: AvatarPerson, currentUserId: string): string {
  if (person.userId === currentUserId) return "you";
  // First non-blank source: `""` is not nullish, so `??` would render nothing.
  const source = [person.displayName, person.email]
    .map((value) => (value ?? "").trim())
    .find((value) => value.length > 0);
  if (source === undefined) return "Member";
  const [first, last] = source.split(/\s+/);
  return last ? `${first} ${last.charAt(0)}.` : first;
}

/** Direct channels are the DM section; everything else is the channel tree. */
export function splitChannels(channels: readonly Channel[]): {
  direct: Channel[];
  rooms: Channel[];
} {
  return {
    direct: channels.filter((c) => c.isDirect),
    rooms: channels.filter((c) => !c.isDirect),
  };
}
