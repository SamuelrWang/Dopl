import "server-only";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import { truncatePreview } from "@/shared/lib/preview";
import type { ChannelMessage } from "../types";
import type { ChannelSessionStateOwn } from "../types-sessions";
// ⚠ THE ANSWER SHAPES LIVE IN `types-account.ts`, NOT HERE. They are read by
// the SPA (the Overview "Needs you" card) as well as by this service, and a
// `server-only` module cannot be imported from a browser bundle — see that
// file's header. Re-exported below so no existing consumer moved.
import type {
  AccountChannelStatus,
  AccountStatus,
  AccountStatusClips,
  AccountWaitingItem,
} from "../types-account";
export type {
  AccountChannelStatus,
  AccountStatus,
  AccountStatusClips,
  AccountWaitingItem,
};
import { mapOwnSessionStateRow } from "./collab-dto";
import { mapMessageRow, type ChannelMessageRow, type ProfileRef } from "./dto";
import * as accountRepo from "./repository-account";
import { fetchProfiles } from "./repository-workspace";

/**
 * **THE ACCOUNT-WIDE CHANNEL READS** — one answer across EVERY workspace and
 * EVERY home-channel container the caller belongs to (T20/T21/T22 of the MCP
 * agent-efficiency spec).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * An orchestrator's check-in used to be ~10 tool calls: a workspace list, then
 * per workspace a channel list, then per channel a read and a session list, and
 * home containers were not reachable from any of them, because the workspace
 * listing filtered them out by design (§4A — reversed by B10, which lists them
 * with their kind). This is that loop as ONE
 * server-side read with a bounded fan — the shape
 * `home/server/service-overview.ts` already uses for the /home Overview face.
 *
 * ── 🔒 THE FENCE, AND IT IS NOT `withWorkspaceAuth` ────────────────────────
 *
 * These reads span tenancies, so they cannot be workspace-scoped: that wrapper
 * resolves exactly ONE workspace and 400s a caller with 2+ standard memberships
 * (§4). They are **USER-scoped** — `withUserAuth`, no `X-Workspace-Id` — and the
 * fence is `channel_members.user_id = <caller>`, entering every query as the
 * literal `WHERE channel_id IN (…)`. That is the same fence
 * `/api/home/channels` uses and the same one `service-await-workspace.ts` uses;
 * what is dropped relative to the latter is only the `workspace_id` narrowing,
 * which never granted anything.
 *
 * ⚠ **TWO DIFFERENT LOCKS, AND ONLY ONE OF THEM IS A CONNECTION PROPERTY.**
 *   - **B3, THE CONTAINER LOCK, IS NOT APPLIED HERE AND MUST NOT BE.** A locked
 *     MCP session must see one room only, but that lock is a property of one MCP
 *     CONNECTION and not of the credential — so, exactly as for `GET
 *     /api/home/channels`, the narrowing lives in the MCP layer
 *     (`packages/mcp-server/src/tools/home-scopes.ts › narrowToLock`). A reader
 *     that calls this service and skips it has rebuilt the enumeration oracle B3
 *     exists to deny.
 *   - 🔒 **B1, `ctx.apiKeyWorkspaceId`, IS APPLIED HERE (R3, 2026-09-02).** That
 *     one IS a property of the credential — `mcp_tokens.workspace_id`, minted by
 *     `issueContainerToken` — and `withWorkspaceAuth` 403s on it everywhere
 *     else. These two routes use `withUserAuth` precisely because they span
 *     tenancies, so nothing upstream applies it and, until R3, a container-locked
 *     credential read names, telemetry and bodies out of every workspace its
 *     operator belonged to. `lockedWorkspaceId` narrows the membership PROOF, so
 *     no query downstream is ever handed an id from another tenancy.
 *
 * ⚠ **THE OPERATOR-ONLY SESSION FIELDS RIDE THIS PAYLOAD, AND THAT IS SAFE ONLY
 * BECAUSE THE READ IS OWN-SCOPED.** `mapOwnSessionStateRow` is reached from here
 * and from nowhere else in this module; a peer's session never enters it
 * (`repository-account.ts › listAccountSessionStates` fences on `user_id`). See
 * `collab-dto.ts › OPERATOR_ONLY_SESSION_COLUMNS`.
 */

/** One message on an account-wide page, tagged with where it came from. */
export interface AccountChannelMessage extends ChannelMessage {
  channelName: string;
  channelSlug: string;
  /** 🔒 The tenancy that owns the channel — the `workspace=` handle. */
  workspaceId: string;
}

export interface AccountMessagesPage {
  messages: AccountChannelMessage[];
  /** How many channels were watched. `0` is reported, never rendered as silence. */
  channelCount: number;
  /** True when the page hit its ceiling — there is more past the highest seq
   *  shown, and re-reading from it is the remedy. */
  truncated: boolean;
}

/**
 * WHAT A STATUS ANSWER IS ASKED FOR.
 *
 * ⚠ **A VIEW IS A PARAMETER, NOT A SECOND ROUTE (§9), AND THE EXPENSIVE ONE IS
 * THE DEFAULT** — nothing may get a thinner answer than it asked for.
 * `"sessions"` exists for the all-sessions read (T22), which wants the session
 * projection and none of the cursor arithmetic behind it.
 */
