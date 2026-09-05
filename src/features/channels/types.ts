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

// ⚠ THE ONE TYPE THIS FILE IMPORTS RATHER THAN DECLARES. The info card's shape
// and its zod schema are ONE statement (`./info-card.ts`) because the route, the
// DTO and the SPA all need the same answer; re-declaring the type here would be
// the second copy that drifts.
import type { ChannelInfoCard } from "./info-card";
// ⚠ THE DELIVERY CONTRACT AND THE CEILING LIVE IN `types-delivery.ts` (§1 split,
// 2026-09-02) and are re-exported at the foot of this file with the other four
// type modules — this file is the barrel.
import type {
  ChannelAgentPosture,
  ChannelDelivery,
  ChannelWakeVerdict,
} from "./types-delivery";
import type { Role } from "@/features/workspaces/types";

/**
 * ⚠ **THE TEN CLOSED SETS BELOW ARE DECLARED IN `@dopl/contracts › channels.ts`
 * AND RE-EXPORTED HERE UNDER THE NAMES THEY HAVE ALWAYS HAD** (2026-09-02, v2
 * slice A13). Every one of them used to be written a second time in
 * `packages/dopl-client/src/channel-types.ts` — which cannot import `src/` —
 * and `scripts/check-message-kind-drift.ts` held two of the pairs together with
 * a regex. The compiler holds all ten now.
 *
 * ⚠ **NO IMPORT PATH CHANGED AND NONE MAY.** `@/features/channels/types` is
 * still the one path to these names for the whole web tree and the SPA; the
 * package is an implementation detail of this file. Do NOT start importing
 * `@dopl/contracts` directly from a feature module — that would be a second path
 * to one symbol, which is the arrangement `types-sessions.ts` and
 * `schema-sessions.ts` both exist to avoid.
 *
 * ⚠ **WHAT DID NOT MOVE:** `NotifyScope`, `AgentToolProfile`, `ConsentKind`,
 * `ConsentStatus`, `ConsentDecisionSurface` and `AgentPresenceStatus` have no
 * SDK twin, so they were never mirrors and adding them would grow the shared
 * package for nothing.
 */
import type {
  ChannelVisibility,
  ChannelRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  MessageAuthorKind,
  PostableAuthorKind,
  ChannelMessageKind,
  PostableMessageKind,
  MessageIntent,
} from "@dopl/contracts";

export type {
  ChannelVisibility,
  ChannelRole,
  ThreadMode,
  ThreadStatus,
  ThreadOutcome,
  MessageAuthorKind,
  PostableAuthorKind,
  ChannelMessageKind,
  PostableMessageKind,
  MessageIntent,
};

/**
 * Rendered peer of a direct channel. ⚠ Resolved live from the roster, never
 * stored as truth — a name/avatar changes.
 */
export type ChannelDirectPeer = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

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

/**
 * Tool scope a member's responding agent runs with (operator controls their own
 * machine). `full` = no restriction (default); `dopl_only` = Dopl MCP + safe
 * reads; `read_only` = no writes. Desktop maps this to the spawned session's
 * `--allowedTools`.
 */
export type AgentToolProfile = "full" | "dopl_only" | "read_only";

/**
 * Listener state a heartbeat reports. Closed set (schema + DB CHECK).
 * `listening` is the desktop's steady state; rest reserved so richer states
 * need no migration.
 */
