/**
 * Channels v2 — the PURE derivations behind the three columns: functions of what
 * the read hooks already return. No fetching, no React, which is what lets the
 * sidebar, transcript and thread list be asserted without mounting a tree.
 *
 * The BASE layer: metadata readers, roster index, presence, display names, the
 * sidebar's channel split. Built ON it — `view-model-rows.ts` (the transcript's
 * row union) and `view-model-requested.ts`; both import from here, nothing here
 * from either.
 */

import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
  parseEscalation,
  parseEscalationAnswer,
  type ChannelEscalation,
  type ChannelEscalationAnswer,
} from "../../escalation";
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
 * ⚠ Deliberately a LOCAL reader, not an import from the session-card machinery,
 * which was DELETED in wiring plan Phase 5 (2026-08-18). The `metadata.taskId`
 * key is the storage-boundary name (INVARIANTS §5).
 */
export function threadIdOf(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The REQUEST FAN-OUT group a thread's opening message belongs to, or null.
 *
 * ⚠ Reserved, server-stamped metadata (`server/service-writes-metadata.ts ›
 * resolvePostMetadata`) — a caller-settable group id would let a member draw
 * their own thread inside somebody else's request.
 *
 * ⚠ Absent means "a group of one", never "unknown" — one thread, one card.
 */
export function fanoutGroupOf(message: ChannelMessage): string | null {
  const value = message.metadata.fanoutGroup;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * THE STRUCTURED ESCALATION on a message, or `null` for every other row.
 *
 * ⚠ RESERVED, SERVER-STAMPED metadata (`server/service-writes-metadata.ts ›
 * resolvePostMetadata`, fold 10) — a caller-settable value would let any member
 * hang a working control, and a wake behind it, off any words at all.
 *
 * ⚠ `null` IS THE ORDINARY ANSWER: the caller renders the row's BODY, which
 * carries the same four fields in prose (`escalation.ts › escalationBody`).
 * §8's stale-cache rule holds by construction — it reads `message.metadata[key]`,
 * never a nested field.
 */
export function escalationOf(message: ChannelMessage): ChannelEscalation | null {
  return parseEscalation(message.metadata[ESCALATION_METADATA_KEY]);
}

/** THE ANSWER on a message, or `null`. Same reserved terms, same never-throws
 *  parse; `agentId` on it is the server's derivation and is never rendered. */
export function escalationAnswerOf(
  message: ChannelMessage
): ChannelEscalationAnswer | null {
  return parseEscalationAnswer(message.metadata[ESCALATION_ANSWER_METADATA_KEY]);
}

/** The people-lookup the rows are built against. */
export interface AuthorIndex {
  currentUserId: string;
  byId: ReadonlyMap<string, ChannelMember>;
  /**
   * MY OWN LIVE AGENTS, by instance id — what each is CALLED right now and what it is FOR
   * (2026-08-27, Samuel's rename-propagation ruling).
   *
   * ⚠ RESOLVED AT RENDER, NEVER STAMPED AT SEND: a name is machine-local (`main/agent-names.js`)
   * and mutable, and no message row carries one. The fix for "a rename does not reach the chat
   * area" — `attribution-pill.tsx › attributionName` had hardcoded `Agent #<id>`, which is also
   * what an empty map (web tree, pop-out — no desktop feed) still reads.
   */
  agents: ReadonlyMap<string, AgentIdentity>;
}

/** What the operator calls one of their agents, and what they said it is for. Both `null` when
 *  never set — the ordinary case, and the caller renders the ABSENCE (INVARIANTS §11). */
export interface AgentIdentity {
  displayName: string | null;
  description: string | null;
  /**
   * HAS THIS SESSION STOPPED — decides whether its handle still TINTS (Samuel, 2026-09-06: an
   * un-highlighted tag is how a reader learns nobody is there).
   *
   * ⚠ **THE ROW STAYS IN THIS MAP EITHER WAY** — ended agents are kept for ATTRIBUTION
   * (`transcript.tsx`'s openable gate is `index.agents.has(...)`). Only the HANDLE namespace
   * narrows: {@link addressableAgents} in `lib/agent-mentions.ts`.
   *
   * ⚠ **A BOOLEAN, NEVER THE THREE-VALUED `state`, BECAUSE THIS RIDES THE MEMO KEY** —
   * `working` ⇄ `idle` churn must not move it (the 2026-08-28 re-render fix); ending is
   * terminal. ⚠ **ABSENT IS NOT ENDED**: a host with no `state` on its rows reads live.
   */
  ended?: boolean;
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
 *  ⚠ CONTROL CHARACTERS ON PURPOSE, not `|` or `:`. A display name is operator prose, so any
 *  printable delimiter is forgeable (`"a"` + `"|b"` vs `"a|"` + `"b"`). These two are refused at
 *  the WRITE end by `main/agent-names.js › sanitizeName` and `› sanitizeDescription`. */
const KEY_FIELD_SEP = "\u0000";
const KEY_ROW_SEP = "\u0001";

/**
 * THE IDENTITY CONTENT OF AN AGENT INDEX, as one comparable string.
 *
 * ⚠ THE FEED IS PACED BY TELEMETRY AND THIS INDEX HOLDS ONLY NAMES — a rename or a describe moves
 * this string; `lastActivityAt` / `tokensSpent` / `contextUsed` do not. Whole argument:
 * `derivations.ts › useChannelsV2Derivations`, its only caller.
 */
export function agentIndexKey(agents: ReadonlyMap<string, AgentIdentity>): string {
  const parts: string[] = [];
  for (const [agentId, identity] of agents) {
    parts.push(
      [
        agentId,
        identity.displayName ?? "",
        identity.description ?? "",
        // ⚠ IT MUST RIDE THE KEY OR THE ROUND TRIP DROPS IT (a dead agent's tag tinting again) —
        // the transcript's map is rebuilt FROM this string. Churn-safe: {@link AgentIdentity.ended}.
        identity.ended ? "1" : "",
      ].join(KEY_FIELD_SEP)
    );
  }
  return parts.join(KEY_ROW_SEP);
}

/**
 * {@link agentIndexKey}'S INVERSE — the map back out of the key.
 *
 * ⚠ THE PAIR MAKES THE MAP'S IDENTITY A FUNCTION OF ITS CONTENT — the fix `derivations.ts ›
 * useChannelsV2Derivations` describes: a `useMemo` keyed on that string is referentially stable
 * across telemetry pushes that touched no name, with no render-phase cache (`react-hooks/refs`
 * forbids those). An empty key is {@link NO_AGENTS}, the shared instance.
 */
export function agentIndexFromKey(key: string): ReadonlyMap<string, AgentIdentity> {
  if (key === "") return NO_AGENTS;
  const out = new Map<string, AgentIdentity>();
  for (const row of key.split(KEY_ROW_SEP)) {
    const [agentId, displayName, description, ended] = row.split(KEY_FIELD_SEP);
    if (!agentId) continue;
    out.set(agentId, {
      displayName: displayName || null,
      description: description || null,
      ended: ended === "1",
    });
  }
  return out;
}

/**
 * The desktop feed -> {@link AuthorIndex.agents}. ⚠ Reads off a WIDENED LOCAL type, not
 * `spa-bridge.ts › DesktopSessionSummary`: that type is the DESKTOP's to widen and this side must
 * behave against either version — the rule `agents-model.ts › agentRunningModel` follows.
 */
export function indexAgents(
  sessions: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
    /** The pill (`spa-bridge-shapes.ts › DesktopSessionSummary.state`), read ONLY for
     *  {@link AgentIdentity.ended}. Optional on the same widened-local-type rule as the rest. */
    state?: string | null;
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
      ended: session.state === "ended",
    });
  }
  return out;
}

