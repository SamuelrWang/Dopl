/**
 * Channels feature — camelCase domain types.
 *
 * CHANNEL (or DM) holds many THREADS. A THREAD is one SHARED exchange between
 * two members — both see the same title and status. A SESSION is ONE member's
 * agent run working a thread on THAT member's machine; each side has its own,
 * a session pauses/resumes, a thread does not. You never see the peer's
 * session, only the messages it sends.
 *
 * Unlike chats (private per-owner archive), a channel has explicit membership:
 * PUBLIC = any workspace member, PRIVATE = members only.
 *
 * ⚠ BOUNDARY — wire/storage name `task` == domain name `thread`. The
 * `channel_tasks` table, the `metadata.taskId` / `taskMode` / `taskCreatedBy` /
 * `taskTitle` / `taskTarget` keys, `task_*` message kinds, and the
 * `/api/channels/[channelId]/tasks/**` routes all keep the STORAGE name
 * (renaming = migration + every read/write path). Everything a human or agent
 * reads says `thread`; mapping happens in `client/api.ts` and `server/dto.ts`.
 */

/** Private = members only. Public = any workspace member can read/join. */
export type ChannelVisibility = "private" | "public";

/**
 * Rendered peer of a direct channel. ⚠ Resolved live from the roster, never
 * stored as truth — a name/avatar changes.
 */
export type ChannelDirectPeer = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** How a thread is worked: interactive (multi-turn) or autonomous. */
export type ThreadMode = "interactive" | "autonomous";

/**
 * ⚠ LEGACY AND UNREAD SINCE 2026-08-18 (wiring plan Phase 4). THREADS DO NOT
 * CLOSE — no close, no propose-then-confirm, no reopen; the operator pauses or
 * ends an AGENT. `channel_tasks.status` and its CHECK constraint survive carrying
 * rows closed before the removal (dropping the column is a migration behind a
 * desktop-floor raise, INVARIANTS §13), and this type is the projection of that
 * column. **Nothing writes it and nothing may branch on it.** A new `=== "open"`
 * filter is a bug: it hides legacy rows from a list that is supposed to hold
 * everything.
 */
export type ThreadStatus = "open" | "closed";

/** Legacy, on {@link ThreadStatus}'s terms — the outcome of a close that can no
 *  longer happen. Null on every thread opened since. */
export type ThreadOutcome = "completed" | "failed";

/**
 * A titled, mode-tagged exchange. Transcript rides on `channel_messages` via
 * `metadata.taskId = ChannelThread.id`; the `channel_tasks` row is the
 * authoritative status/mode/title store, shared by both members.
 */
export type ChannelThread = {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  /** ⚠ LEGACY, UNREAD — see {@link ThreadStatus}. Four columns, one story. */
  status: ThreadStatus;
  outcome: ThreadOutcome | null;
  mode: ThreadMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  outcomeSummary: string | null;
  /**
   * When this thread last saw real activity — the newest message tagged for it,
   * or its own `createdAt` when nobody has posted. Derived off `channel_messages`
   * by the `channel_tasks_activity` view; ⚠ NEVER `updatedAt`, whose only writer
   * is `set_mode` since close and reopen were removed (C-1).
   *
   * ⚠ ABSENT means THIS READ DID NOT DERIVE IT (a single-thread load), never
   * "no activity". Only the channel thread LIST carries it, and it is what that
   * list is ordered by and what `SIDEBAR_THREAD_ACTIVE_WINDOW_MS` is measured
   * against.
   */
  lastActivityAt?: string;
};

/**
 * A named agent of a channel: an ATTRIBUTION RECORD, nothing more. Not a
 * first-class entity — no writes, no lifecycle.
 *
 * `channel_agents` is read on ONE path: a stored message stamped with
 * `metadata.author_agent_id` renders "quartz · Ada's agent", and the handle
 * lives only here. Lifecycle columns (`status`, `engagedAt`, `engagedBy`)
 * remain in the DB but are dropped from the DTO — nothing reads them.
 */
