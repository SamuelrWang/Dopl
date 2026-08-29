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
  /**
   * MY OWN LIVE AGENTS, by instance id — what each is CALLED right now and what it is FOR
   * (2026-08-27, Samuel's rename-propagation ruling).
   *
   * ⚠ IT IS RESOLVED AT RENDER, NEVER STAMPED AT SEND. An agent's name is machine-local
   * (`main/agent-names.js`) and mutable, and no message row carries one — so the transcript reads
   * the CURRENT name off this map every time it draws. That is the whole fix for "a rename does
   * not reach the chat area": there was no stale cache, `attribution-pill.tsx › attributionName`
   * simply never consulted the store and hardcoded `Agent #<id>`.
   *
   * ⚠ EMPTY IS THE ORDINARY ANSWER on the web tree and in the pop-out, where there is no desktop
   * feed at all — every agent row then reads `Agent #<id>`, exactly as it always did.
   */
  agents: ReadonlyMap<string, AgentIdentity>;
}

/** What the operator calls one of their agents, and what they said it is for. Both `null` when
 *  never set — the ordinary case, and the caller renders the ABSENCE (INVARIANTS §11). */
export interface AgentIdentity {
  displayName: string | null;
  description: string | null;
}

/** ⚠ ONE EMPTY MAP, not a fresh `new Map()` per call: `AuthorIndex` is a `useMemo` dependency of
 *  the transcript's row build, and a new identity every render would re-derive every row. */
const NO_AGENTS: ReadonlyMap<string, AgentIdentity> = new Map();

export function indexMembers(
  members: ChannelMember[],
  currentUserId: string,
  /** ⚠ OPTIONAL, so the surfaces with no desktop feed (`thread-window.tsx`) are unchanged. */
  agents: ReadonlyMap<string, AgentIdentity> = NO_AGENTS
): AuthorIndex {
  return { currentUserId, byId: new Map(members.map((m) => [m.userId, m])), agents };
}

/** The field and row separators, written as ESCAPES — never as literal bytes in this file.
 *
 *  ⚠ CONTROL CHARACTERS ON PURPOSE, not `|` or `:`. An agent id is `^[a-z][a-z0-9]{7}$` but a
 *  display name is operator prose, so any printable delimiter is forgeable — `"a"` + `"|b"` and
 *  `"a|"` + `"b"` would key identically. Both of these are refused at the WRITE end by
 *  `main/agent-names.js › sanitizeName` and `› sanitizeDescription`, so no stored value can carry
 *  one and neither the key nor its inverse can be ambiguous. */
const KEY_FIELD_SEP = "\u0000";
const KEY_ROW_SEP = "\u0001";

/**
 * THE IDENTITY CONTENT OF AN AGENT INDEX, as one comparable string.
 *
 * ⚠ IT EXISTS BECAUSE THE FEED IS PACED BY TELEMETRY AND THIS INDEX HOLDS ONLY NAMES — see
 * `derivations.ts › useChannelsV2Derivations`, its only caller, which carries the whole argument.
 * What belongs here is the SHAPE: a rename or a describe moves this string, and `lastActivityAt`
 * / `tokensSpent` / `contextUsed` moving five times a second does not.
 */
export function agentIndexKey(agents: ReadonlyMap<string, AgentIdentity>): string {
  const parts: string[] = [];
  for (const [agentId, identity] of agents) {
    parts.push(
      [agentId, identity.displayName ?? "", identity.description ?? ""].join(KEY_FIELD_SEP)
    );
  }
  return parts.join(KEY_ROW_SEP);
}

/**
 * {@link agentIndexKey}'S INVERSE — the map back out of the key.
 *
 * ⚠ THE PAIR EXISTS SO THE MAP'S IDENTITY CAN BE A FUNCTION OF ITS CONTENT, which is the whole of
 * the fix `derivations.ts › useChannelsV2Derivations` describes: building the index FROM the key
 * makes a `useMemo` keyed on that string yield a referentially stable map across every telemetry
 * push that did not touch a name — with no render-phase cache, which `react-hooks/refs` forbids
 * outright.
 *
 * ⚠ AN EMPTY KEY IS {@link NO_AGENTS}, the shared instance, so the no-desktop case keeps its
 * stable identity too rather than minting an empty `Map` per render.
 */
export function agentIndexFromKey(key: string): ReadonlyMap<string, AgentIdentity> {
  if (key === "") return NO_AGENTS;
  const out = new Map<string, AgentIdentity>();
  for (const row of key.split(KEY_ROW_SEP)) {
    const [agentId, displayName, description] = row.split(KEY_FIELD_SEP);
    if (!agentId) continue;
    out.set(agentId, {
      displayName: displayName || null,
      description: description || null,
    });
  }
  return out;
}

/**
 * The desktop feed -> {@link AuthorIndex.agents}. ⚠ Reads `displayName` / `description` off a
 * WIDENED LOCAL type rather than off `spa-bridge.ts › DesktopSessionSummary`: that type is the
 * DESKTOP's to widen and this side must behave against either version of it — the same rule
 * `agents-model.ts › agentRunningModel` follows.
 */
export function indexAgents(
  sessions: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
  }> | null
): ReadonlyMap<string, AgentIdentity> {
  if (!sessions || sessions.length === 0) return NO_AGENTS;
  const out = new Map<string, AgentIdentity>();
  for (const session of sessions) {
    const id = typeof session.agentId === "string" ? session.agentId.trim() : "";
    if (!id) continue;
    out.set(id, {
      displayName: session.displayName?.trim() || null,
      description: session.description?.trim() || null,
    });
  }
  return out;
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

/**
 * THE VIEWER AS AN `AvatarPerson`, RESOLVED OFF THE TRANSCRIPT THEY ARE ALREADY
 * READING (Samuel, 2026-08-27 — the agent stream's own turns wear their face).
 *
 * ⚠ IT IS THE TRANSCRIPT AND NOT THE ROSTER, and that is the whole reason it
 * exists. The two surfaces that need it — `agent-panel.tsx` and
 * `agent-window.tsx` — both already hold `messages` and NEITHER holds a roster:
 * the window's diet is deliberately messages + consent and nothing else (its
 * docblock states it), so a roster read there would be a new fetch, a new thing
 * to keep fresh, and a new way for a pop-out to disagree with the page. The
 * hydrated author fields are keyed on `authorUserId`, so any row the viewer
 * authored carries the same profile the roster would have handed back.
 *
 * ⚠ `null` IS "CANNOT SAY", AND THE CALLER MUST RENDER IT AS ABSENCE. A viewer
 * who has never posted in this channel has no hydrated row to read; inventing a
 * placeholder face for them would be this surface claiming an identity it never
 * fetched (INVARIANTS §11 — unknown is not empty).
 *
 * ⚠ THE NAME COMES ONLY FROM A `user` ROW. `authorName` on an AGENT row is the
 * agent's display, not the operator's, and it would surface as the wrong initial
 * in the avatar's fallback. The avatar URL is safe from either, because
 * hydration is by user id.
 */
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
