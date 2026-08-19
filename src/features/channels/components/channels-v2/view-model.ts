/**
 * Channels v2 — the PURE derivations behind the three columns.
 *
 * Everything here is a function of what the existing read hooks already return
 * (`use-channels`, `use-channel-messages`, `use-channel-members`,
 * `use-channel-threads`). No fetching, no React, no formatting decisions that
 * belong to a component — which is what lets the sidebar's nesting, the
 * transcript's sides and the thread list's window be asserted without mounting
 * a tree.
 *
 * THIS file is the BASE layer the whole family shares: the two message-metadata
 * readers, the roster index, presence, the display names and the sidebar's
 * channel split. The derivations built ON it have their own files and their own
 * reason to change — `view-model-rows.ts` (the transcript's row union and its
 * builders) and `view-model-requested.ts` (which threads the viewer has been
 * asked about). Both import from here; nothing here imports from either.
 */

import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/**
 * The thread a message belongs to, or null for a channel-level post.
 *
 * ⚠ Deliberately a LOCAL three-line reader rather than an import from the
 * session-card machinery — which was DELETED in wiring plan Phase 5
 * (2026-08-18), so the call not to depend on it paid off. The `metadata.taskId`
 * key itself is the storage-boundary name (INVARIANTS §5) and is not going
 * anywhere.
 */
export function threadIdOf(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The REQUEST FAN-OUT group a thread's opening message belongs to, or null.
 *
 * ⚠ Reserved, server-stamped metadata (`server/service-writes-metadata.ts ›
 * resolvePostMetadata`), stripped from caller input like every other reserved
 * key — which is what makes it safe to render N threads as ONE card. A
 * caller-settable group id would let a member draw their own thread inside
 * somebody else's request.
 *
 * ⚠ Absent on every thread opened before the fan-out shipped, and on every
 * single-target `create_thread` (the desktop and MCP lane still post those).
 * Absent means "a group of one", never "unknown" — one thread, one card.
 */
export function fanoutGroupOf(message: ChannelMessage): string | null {
  const value = message.metadata.fanoutGroup;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The people-lookup the rows are built against. */
export interface AuthorIndex {
  currentUserId: string;
  byId: ReadonlyMap<string, ChannelMember>;
}

export function indexMembers(
  members: ChannelMember[],
  currentUserId: string
): AuthorIndex {
  return { currentUserId, byId: new Map(members.map((m) => [m.userId, m])) };
}

/**
 * Presence, computed HERE rather than read off the DTO's `agentOnline`.
 *
 * `agentOnline` is the server's verdict at READ time and goes stale between
 * refetches; the 90s window over `lastSeenAt` is arithmetic the client can redo
 * on every render (INVARIANTS §7, and the same shape `pages/channels/index.tsx`
 * documents). Fails safe in one direction only: a stale roster reads OFFLINE.
 */
export function isPresent(
  member: Pick<ChannelMember, "lastSeenAt">,
  now: number = Date.now()
): boolean {
  if (!member.lastSeenAt) return false;
  const ts = new Date(member.lastSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < PRESENCE_ONLINE_WINDOW_MS;
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

/** The two parties of a thread (INVARIANTS §5: one requester + one target),
 *  resolved through the roster; unknown ids are dropped rather than faked. */
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
  // ⚠ `??` IS NOT ENOUGH, AND THE FALLBACK IS THE WHOLE POINT. Both fields are
  // free text a profile may legitimately carry BLANK, and `""` is not nullish —
  // so `displayName ?? email ?? ""` kept the empty string, `"".split(" ")` gave
  // `[""]`, and `first ?? "Member"` never fired because `""` is not nullish
  // either. The row then rendered as NOTHING: no name, no fallback, a party
  // silently missing from a thread's byline. Pick the first source that
  // actually SAYS something, and only then shorten it.
  const source = [person.displayName, person.email]
    .map((value) => (value ?? "").trim())
    .find((value) => value.length > 0);
  if (source === undefined) return "Member";
  const [first, last] = source.split(/\s+/);
  return last ? `${first} ${last.charAt(0)}.` : first;
}

/** Direct channels are the DM section; everything else is the channel tree. */
export function splitChannels(channels: Channel[]): {
  direct: Channel[];
  rooms: Channel[];
} {
  return {
    direct: channels.filter((c) => c.isDirect),
    rooms: channels.filter((c) => !c.isDirect),
  };
}