export type ChannelAgent = {
  id: string;
  /** The member whose machine it ran on — "Your agent" / "Ada's agent". */
  ownerUserId: string;
  /** The handle as it was typed in an @-mention: `^[a-z][a-z0-9-]{1,30}$`. */
  name: string;
};

/** Channel-scoped role: the creator is `owner`, everyone added is `member`. */
export type ChannelRole = "owner" | "member";

/**
 * ⛔ REMOVED FROM THE PRODUCT (F-170). DO NOT BUILD ON THIS TYPE. No UI, not on
 * `ChannelMemberSelfUpdate`, not read in `classify` — unsettable by any route.
 *
 * Survives ONLY because `server/{dto,service-reads,service-writes-members,
 * repository}.ts` still map the column. Delete this type in the same change
 * that removes them and `channel_members.notify_scope`.
 *
 * Why it went (don't re-add from the enum alone): `'addressed'` was compared
 * nowhere and behaved as `'all'`; `'none'` silenced only the implicit
 * two-member trigger, so an addressed message still spawned a session.
 */
export type NotifyScope = "all" | "addressed" | "none";

/** Who wrote a message: a human, an agent (MCP/CLI), or the system. */
export type MessageAuthorKind = "user" | "agent" | "system";

/**
 * Tool scope a member's responding agent runs with (operator controls their own
 * machine). `full` = no restriction (default); `dopl_only` = Dopl MCP + safe
 * reads; `read_only` = no writes. Desktop maps this to the spawned session's
 * `--allowedTools`.
 */
export type AgentToolProfile = "full" | "dopl_only" | "read_only";

/**
 * Consent request kind. `outbound` = the operator's own agent drafted a reply
 * awaiting Send / Cancel, and it is the ONLY kind anything writes.
 *
 * ⚠ `inbound` IS A READ-ONLY HISTORICAL VALUE (2026-08-22, Samuel). It meant "a
 * teammate's agent addressed the operator; Allow or Deny before this machine
 * spawns", and that lane is retired: a peer's ask notifies, and the operator
 * launches a session or does not. The value stays in this union because DECIDED
 * inbound rows are KEPT for audit and `mapConsentRow` casts the column onto this
 * type — deleting it would not delete the rows, it would make them fail to type.
 * ⚠ `schema-collab.ts › ConsentCreateSchema` no longer ACCEPTS it, so a create
 * naming it is a 400. That asymmetry is the point: readable, unwritable.
 */
export type ConsentKind = "inbound" | "outbound";

/**
 * Consent request lifecycle. `pending` awaits a decision; `allowed` / `denied`
 * are human decisions; `expired` elapsed unanswered.
 *
 * ⚠ `auto_allowed` IS READ-ONLY HISTORY, on `inbound`'s terms: it was written
 * only by the standing-trust birth in `createConsentRequest`, and
 * `agent_trust_rules` is dropped (2026-08-22), so nothing can produce one. Kept
 * so a stored row still types and still lists in the audit view.
 */
export type ConsentStatus =
  | "pending"
  | "allowed"
  | "denied"
  | "expired"
  | "auto_allowed";

/**
 * Which surface recorded a HUMAN decision, persisted into `decided_by`. Desktop
 * dialog and web card are equal peers, so audit must distinguish them.
 *
 * ⚠ `decided_by` can also hold `'trust'`, which is NOT in this union and never
 * was — it was server-written at CREATE time for a standing-rule auto-allow, and
 * deliberately unacceptable from a caller. That writer is deleted (2026-08-22),
 * so the value is stored history only; the DTO types the column as
 * `string | null` for exactly this reason.
 */
export type ConsentDecisionSurface = "web" | "desktop";

/**
 * Listener state a heartbeat reports. Closed set (schema + DB CHECK).
 * `listening` is the desktop's steady state; rest reserved so richer states
 * need no migration.
 */
export type AgentPresenceStatus = "listening" | "busy" | "paused" | "offline";

/**
 * Message kind. `message` = chat; the `task_*` values are structured
 * activity events (payload in `metadata`, human-readable render in
 * `body`); `system` = joins / topic changes.
 */
export type ChannelMessageKind =
  | "message"
  | "task_started"
  | "task_progress"
  | "task_finished"
  | "task_failed"
  | "system";