export type AccountStatusView = "full" | "sessions";

export interface AccountStatusOptions {
  /** Global `seq` cursor. Absent ⇒ `unread` is `null` on every row. */
  since?: number;
  view?: AccountStatusView;
  /** 🔒 `ctx.apiKeyWorkspaceId` — B1's ceiling, NEVER a request field (R3). */
  lockedWorkspaceId?: string | null;
}

const EMPTY_CLIPS: AccountStatusClips = {
  channels: false,
  unread: false,
  waiting: false,
};

/**
 * ONE READ, EVERY CHANNEL THE CALLER IS IN.
 *
 * ⚠ **A BOUNDED FAN, NEVER A QUERY PER CHANNEL.** Eight statements for any
 * number of channels and any number of workspaces: two for the membership proof,
 * then one wave of four, then a dependent wave of two. The dependent wave exists
 * because "has this been answered" needs the seq range of the addressed messages
 * before it can bound its own scan — see
 * `repository-account.ts › listMyLatestSeqByChannel`.
 */
export async function getAccountStatus(
  userId: string,
  opts: AccountStatusOptions = {}
): Promise<AccountStatus> {
  const view = opts.view ?? "full";
  const refScan = await accountRepo.listAccountChannelRefs(
    userId,
    opts.lockedWorkspaceId
  );
  const refs = refScan.rows;
  const ids = refs.map((r) => r.id);

  // ⚠ Presence is read even with no channels: "your desktop is up but you are in
  // no rooms" and "we could not tell" are different answers, and the second is
  // the one that reads as an outage.
  const [sessionRows, operatorOnline] = await Promise.all([
    accountRepo.listAccountSessionStates(userId, ids),
    accountRepo.presenceAnywhereForUser(userId, PRESENCE_ONLINE_WINDOW_MS),
  ]);
  const sessionsByChannel = groupSessions(sessionRows.map(mapOwnSessionStateRow));

  if (view === "sessions" || ids.length === 0) {
    return {
      channels: refs
        .map((ref) => bareRow(ref, sessionsByChannel.get(ref.id) ?? []))
        .sort(byNothingButName),
      operatorOnline,
      since: opts.since ?? null,
      truncated: { ...EMPTY_CLIPS, channels: refScan.truncated },
    };
  }

  const [highWater, tally, addressed] = await Promise.all([
    accountRepo.lastSeqByChannel(ids),
    opts.since === undefined
      ? Promise.resolve(null)
      : accountRepo.tallyAccountMessagesAfter(ids, opts.since, userId),
    accountRepo.listAddressedToMe(ids, userId),
  ]);

  const waitingByChannel = await resolveWaiting(addressed.rows, ids, userId);

  const channels = refs.map((ref) => ({
    channelId: ref.id,
    channelName: ref.name,
    channelSlug: ref.slug,
    workspaceId: ref.workspaceId,
    lastSeq: highWater.get(ref.id)?.seq ?? null,
    lastMessageAt: highWater.get(ref.id)?.at ?? null,
    unread: tally === null ? null : countFor(tally.rows, ref.id),
    sessions: sessionsByChannel.get(ref.id) ?? [],
    waiting: waitingByChannel.get(ref.id) ?? [],
  }));

  return {
    channels: channels.sort(byRecency),
    operatorOnline,
    since: opts.since ?? null,
    truncated: {
      channels: refScan.truncated,
      unread: tally?.truncated ?? false,
      waiting: addressed.truncated,
    },
  };
}

/**
 * NEW MESSAGES EVERYWHERE, PAST ONE CURSOR (T21).
 *
 * ⚠ **ONE CURSOR IS LEGAL BECAUSE `seq` IS A TABLE-WIDE IDENTITY** — see
 * `repository-account.ts › listAccountMessagesAfter`. The caller's OWN messages
 * are excluded, for the reason the workspace-wide await gives: an orchestrator
 * posts into many rooms and every echo would otherwise be news.
 */
export async function readAccountMessages(
  userId: string,
  opts: {
    since: number;
    limit?: number;
    /** 🔒 `ctx.apiKeyWorkspaceId` — B1's ceiling, NEVER a request field (R3). */
    lockedWorkspaceId?: string | null;
  }
): Promise<AccountMessagesPage> {
  const refScan = await accountRepo.listAccountChannelRefs(
    userId,
    opts.lockedWorkspaceId
  );
  const refs = refScan.rows;
  if (refs.length === 0) {
    return { messages: [], channelCount: 0, truncated: false };
  }
  const byId = new Map(refs.map((r) => [r.id, r]));
  const page = await accountRepo.listAccountMessagesAfter(
    [...byId.keys()],
    opts.since,
    opts.limit ?? accountRepo.ACCOUNT_MESSAGE_LIMIT,
    userId
  );
  const profiles = await profilesFor(page.rows);
  const messages = page.rows.map((row) => {
    const ref = byId.get(row.channel_id);
    return {
      ...mapMessageRow(row, profiles.get(row.author_user_id ?? "")),
      // ⚠ Non-null by construction — the read was fenced by `byId`'s key set.
      channelName: (ref as accountRepo.AccountChannelRef).name,
      channelSlug: (ref as accountRepo.AccountChannelRef).slug,
      workspaceId: (ref as accountRepo.AccountChannelRef).workspaceId,
    };
  });
  return {
    messages,
    channelCount: refs.length,
    truncated: page.truncated,
  };
}