export type AgentPresenceStatus = "listening" | "busy" | "paused" | "offline";

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
  /**
   * The Info tab's CURATED Main-info card — which built-in rows were removed
   * and which custom `label: value` rows were added (2026-08-25).
   *
   * ⚠ SHARED, NOT CALLER-RELATIVE. Unlike `myFavoritedAt` / `role` /
   * `lastReadAt` above, this is a property of the CHANNEL: both sides of a home
   * channel see the same card, and either member may edit it. If it ever needs
   * to be per-person it becomes a `channel_members` column and a `my*` name —
   * do not quietly reinterpret this one.
   *
   * ⚠ NEVER `null`. The column is `NOT NULL DEFAULT '{}'` and the DTO parses
   * defensively, so an unreadable stored value arrives as the card as shipped
   * (`info-card.ts › parseInfoCard`). A renderer never has to ask whether the
   * card loaded.
   */
  infoCard: ChannelInfoCard;
  /** **THE POSTURE CEILING THE SERVER CAN SEE** (A9 — G6/G7). ⚠ `null` on any
   *  axis is "NOT RECORDED", never "unrestricted"; see `types-delivery.ts`. */
  agentPosture: ChannelAgentPosture;
  /**
   * **WHO ANSWERS WHEN NOBODY IS NAMED** (2026-09-02, B4 — Samuel's ruling B6):
   * the agent handle RR3 hands an unaddressed HUMAN message to when more than
   * one agent is live in the room. `null` = not configured, which is not "nobody
   * answers": one live agent still answers by itself, and two or more answer not
   * at all.
   *
   * ⚠ A HANDLE, never a template id — the migration records why (an FK to
   * `agent_templates` would be a cross-visibility reference from a row members
   * can read), and it is why this degrades quietly instead of dangling.
   */
  defaultResponderAgentName: string | null;
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
  // ── THE DELIVERY KEYSTONE (2026-09-02, A9; `types-delivery.ts`) ─────────
  // ⚠ **OPTIONAL *AND* NULLABLE, AND BOTH MEAN "NOT ANSWERED HERE".** `undefined`
  // is what a message this tree BUILDS rather than READS carries (an optimistic
  // row, a fixture, the marketing demo); `null` is what `server/dto.ts ›
  // mapMessageRow` writes for a stored row the resolver could not answer for.
  // **Neither is "nobody" — that is `"none"`** — and `[]` on either array IS
  // "resolved to nobody" where absent is not. `main/session-dispatch.js` falls
  // back to its own body parse ONLY on absent, which is what keeps an installed
  // desktop working unchanged; collapsing any two of the three breaks it.
  // ⚠ The optionality also keeps this type BYTE-IDENTICAL to the SDK's
  // hand-maintained mirror, which is the only reason that mirror stays honest.
  wakeVerdict?: ChannelWakeVerdict | null;
  recipientUserIds?: string[] | null;
  recipientAgentIds?: string[] | null;
  /** ⚠ Without {@link deliveryAt} this is the server's write-time PREDICTION. */
  delivery?: ChannelDelivery | null;
  deliveryAt?: string | null;
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
export type ChannelMessagePosted = ChannelMessage & {
  /**
   * **THIS CALL WROTE NOTHING — THE `clientMsgId` HAD ALREADY LANDED**
   * (2026-09-04).
   *
   * ⚠ **THE ACK USED TO BE BYTE-IDENTICAL TO A FIRST POST**, which is why the
   * agent's own transcript in the Mobile Command Center incident showed the 3:48
   * PM message posted twice over ONE row (seq 963): the idempotency
   * short-circuit returned the stored message with a success shape and nothing
   * anywhere said the write had converged. An orchestrator reading two `posted`
   * acks has no way to tell one message from two.
   *
   * ⚠ **PRESENT ONLY ON A REPLAY, never `false`.** It is a NOTICE about this
   * CALL, not a property of the row — the same message read back tomorrow
   * carries no such key — and this alias exists precisely so a post-time notice
   * has somewhere to go that is not `metadata`.
   */
  replayed?: true;
};

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
  /**
   * The member's WORKSPACE-level role, surfaced so the roster can show a "Guest"
   * pill (2026-08-25) — the channel `role` above is only ever `owner`/`member`, so
   * a link-claimed guest reads `member` there. ⚠ `null` when not resolved: the
   * roster read (`listChannelMembers`) fills it, but the member-mutation ECHOes
   * (`addMember` / favorite-toggle) omit it, and a STALE cached payload predating
   * this field also lacks it. A renderer treats null/absent as "not a guest".
   */
  workspaceRole: Role | null;
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
  ChannelSessionHealth,
  ChannelSessionStateOwn,
} from "./types-sessions";

export type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirective,
  // ⚠ THE TWO POSTURE AXES (2026-09-01, T24). Re-exported here like everything
  // else on this lane so there is no second import path to a symbol — and both
  // are ORDERED unions whose order the desktop's clamp depends on; see their
  // docblock in `types-launch.ts` before touching either.
  LaunchToolMode,
  LaunchMessageMode,
} from "./types-launch";

// THE DELIVERY KEYSTONE (2026-09-02, A9) — the `delivery=` verdict, the recipient
// resolution behind it, and the channel posture CEILING a launch is clamped to.
export type {
  ChannelAgentPosture,
  ChannelDelivery,
  ChannelWakeVerdict,
  MachineDelivery,
} from "./types-delivery";

export type { DirectionRefusalReason, AgentDirection } from "./types-direction";

// THE ACCOUNT-WIDE STATUS ANSWER — the shape `op="status"` renders and the
// Overview "Needs you" card reads. ⚠ A `types-*.ts` rather than the service's
// own export because the service is `server-only`; see that file's header.
export type {
  AccountChannelStatus,
  AccountStatus,
  AccountStatusClips,
  AccountWaitingItem,
} from "./types-account";

// OUTBOUND CONSENT (§6) — same arrangement, same reason (§1 split, 2026-09-02).
export type {
  ConsentKind,
  ConsentStatus,
  ConsentDecisionSurface,
  ChannelConsentRequest,
} from "./types-consent";