/**
 * Whether a post may REACH AN AGENT.
 *  - `request` — DEFAULT: an explicit `toUserId` addresses, and that is the only
 *    thing that does. ⚠ The DM auto-address that used to fill it in was retired
 *    2026-08-18 (wiring plan Phase 3).
 *  - `chat` — human talk; DECLARES that the post is work for nobody, and never
 *    inherits an open DM thread.
 *
 * Absence means `request` and stamps NO metadata key, so existing callers' wire
 * is unchanged. `chat` + explicit address → 400 `CHANNEL_CHAT_ADDRESSED`.
 *
 * ⚠ ONE DEFINITION: `MessageIntentSchema` (`schema.ts`) validates against this
 * union and `client/api.ts` imports it — never restate the two literals.
 */
export type MessageIntent = "chat" | "request";

/** List-level channel: header + caller-relative membership + activity. */
export type Channel = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  isDirect: boolean;
  /** Resolved from the roster; null for a normal channel, which keeps its own
   *  name + hash glyph. */
  directPeer: ChannelDirectPeer | null;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  lastMessageAt: string | null;
  /** Caller-relative; null when not a member. */
  role: ChannelRole | null;
  isMember: boolean;
  lastReadAt: string | null;
  /** Message newer than the caller's `lastReadAt`. */
  unread: boolean;
  /** ⛔ Dead since F-170 — nothing sets or reads it. See `NotifyScope`. */
  myNotifyScope: NotifyScope | null;
  myAgentToolProfile: AgentToolProfile | null;
  /**
   * When the CALLER favourited this channel; null = not favourited, and null
   * for a non-member. Caller-relative like `role` and `lastReadAt` — a
   * favourite is one person's shortcut, never a property of the channel.
   *
   * ⚠ THE SIDEBAR'S FAVORITES SECTION READS THIS AND NOTHING ELSE. It rides the
   * channel list the sidebar already has, so the section costs no extra read and
   * no new endpoint.
   */
  myFavoritedAt: string | null;
  /** Members whose agent heartbeat is within PRESENCE_ONLINE_WINDOW_MS. */
  onlineMemberCount: number;
};

export type ChannelMessage = {
  id: string;
  /** Monotonic cursor — read / await paginate on `seq`. */
  seq: number;
  channelId: string;
  authorUserId: string | null;
  authorKind: MessageAuthorKind;
  kind: ChannelMessageKind;
  body: string;
  metadata: Record<string, unknown>;
  clientMsgId: string | null;
  createdAt: string;
  /** Hydrated author display (UI convenience); null for system rows. */
  authorName: string | null;
  authorAvatarUrl: string | null;
};

/**
 * A message the caller just POSTED.
 *
 * ⚠ IT CARRIED ONE NOTICE, `threadClosed`, until thread closing was removed
 * (wiring plan Phase 4, 2026-08-18) — a response-only flag, never stored, saying
 * the post had landed in a settled thread. Nothing settles a thread now. The
 * alias survives so the write path keeps a name distinct from the READ shape;
 * a future post-time notice goes here rather than into `metadata`.
 */
export type ChannelMessagePosted = ChannelMessage;

/**
 * ONE ROW OF THE TAGS (MENTIONS) INBOX — a message of this channel whose
 * server-stamped `metadata.mentionedUserIds` names the viewer, plus whether the
 * viewer has marked it read.
 *
 * ⚠ A PROJECTION, NOT A MESSAGE. It carries a clipped `snippet`, never the
 * body: the transcript row is the record and the inbox is a pointer at it. That
 * is also why `messageId` + `threadId` are the load-bearing fields — the whole
 * interaction is mark-read → navigate → scroll.
 *
 * ⚠ `read` is per-viewer and comes from `channel_mention_reads`; the UNREAD
 * COUNT is client-side arithmetic over this list and is never a second server
 * derivation (wiring plan Phase 6, design decision 3).
 */