/** Sessions keyed by channel. ⚠ Server ORDER is preserved (`updated_at DESC`) —
 *  a `Map` keeps insertion order and nothing re-sorts these by name. */
function groupSessions(
  sessions: ChannelSessionStateOwn[]
): Map<string, ChannelSessionStateOwn[]> {
  const out = new Map<string, ChannelSessionStateOwn[]>();
  for (const s of sessions) {
    const bucket = out.get(s.channelId);
    if (bucket) bucket.push(s);
    else out.set(s.channelId, [s]);
  }
  return out;
}

function bareRow(
  ref: accountRepo.AccountChannelRef,
  sessions: ChannelSessionStateOwn[]
): AccountChannelStatus {
  return {
    channelId: ref.id,
    channelName: ref.name,
    channelSlug: ref.slug,
    workspaceId: ref.workspaceId,
    lastSeq: null,
    lastMessageAt: null,
    unread: null,
    sessions,
    waiting: [],
  };
}

/** ⚠ Counted from the tally rows, never from a second query: PostgREST cannot
 *  group, and a `head: true` count per channel is the fan this read replaces. */
function countFor(
  rows: Array<{ channel_id: string }>,
  channelId: string
): number {
  let n = 0;
  for (const row of rows) if (row.channel_id === channelId) n += 1;
  return n;
}

/** Busiest first, then rooms that have never held a message, then by name. */
function byRecency(a: AccountChannelStatus, b: AccountChannelStatus): number {
  const left = a.lastSeq ?? -1;
  const right = b.lastSeq ?? -1;
  if (left !== right) return right - left;
  return a.channelName.localeCompare(b.channelName);
}

function byNothingButName(
  a: AccountChannelStatus,
  b: AccountChannelStatus
): number {
  return a.channelName.localeCompare(b.channelName);
}

/**
 * WHICH ADDRESSED MESSAGES ARE STILL OPEN.
 *
 * ⚠ **"OPEN" IS DEFINED AS "I HAVE POSTED NOTHING LATER IN THAT CHANNEL", AND
 * THE FAILURE DIRECTION IS DELIBERATE.** There is no reply EDGE on
 * `channel_messages` — a reply is an ordinary post — so a later message of the
 * caller's is the only evidence available. A clipped own-message scan therefore
 * costs an EXTRA item on the list, never a missed one, which is the direction a
 * "waiting on you" surface has to fail in.
 * ⚠ The scan is bounded from BELOW by the lowest addressed seq, so every row it
 * can return is a row that could change an answer.
 */
async function resolveWaiting(
  addressed: ChannelMessageRow[],
  channelIds: string[],
  userId: string
): Promise<Map<string, AccountWaitingItem[]>> {
  const out = new Map<string, AccountWaitingItem[]>();
  if (addressed.length === 0) return out;
  const lowest = addressed.reduce(
    (min, m) => (Number(m.seq) < min ? Number(m.seq) : min),
    Number(addressed[0].seq)
  );
  const [myLatest, profiles] = await Promise.all([
    accountRepo.listMyLatestSeqByChannel(channelIds, userId, lowest - 1),
    profilesFor(addressed),
  ]);
  // ⚠ ASCENDING inside each channel: the oldest unanswered request is the one
  // that has been waiting longest, and it is the one to read first.
  for (const row of [...addressed].reverse()) {
    const seq = Number(row.seq);
    if (seq <= (myLatest.get(row.channel_id) ?? -1)) continue;
    const metadata = row.metadata as Record<string, unknown> | null;
    const bucket = out.get(row.channel_id) ?? [];
    const profile = profiles.get(row.author_user_id ?? "");
    bucket.push({
      messageId: row.id,
      seq,
      channelId: row.channel_id,
      threadId:
        typeof metadata?.taskId === "string" ? metadata.taskId : null,
      authorUserId: row.author_user_id,
      authorName: profile?.display_name || profile?.email || null,
      preview: truncatePreview(row.body),
      createdAt: row.created_at,
      isEscalation:
        typeof metadata?.escalation === "object" && metadata.escalation !== null,
    });
    out.set(row.channel_id, bucket);
  }
  return out;
}

/** Author profiles for one page of rows — ONE bounded read, keyed by user id. */
async function profilesFor(
  rows: ChannelMessageRow[]
): Promise<Map<string, ProfileRef>> {
  const ids = [
    ...new Set(
      rows.map((r) => r.author_user_id).filter((id): id is string => id !== null)
    ),
  ];
  const profiles = await fetchProfiles(ids);
  return new Map(profiles.map((p) => [p.id, p]));
}
