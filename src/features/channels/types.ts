/**
 * Channels feature — camelCase domain types.
 *
 * A CHANNEL (or DM) holds many THREADS.
 * A THREAD is ONE exchange between two members about one thing. It may be a
 * single message or a long piece of work. It is SHARED: both members see the
 * same thread, its title, and its status.
 * A SESSION is ONE member's agent run working a thread, on THAT member's
 * machine. Each side has its own session. A session pauses and resumes; a
 * thread does not. You never see the other member's session, only the
 * messages it sends.
 *
 * Distinct from chats (a private per-owner archive), a channel has an
 * explicit membership set: PUBLIC channels are visible to any workspace
 * member, PRIVATE ones only to their members.
 *
 * BOUNDARY — wire/storage name `task` == domain name `thread`. The
 * `channel_tasks` table and its columns, the `metadata.taskId` / `taskMode` /
 * `taskCreatedBy` / `taskTitle` / `taskTarget` wire keys, the `task_*` message
 * kinds, and the `/api/channels/[channelId]/tasks/**` route paths all keep the
 * storage name deliberately (renaming them means a migration plus every read
 * and write path). Everything a human or an agent reads says `thread`; the
 * mapping happens at the client boundary (`client/api.ts`) and in the server
 * DTO mappers (`server/dto.ts`).
 */

/** Private = members only. Public = any workspace member can read/join. */
export type ChannelVisibility = "private" | "public";

/**
 * The rendered peer of a direct (1:1) channel — the OTHER member, resolved
 * live from the roster (never stored as truth, since a name/avatar can
 * change). Null on a non-direct channel.
 */
export type ChannelDirectPeer = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/** How a thread is worked: interactive (multi-turn) or autonomous. */
export type ThreadMode = "interactive" | "autonomous";

/** Thread lifecycle status: open until an explicit close. */
export type ThreadStatus = "open" | "closed";

/** How a closed thread ended. Null while the thread is still open. */
export type ThreadOutcome = "completed" | "failed";

/**
 * A first-class thread inside a channel: one titled, mode-tagged, queryable
 * exchange whose transcript rides on `channel_messages`
 * (`metadata.taskId = ChannelThread.id` — the wire key keeps the storage
 * name). The `channel_tasks` row is the authoritative status / mode / title
 * store, and both members see the same one.
 */
export type ChannelThread = {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  status: ThreadStatus;
  outcome: ThreadOutcome | null;
  mode: ThreadMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** A human-readable close summary carried on the thread row; null while open
   *  or when closed without one. */
  outcomeSummary: string | null;
};

/**
 * A NAMED AGENT of a channel, as it survives the rollback: an ATTRIBUTION
 * RECORD and nothing more.
 *
 * It used to be a first-class entity — summoned by its owner, addressed by
 * handle (`@quartz`), engaged for an hour by a human, parked and renamed and
 * dismissed. All of that is gone (rollback §1) along with every write to the
 * row. `channel_agents` is now read on ONE path: a stored message stamped with
 * `metadata.author_agent_id` still has to render "quartz · Ada's agent", and
 * the handle lives only here. The lifecycle fields (`status`, `engagedAt`,
 * `engagedBy`) are dropped from the DTO because nothing reads them; the COLUMNS
 * stay, so a later cleanup migration decides their fate, not this one.
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
 * Per-member notification scope for a channel (how loudly it notifies the
 * member's desktop listener). `all` = addressed consent prompts + silent FYI
 * notifications; `addressed` = only addressed-to-me prompts; `none` = fully
 * muted (still listed and readable). An addressed consent prompt always
 * shows regardless — `none` only silences FYI + non-addressed noise.
 */
export type NotifyScope = "all" | "addressed" | "none";

/** Who wrote a message: a human, an agent (MCP/CLI), or the system. */
export type MessageAuthorKind = "user" | "agent" | "system";

/**
 * The tool scope a member's responding agent runs with in a channel (the
 * operator controls their own machine). `full` = no restriction (default,
 * preserves current behavior); `dopl_only` = only the Dopl MCP tools + safe
 * reads; `read_only` = read / safe tools only (no writes). The desktop maps
 * this to the spawned session's `--allowedTools`.
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
 * Which surface recorded a HUMAN decision, persisted into `decided_by`. The
 * desktop's native dialog and the web card are equal peers (either may answer
 * a request), so the audit trail has to distinguish them. `trust` is written
 * by the server for a standing-rule auto-allow and is never caller-supplied.
 */
export type ConsentDecisionSurface = "web" | "desktop";

/**
 * The listener state a heartbeat reports. Closed set (schema + DB CHECK):
 * `listening` is the desktop's steady state; the rest are reserved for
 * richer listener states without another migration.
 */
export type AgentPresenceStatus = "listening" | "busy" | "paused" | "offline";