export type ChannelMention = {
  /** The message row this mention lives in — the scroll target. */
  messageId: string;
  /** Per-channel monotonic identity; the list's order. */
  seq: number;
  channelId: string;
  /** `metadata.taskId`, or null for a channel-level post — the navigate target. */
  threadId: string | null;
  authorUserId: string | null;
  /** Display claim only, same rule as the transcript's chip (INVARIANTS §5). */
  authorKind: MessageAuthorKind;
  authorName: string | null;
  authorAvatarUrl: string | null;
  /** Preview text, CLIPPED server-side. The transcript row is the record. */
  snippet: string;
  createdAt: string;
  /** True when this viewer has marked it read. */
  read: boolean;
};

export type ChannelMember = {
  channelId: string;
  userId: string;
  role: ChannelRole;
  lastReadAt: string | null;
  /** ⛔ Dead since F-170 — nothing sets or reads it. Still scrubbed to null on
   *  non-self rows by `mapMemberRow`. See `NotifyScope`. */
  notifyScope: NotifyScope | null;
  /** ⚠ Private preference — present ONLY on the caller's own row. */
  agentToolProfile: AgentToolProfile | null;
  /** ⚠ Private preference — present ONLY on the caller's own row. The
   *  favourite-toggle PATCH echoes it back; the sidebar reads
   *  `Channel.myFavoritedAt` instead, off a list it already has. */
  favoritedAt: string | null;
  agentOnline: boolean;
  lastSeenAt: string | null;
  addedBy: string | null;
  joinedAt: string;
  /** Hydrated profile fields for the roster. */
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/**
 * A human-in-the-loop consent request: `outbound` — Send / Cancel before the
 * operator's own agent's reply leaves the machine. A server-side row so either
 * surface (web or desktop) can answer it, first answer wins.
 *
 * ⚠ A STORED ROW MAY STILL BE `inbound` (Allow / Deny before the operator's
 * machine spawned). That lane is retired (2026-08-22) and nothing raises one any
 * more, but decided rows are kept for audit and this type is what the audit read
 * returns — see {@link ConsentKind}.
 */
export type ChannelConsentRequest = {
  id: string;
  channelId: string;
  workspaceId: string;
  /** Who must decide (the recipient / operator). */
  operatorUserId: string;
  /** Inbound: who asked. Null for outbound. */
  requesterUserId: string | null;
  kind: ConsentKind;
  /** Inbound: seq of the triggering message. */
  messageSeq: number | null;
  summary: string;
  bodyPreview: string;
  /** Outbound: drafted reply awaiting Send. */
  proposedReply: string | null;
  status: ConsentStatus;
  /** 'web' | 'desktop' | 'trust'. */
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Inbound only; null for outbound. */
  requesterName: string | null;
  requesterAvatarUrl: string | null;
};

// ⚠ `AgentTrustRule` STOOD HERE AND IS DELETED (2026-08-22, Samuel). It was the
// per-teammate standing-consent rule ("always allow Alice's agent"), and it only
// ever auto-allowed an INBOUND consent request — the lane that is retired. The
// `agent_trust_rules` table goes with it
// (`20260822140000_retire_inbound_consent_and_trust.sql`), so nothing this type
// described exists: not the routes, not the service, not the repository reads,
// not the relation. It never fired in production either — the rule was on hold
// by Samuel's own ruling (INVARIANTS §6) and the settings surface that would
// have written one was never wired.

// `AwaitResult` (long-poll) is an MCP/SDK shape and lives in
// `packages/dopl-client/src/channel-types.ts`, where its only callers are.

/**
 * SESSION and LAUNCH types live in `types-sessions.ts` / `types-launch.ts`
 * (split 2026-08-22 at the 500-line cap). ⚠ Re-exported here so every existing
 * `@/features/channels/types` import is unchanged — **this file is the barrel,
 * and there is no third path to a symbol.** Same arrangement `schema.ts` has
 * with `schema-sessions.ts` / `schema-collab.ts` / `schema-launch.ts`.
 */
export type {
  SessionPillState,
  SessionDetailKey,
  ChannelSessionState,
  ChannelSessionTelemetry,
  ChannelSessionStateOwn,
} from "./types-sessions";

export type { LaunchRefusalReason, LaunchDirective } from "./types-launch";
