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
 * Consent request kind. `inbound` = a teammate's agent addressed the operator
 * and the operator must Allow / Deny before their machine spawns; `outbound` =
 * the operator's own agent drafted a reply awaiting Send / Cancel.
 */
export type ConsentKind = "inbound" | "outbound";

/**
 * Consent request lifecycle. `pending` awaits a decision; `allowed` / `denied`
 * are human decisions; `auto_allowed` was resolved by a standing trust rule;
 * `expired` elapsed unanswered.
 */
export type ConsentStatus =
  | "pending"
  | "allowed"
  | "denied"
  | "expired"
  | "auto_allowed";

/**
 * Which surface recorded a HUMAN decision, persisted into `decided_by`. Desktop
 * dialog and web card are equal peers, so audit must distinguish them. `trust`
 * is server-written for a standing-rule auto-allow, never caller-supplied.
 */
export type ConsentDecisionSurface = "web" | "desktop";

/**
 * Listener state a heartbeat reports. Closed set (schema + DB CHECK).
 * `listening` is the desktop's steady state; rest reserved so richer states
 * need no migration.
 */
export type AgentPresenceStatus = "listening" | "busy" | "paused" | "offline";

/**
 * SESSION RUN STATE. The three states desktop `session-summary.js` reduces
 * every engine phase/activity to, and the ONLY vocabulary session state is ever
 * reported in — over IPC to the **Agents tab** (`components/channels-v2/
 * agents-tab.tsx`, INVARIANTS §5), over MCP to an external agent. ⚠ The TYPE
 * name is still `SessionPillState` and the desktop reducer's is still
 * `pillState`: the web's session PILLS were deleted in wiring plan Phase 5
 * (2026-08-18) and the names outlived them on the desktop side.
 *
 * ⚠ No `thinking` state, and NOT because streaming is off (F-146 corrected that
 * wrong reason in four places) — `session-chrome.js#thinkingVisible` renders a
 * Thinking chip with no stream. What blocks the PILL is its INPUT: `pillState`
 * sees only the reducer's `{ phase, activity, parked }`, never what has been
 * RENDERED this turn. A fourth state needs that lifted into the reducer.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * One live (or just-ended) session, as answered by
 * `dopl_channel(op="read_sessions")`. Server-visible projection of desktop
 * `session-summary.list()` — ⚠ the SAME derivation the pills use, lifted, never
 * a second one (F-142).
 *
 * Delivery: desktop pushes ON STATE CHANGE (not heartbeat) into
 * `channel_sessions`; the read is scoped to the caller's own sessions. See
 * `session-state-service.ts`.
 */
export type ChannelSessionState = {
  channelId: string;
  threadId: string | null;
  /** Friendly handle (flint / onyx / …) the pills show. */
  name: string;
  state: SessionPillState;
  /** ⚠ Counterparty-influenced display text — neutralized before storage. */
  channelName: string | null;
  threadTitle: string | null;
  updatedAt: string;
};

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
 * A human-in-the-loop consent request: `inbound` (Allow / Deny before the
 * operator's machine spawns) or `outbound` (Send / Cancel before the operator's
 * agent's reply leaves the machine). A server-side row so either surface (web
 * or desktop) can answer it.
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

/** A per-teammate standing-consent rule ("always allow Alice's agent"). */
export type AgentTrustRule = {
  id: string;
  operatorUserId: string;
  trustedUserId: string;
  workspaceId: string;
  createdAt: string;
  /** Hydrated trusted-teammate display for the settings list. */
  trustedName: string | null;
  trustedEmail: string | null;
  trustedAvatarUrl: string | null;
};

// `AwaitResult` (long-poll) is an MCP/SDK shape and lives in
// `packages/dopl-client/src/channel-types.ts`, where its only callers are.