/**
 * Presence — **THE SERVER'S VERDICT, READ OFF THE DTO** (2026-09-08, Samuel).
 *
 * ⚠ **RE-DERIVING IT HERE WAS ONE OF THE FOUR CAUSES OF THE REPORTED FLICKER.**
 * `lastSeenAt` goes stale at exactly the rate `agentOnline` does (same payload),
 * so re-deriving only re-decides an old fact on a NEWER clock; and `away` is never
 * on the wire, so a client cannot agree with the server's `online` at all.
 *
 * ⚠ **THE `lastSeenAt` ARM IS FOR ONE CASE ONLY: A STALE CACHED PAYLOAD WITH NO
 * `agentOnline` FIELD** (INVARIANTS §8) — never for a row that HAS the flag.
 * ⚠ **`now` STAYS A PARAMETER** so that arm is testable without faking a clock.
 */
export function isPresent(
  /** ⚠ WIDENED LOCAL TYPE, not `Pick<ChannelMember, …>`: `agentOnline` is
   *  non-optional in the DTO, so typing it as required would make the fallback
   *  branch unreachable to the compiler and delete it at the first cleanup. */
  member: { agentOnline?: boolean | null; lastSeenAt?: string | null },
  now: number = Date.now()
): boolean {
  if (typeof member.agentOnline === "boolean") return member.agentOnline;
  // ── stale-cache fallback only, per the docblock ──
  if (!member.lastSeenAt) return false;
  const ts = new Date(member.lastSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < PRESENCE_ONLINE_WINDOW_MS;
}

/**
 * PRESENCE FOR ONE ROSTER ROW, WITH THE VIEWER'S OWN ROW FORCED ONLINE IN THE
 * DESKTOP APP (2026-09-08, Samuel: *"slack's active versus inactive is based on
 * whether or not the user's desktop app is open and their device is on … we
 * should mirror that"*).
 *
 * ⚠ **THE APP BEING OPEN *IS* THE DEFINITION, SO THE VIEWER'S OWN DOT MUST NOT
 * BE A NETWORK ROUND TRIP** — if this SPA is rendering, the app is open and the
 * machine unlocked, so a late refetch can no longer make the operator watch
 * THEMSELF blink.
 *
 * ⚠ **DESKTOP ONLY, AND CAPABILITY-KEYED** (`isSpaRenderer()`, §7's rule — never
 * a truthiness check on `window.dopl`, whose partial legacy-wrapper form must
 * take the WEB path). ⚠ **IT LIES ABOUT NOBODY ELSE** — keyed on
 * `index.currentUserId`, one row.
 */
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

/**
 * THE VIEWER AS AN `AvatarPerson`, RESOLVED OFF THE TRANSCRIPT THEY ARE ALREADY
 * READING (Samuel, 2026-08-27 — the agent stream's own turns wear their face).
 *
 * ⚠ IT IS THE TRANSCRIPT AND NOT THE ROSTER: its two callers — `agent-panel.tsx`
 * and `agent-window.tsx` — hold `messages` and no roster, so a roster read there
 * would be a new fetch and a new way for a pop-out to disagree with the page.
 *
 * ⚠ `null` IS "CANNOT SAY", AND THE CALLER MUST RENDER IT AS ABSENCE
 * (INVARIANTS §11 — unknown is not empty).
 *
 * ⚠ THE NAME COMES ONLY FROM A `user` ROW: `authorName` on an AGENT row is the
 * agent's display and would give the wrong initial. The avatar URL is safe from
 * either, hydration being by user id.
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

/**
 * An `AvatarPerson` for a message author, from the roster when it is there and
 * from the message's own hydrated display fields when it is not (a departed
 * member still owns their history).
 *
 * ⚠ MOVED HERE FROM `view-model-rows.ts` ON 2026-08-31, when the escalation card
 * split that file at the §1 cap — which is what lets `view-model-escalation.ts`
 * build a row without importing back through the rows module (a cycle).
 */
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

/** "You" for the viewer, else the roster name, else whatever the row carried.
 *  Moved here with {@link personFor}, for the same reason. */
export function labelFor(message: ChannelMessage, index: AuthorIndex): string {
  if (message.authorUserId === index.currentUserId) return "You";
  const member = message.authorUserId
    ? index.byId.get(message.authorUserId)
    : undefined;
  return (
    member?.displayName ?? member?.email ?? message.authorName ?? "Member"
  );
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
  // ⚠ `??` IS NOT ENOUGH. Both fields are free text a profile may legitimately
  // carry BLANK, and `""` is not nullish — so `displayName ?? email ?? ""` kept
  // the empty string and the row rendered as NOTHING: a party silently missing
  // from a thread's byline. Pick the first source that actually SAYS something,
  // and only then shorten it.
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