/**
 * SESSION PILL STATE (rollback §3.3 / §3.5). The three states the desktop's
 * `session-summary.js` reduces every engine phase/activity to, and the ONLY
 * vocabulary a session's state is ever reported in — over IPC to the desktop
 * pills, and over MCP to an external agent asking "what is flint doing?".
 *
 * There is deliberately NO `thinking`. ~~It needs streaming
 * (`includePartialMessages`), which is off.~~ **Corrected by F-146** — that
 * reason was wrong here as it was in three other places, and this copy was
 * missed. The session WINDOW already renders a Thinking chip with no stream at
 * all (`session-chrome.js#thinkingVisible`). What blocks the PILL is its INPUT:
 * `pillState` sees only the reducer's `{ phase, activity, parked }`, never what
 * has been RENDERED for the current turn. A fourth state needs that fact lifted
 * into the reducer, not a stream.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * ONE LIVE (or just-ended) session of a member's, as answered over MCP by
 * `dopl_channel(op="read_sessions")` (rollback §3.5, read-session-state). It is
 * the server-visible projection of the desktop's `session-summary.list()` shape
 * — the SAME derivation the pills use, lifted to the server so an external
 * agent can read it (F-142: "phase 5 lifts the same list() to MCP and adds no
 * second derivation").
 *
 * DELIVERY: the desktop pushes these rows to the server ON STATE CHANGE (not a
 * heartbeat) into `channel_sessions`; the read is scoped to the caller's own
 * sessions. See `session-state-service.ts`.
 */
export type ChannelSessionState = {
  channelId: string;
  /** The thread (task) this session is working, or null for one with none. */
  threadId: string | null;
  /** The friendly handle (flint / onyx / …) the pills show for this session. */
  name: string;
  state: SessionPillState;
  /** Counterparty-influenced display text, neutralized before storage. */
  channelName: string | null;
  threadTitle: string | null;
  /** When the desktop last reported a change for this session. */
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
 * Whether a post is allowed to REACH AN AGENT.
 *
 *  - `request` — the DEFAULT and the whole of today's behaviour: a post into a
 *    DM with no `to` is auto-addressed to the peer server-side, which is what
 *    makes a reply deliverable and what wakes the receiving listener.
 *  - `chat` — HUMAN TALK. The auto-address is skipped entirely, so nothing is
 *    manufactured for the far side to read as an ask. Everything else about the
 *    message is normal.
 *
 * ABSENCE means `request`, and an absent field stamps NO metadata key — so an
 * existing caller's wire is unchanged. `chat` beside an explicit address is a
 * contradiction and is refused 400 `CHANNEL_CHAT_ADDRESSED`.
 *
 * ONE DEFINITION. `MessageIntentSchema` (`schema.ts`) validates against this
 * union and `client/api.ts` imports it; do not restate the two literals.
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
  /** True for a direct (1:1) channel between exactly two members. */
  isDirect: boolean;
  /** The rendered peer for a direct channel (resolved from the roster); null
   *  for a normal channel, which keeps its own name + hash glyph. */
  directPeer: ChannelDirectPeer | null;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Count of members. */
  memberCount: number;
  /** ISO datetime of the latest message, null when the channel is empty. */
  lastMessageAt: string | null;
  /** The caller's channel role, null when they are not a member. */
  role: ChannelRole | null;
  /** True when the caller is a channel member. */
  isMember: boolean;
  /** The caller's last-read watermark, null when never read / not a member. */
  lastReadAt: string | null;
  /** True when there is a message newer than the caller's `lastReadAt`. */
  unread: boolean;
  /** The caller's own notification scope, null when they are not a member. */
  myNotifyScope: NotifyScope | null;
  /** The caller's own agent tool profile, null when they are not a member. */
  myAgentToolProfile: AgentToolProfile | null;
  /** Members whose agent is currently online (last heartbeat < 90s ago). */
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
 * A message the caller just POSTED, plus the notices that write raised. F6's
 * `threadClosed` is the first and only one.
 *
 * RESPONSE-ONLY, and never stored: nothing about the message is different for
 * having landed in a closed thread — the post is accepted, exactly as before —
 * so this rides beside the row rather than inside `metadata`. It is present only
 * when TRUE, which keeps every existing post's shape unchanged, and it never
 * appears on a READ: `mapMessageRow` has no idea a thread was ever closed.
 */
export type ChannelMessagePosted = ChannelMessage & {
  /** True when the post landed in a thread whose row is no longer open. */
  threadClosed?: true;
};

export type ChannelMember = {
  channelId: string;
  userId: string;
  role: ChannelRole;
  lastReadAt: string | null;
  /** Per-channel notification scope. Private preference: present only on the
   *  caller's own row; null for other members. */
  notifyScope: NotifyScope | null;
  /** The member's responding-agent tool profile. Private preference: present
   *  only on the caller's own row; null for other members. */
  agentToolProfile: AgentToolProfile | null;
  /** True when this member's agent last sent a heartbeat < 90s ago. */
  agentOnline: boolean;
  /** ISO datetime of this member's agent's last heartbeat, null if never. */
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
  /** Who / whose agent asked (inbound); null for outbound. */
  requesterUserId: string | null;
  kind: ConsentKind;
  /** Inbound: the seq of the triggering message. */
  messageSeq: number | null;
  summary: string;
  bodyPreview: string;
  /** Outbound: the drafted reply awaiting Send. */
  proposedReply: string | null;
  status: ConsentStatus;
  /** Which surface / rule resolved it: 'web' | 'desktop' | 'trust'. */
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Hydrated requester display for the card (inbound); null for outbound. */
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

// `ChannelDetail` (header + transcript) and `AwaitResult` (long-poll result) lived here and had
// zero readers on the web side — the detail read hands back the two halves separately, and the
// long poll is an MCP/SDK shape, still declared in `packages/dopl-client/src/channel-types.ts`
// where its only callers are.
