/**
 * Channels feature — camelCase domain types.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is one SHARED exchange — both
 * members see the same title and status. A SESSION is ONE member's agent run
 * working a thread on THAT member's machine; each side has its own, a session
 * pauses/resumes, a thread does not. Unlike chats (private per-owner archive), a
 * channel has explicit membership: PUBLIC = any workspace member, PRIVATE = members
 * only.
 *
 * ⚠ BOUNDARY — wire/storage name `task` == domain name `thread`. The
 * `channel_tasks` table, the `metadata.task*` keys, `task_*` message kinds and the
 * `/api/channels/[channelId]/tasks/**` routes keep the STORAGE name (renaming =
 * migration + every read/write path); mapping is in `client/api.ts`, `server/dto.ts`.
 */

// ⚠ IMPORTED, NOT RE-DECLARED: the info card's shape and its zod schema are ONE
// statement (`./info-card.ts`); a second copy here is what drifts.
import type { ChannelInfoCard } from "./info-card";
// ⚠ `ChannelAgentPosture` LEFT THIS IMPORT ON 2026-09-06 with the field it typed.
import type { ChannelDelivery, ChannelWakeVerdict } from "./types-delivery";
// ⚠ IMPORTED, NOT RE-DECLARED (2026-09-07), for `ChannelInfoCard`'s reason: the setting
// and its coercion are ONE statement in `lib/agent-mentions.ts`, twinned by a SQL CHECK.
import type { UnaddressedResponderSetting } from "./lib/agent-mentions";
import type { Role } from "@/features/workspaces/types";
// 🔒 THE ONE LIST PROJECTION (R-26) — its own file only because this one is at §1's
// cap, re-exported WHOLE so `@/features/channels/types` stays the single import path.
import type { ChannelPendingLink, ChannelRowExtras } from "./types-list";
export * from "./types-list";

/**
 * ⚠ **THE TEN CLOSED SETS BELOW ARE DECLARED IN `@dopl/contracts › channels.ts` AND
 * RE-EXPORTED HERE UNDER THE NAMES THEY HAVE ALWAYS HAD** (2026-09-02, v2 slice A13).
 * They used to be re-typed by hand in `packages/dopl-client/src/channel-types.ts` —
 * which cannot import `src/` — with `scripts/check-message-kind-drift.ts` holding two
 * pairs together by regex; the compiler holds all ten now. ⚠ **NO IMPORT PATH CHANGED
 * AND NONE MAY**: `@/features/channels/types` is the one path to these names, so do
 * NOT import `@dopl/contracts` from a feature module. ⚠ **WHAT DID NOT MOVE:**
 * `NotifyScope`, `AgentToolProfile`, `ConsentKind`, `ConsentStatus`,
 * `ConsentDecisionSurface`, `AgentPresenceStatus` — no SDK twin, never mirrors.
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

/** Rendered peer of a direct channel. ⚠ Resolved live from the roster, never stored
 *  as truth — a name/avatar changes. */
export type ChannelDirectPeer = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * A titled, mode-tagged exchange. The transcript rides on `channel_messages` via
 * `metadata.taskId = ChannelThread.id`; the `channel_tasks` row is the authoritative
 * status/mode/title store, shared by both members.
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
   * When this thread last saw real activity — the newest message tagged for it, or
   * its own `createdAt`. Derived by the `channel_tasks_activity` view; ⚠ NEVER
   * `updatedAt`, whose only writer is `set_mode` since close and reopen were removed
   * (C-1). ⚠ ABSENT means THIS READ DID NOT DERIVE IT (a single-thread load), never
   * "no activity": only the thread LIST carries it, and it is what that list is
   * ordered by and what `SIDEBAR_THREAD_ACTIVE_WINDOW_MS` is measured against.
   */
  lastActivityAt?: string;
};

/**
 * A named agent of a channel: an ATTRIBUTION RECORD, nothing more — no writes, no
 * lifecycle. Read on ONE path: a stored message stamped with
 * `metadata.author_agent_id` renders "quartz · Ada's agent". Lifecycle columns
 * (`status`, `engagedAt`, `engagedBy`) stay in the DB, dropped from the DTO.
 */
export type ChannelAgent = {
  id: string;
  /** The member whose machine it ran on — "Your agent" / "Ada's agent". */
  ownerUserId: string;
  /** The handle as it was typed in an @-mention: `^[a-z][a-z0-9-]{1,30}$`. */
  name: string;
};

/**
 * ⛔ REMOVED FROM THE PRODUCT (F-170). DO NOT BUILD ON THIS TYPE — unsettable by any
 * route. Survives ONLY because `server/{dto,service-reads,service-writes-members,
 * repository}.ts` still map the column; delete it in the same change that removes
 * them and `channel_members.notify_scope`.
 *
 * Why it went (don't re-add from the enum alone): `'addressed'` was compared nowhere
 * and behaved as `'all'`; `'none'` silenced only the implicit two-member trigger, so
 * an addressed message still spawned a session.
 */
export type NotifyScope = "all" | "addressed" | "none";

/**
 * **THE STORED tool scope** a member's responding agent runs with (the operator controls their own
 * machine) — `channel_members.agent_tool_profile`, a three-value column with its own CHECK, and the
 * closed write enum behind `PATCH /channels/[channelId]/members` (`schema-members.ts ›
 * AgentToolProfileSchema`). What each value GRANTS: `main/tool-profiles.js`.
 *
 * ⚠ **IT SAID "`full` = no restriction (default)" AND BOTH HALVES WERE STALE** (fixed 2026-09-13,
 * F-692). `full` runs under `UNIVERSAL_HARD_DENY` on every lane and the broader `SESSION_HARD_DENY`
 * on the SDK one; "(default)" is only the COLUMN default — an unresolved value
 * here is `read_only` (`constants.ts › UNRESOLVED_TOOL_PROFILE`). ⚠ **WHAT A LAUNCH RESOLVES TO IS
 * {@link ResolvedAgentToolProfile}, NOT THIS** — do not widen this union to carry `channel_agent`:
 * `closedEnum` would force it into the PATCH schema, making a value the column's CHECK rejects
 * writable over the wire.
 */
export type AgentToolProfile = "full" | "dopl_only" | "read_only";

/**
 * **THE PROFILE A LAUNCH ACTUALLY STARTS AT** — ruling B7's narrowing applied (2026-09-02; surfaced
 * here 2026-09-13, F-692). `channel_agent` is `full` MINUS THE SHELL, what the desktop runs in a
 * SHARED channel. ⚠ **NEVER STORED, NEVER WRITABLE** — the argument and the derivation are
 * `lib/tool-profile-resolve.ts › profileForChannel`; it is here so a LABEL can be truthful.
 */
export type ResolvedAgentToolProfile = AgentToolProfile | "channel_agent";

/**
 * Listener state a heartbeat reports. Closed set (schema + DB CHECK).
 *
 * ⚠ **`active` / `away` ARE THE POSTURE; THE OTHER FOUR ARE LEGACY WORDS** (2026-09-08,
 * Samuel's Slack-parity ruling — `20260930140000`). A current desktop sends exactly
 * {@link PresencePosture}; `listening` is what an older build still sends, so it stays
 * in this union and the CHECK (§13's older-peer rule), while `busy` / `paused` /
 * `offline` were reserved and never written. ⚠ **ONLY THE LITERAL `away` SUPPRESSES
 * THE DOT**: `repository-collab.ts › presenceForWorkspace` tests `status !== "away"`,
 * NOT `status === "active"` — an allow-list would take every pre-1.30 machine offline
 * on deploy day.
 */
export type AgentPresenceStatus =
  | "listening"
  | "busy"
  | "paused"
  | "offline"
  | PresencePosture;

/**
 * THE SLACK POSTURE, and the only two words a current desktop sends. ACTIVE = the app
 * is open AND the machine is awake/unlocked AND there was input within the last 30
 * minutes; AWAY = anything else. No manual override (out of scope, 2026-09-08).
 */
export type PresencePosture = "active" | "away";

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
   * When the CALLER favourited this channel; null = not favourited, and null for a
   * non-member. Caller-relative like `role` and `lastReadAt`.
   *
   * ⚠ THE SIDEBAR'S FAVORITES SECTION READS THIS AND NOTHING ELSE — it rides the
   * channel list the sidebar already has, so no extra read, no endpoint.
   * 🔒 **THE ONE WIRE NAME FOR `channel_members.favorited_at` SINCE R-27** — three
   * names for one fact is what produced the pin bug (2026-09-15).
   */
  myFavoritedAt: string | null;
  /** Members whose agent heartbeat is within PRESENCE_ONLINE_WINDOW_MS. */
  onlineMemberCount: number;
  /**
   * The Info tab's CURATED Main-info card (2026-08-25). ⚠ SHARED, NOT
   * CALLER-RELATIVE — a property of the CHANNEL, unlike `myFavoritedAt` / `role` /
   * `lastReadAt`; if it ever needs to be per-person it becomes a `channel_members`
   * column and a `my*` name. ⚠ NEVER `null`: the column is `NOT NULL DEFAULT '{}'`
   * and the DTO parses defensively (`info-card.ts › parseInfoCard`), so a renderer
   * never has to ask whether the card loaded.
   */
  infoCard: ChannelInfoCard;
  // ⚠ **`agentPosture` IS DELETED (2026-09-06, Samuel's rulings on items 12, 13 and
  // 14)** — the room-MANAGER posture CEILING over EVERY member's agents, removed with
  // the containment loss stated to him first: *"all agents launched should just inherit
  // the original tools' permissions"*, *"make sure all the logic is deleted"*. NO ROOM
  // BOUNDS A PEER'S AGENT ON ANY AXIS NOW.
  // ⚠ **`defaultResponderAgentName` IS DELETED (2026-09-07, Samuel's ruling on items 10
  // and 11)** — the room-wide pin of ONE agent to answer EVERY member's unaddressed
  // messages: *"if there's another member in the room, their last agent address would be
  // different from my last agent address."* Replaced by
  // `ChannelMember.unaddressedResponder` on the VIEWER'S OWN roster row — not a
  // `my*` field here, so there is one client-side source.
} & ChannelRowExtras;

/**
 * The payload of `GET /api/channels` at BOTH scopes (R-26 (b)).
 *
 * ⚠ **`pendingLinks` IS AN ABSENT KEY UNDER `scope=container`, NEVER `[]`** (§9's
 * `channelGrants` precedent: an absent param yields an absent key, where `[]` would
 * assert "asked, none open"). Under `scope=account` it is the caller's LEGACY
 * UNBOUND links, which have no channel to hang off and so are rows of their own.
 */
export type ChannelListPayload = {
  channels: Channel[];
  pendingLinks?: ChannelPendingLink[];
  /** ⚠ **THE ACCOUNT SCOPE'S REPORTED CLIP (§9, P35).** Absent under
   *  `scope=container`, which has no ceiling of its own; read `?? false` inline.
   *  ⚠ **NO SURFACE READS IT YET (measured 2026-09-17).** It is on the wire from
   *  `app/api/channels/route.ts`, and `home-rows.ts` / `use-home-channels.ts` both
   *  drop it — so a caller at `ACCOUNT_CHANNEL_LIMIT` sees a clipped list that
   *  looks complete, which is the one thing §9's clip rule forbids. */
  truncated?: boolean;
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
  /**
   * **THE OPERATOR'S NAME FOR THE AGENT THAT WROTE THIS ROW** — joined from
   * `channel_sessions.display_name` at read time (2026-09-04).
   *
   * ⚠ **JOINED, NEVER STORED** — a copy stops agreeing the moment the name changes.
   * ⚠ **ABSENT AND `null` BOTH MEAN "NOT ANSWERED HERE"** — an older server, an
   * unresolved page, a human author, or a swept session row; every renderer falls back
   * to the `agent-<id>` handle, minted once and never recycled.
   * ⚠ **PEER-TYPED** — nothing validates its charset, so every surface neutralizes it.
   */
  authorAgentName?: string | null;
  // ── THE DELIVERY KEYSTONE (2026-09-02, A9; `types-delivery.ts`) ─────────
  // ⚠ **OPTIONAL *AND* NULLABLE, AND BOTH MEAN "NOT ANSWERED HERE".** `undefined` is
  // what a message this tree BUILDS rather than READS carries; `null` is what
  // `server/dto.ts › mapMessageRow` writes for a stored row the resolver could not
  // answer for. **Neither is "nobody" — that is `"none"`** — and `[]` on either array
  // IS "resolved to nobody" where absent is not; `main/session-dispatch.js` falls back
  // to its own body parse ONLY on absent, so collapsing any two of the three breaks an
  // installed desktop. ⚠ The optionality also keeps this type BYTE-IDENTICAL to the
  // SDK's hand-maintained mirror, the only reason that mirror stays honest.
  wakeVerdict?: ChannelWakeVerdict | null;
  recipientUserIds?: string[] | null;
  recipientAgentIds?: string[] | null;
  /** ⚠ Without {@link deliveryAt} this is the server's write-time PREDICTION. */
  delivery?: ChannelDelivery | null;
  deliveryAt?: string | null;
  /**
   * The artifact this message is folded into, or `null`/absent for the ordinary
   * case (#1220 §2). ⚠ OPTIONAL for the same reason the three fields above are.
   */
  artifactId?: string | null;
};

/**
 * AN ARTIFACT — a THREAD FORMED AFTER THE FACT (design #1220, accepted #1222).
 *
 * ⚠ **IT IS NOT AN EDIT AND NOT A DELETE.** Every message it folds keeps its body,
 * author, metadata and `seq`; folding is a view decision recorded on
 * `channel_messages.artifact_id` and reversible without loss — the property the rest
 * of the design rests on. ⚠ NO MEMBER LIST HERE: membership is the column, which
 * makes "one artifact per message, no nesting" a schema property, not a rule to
 * enforce.
 */
export type ChannelArtifact = {
  id: string;
  channelId: string;
  workspaceId: string;
  name: string;
  summary: string;
  createdBy: string;
  /** The agent INSTANCE id that made it, or `null` for a person acting directly. */
  createdByAgent: string | null;
  /** ⚠ RETIRED, NEVER DELETED — a dissolved artifact still resolves, so an old
   *  citation gets an honest answer instead of a 404. */
  dissolvedAt: string | null;
  createdAt: string;
};

/**
 * THE FOLDED CARD — one synthetic entry standing in for a run of messages on a
 * default read (design §4).
 *
 * ⚠ **THE SPAN IS LOAD-BEARING, NOT DECORATION.** A reader holding an old citation
 * can tell from `firstSeq` / `lastSeq` WHICH artifact holds it without opening
 * anything, and `count` beside it says whether the artifact is a solid run or a
 * selection out of one (#1220 §7, fork 3). ⚠ **COUNT AND SPAN ARE OVER THE WHOLE
 * ARTIFACT, NEVER OVER THE PAGE** — a per-page count answers a different question
 * every time the page moves.
 */
export type ChannelFoldedArtifact = {
  artifact: ChannelArtifact;
  /** Total members, channel-wide. */
  count: number;
  /** Lowest and highest member `seq`. ⚠ The card renders at `firstSeq`. */
  firstSeq: number;
  lastSeq: number;
};

/**
 * ONE ENTRY ON A DEFAULT READ: a message, or a card standing in for a folded run.
 *
 * ⚠ **THIS IS THE ONE GENUINELY BREAKING PART OF THE DESIGN AND IT IS STATED RATHER
 * THAN SOFTENED** (#1220 §4): a client that does not know about artifacts gets a card
 * where it expected messages — the saving IS the substitution. ⚠ THE DISCRIMINATOR IS
 * `type`, PRESENT ON BOTH ARMS; testing for the ABSENCE of a message field would
 * treat a future entry shape as a card.
 */
export type ChannelReadEntry =
  | { type: "message"; message: ChannelMessage }
  | { type: "artifact"; folded: ChannelFoldedArtifact };

/**
 * A message the caller just POSTED. ⚠ Its one notice, `threadClosed`, went with
 * thread closing (wiring plan Phase 4, 2026-08-18); the alias survives so the write
 * path keeps a name distinct from the READ shape, and a future post-time notice goes
 * here rather than into `metadata`.
 */
export type ChannelMessagePosted = ChannelMessage & {
  /**
   * **THIS CALL WROTE NOTHING — THE `clientMsgId` HAD ALREADY LANDED** (2026-09-04).
   *
   * ⚠ **THE ACK USED TO BE BYTE-IDENTICAL TO A FIRST POST**, which is why the Mobile
   * Command Center transcript showed the 3:48 PM message posted twice over ONE row
   * (seq 963): the idempotency short-circuit returned the stored message with a
   * success shape, so two `posted` acks could not be told from two messages.
   * ⚠ **PRESENT ONLY ON A REPLAY, never `false`** — a NOTICE about this CALL, not a
   * property of the row.
   */
  replayed?: true;
};

/**
 * ⚠ `ChannelMention` MOVED TO `types-mentions.ts` at the 500-line cap
 * (2026-09-15), re-exported below exactly like the SESSION and LAUNCH families —
 * no import path changed and there is still one path to the symbol.
 */
export type { ChannelMention } from "./types-mentions";

export type ChannelMember = {
  channelId: string;
  userId: string;
  role: ChannelRole;
  /**
   * The member's WORKSPACE-level role, so the roster can show a "Guest" pill
   * (2026-08-25) — the channel `role` above is only ever `owner`/`member`. ⚠ `null`
   * when not resolved: `listChannelMembers` fills it, the member-mutation ECHOes
   * omit it, and a STALE cached payload predating the field lacks it. A renderer
   * treats null/absent as "not a guest".
   */
  workspaceRole: Role | null;
  lastReadAt: string | null;
  /** ⛔ Dead since F-170 — nothing sets or reads it. Still scrubbed to null on
   *  non-self rows by `mapMemberRow`. See `NotifyScope`. */
  notifyScope: NotifyScope | null;
  /** ⚠ Private preference — present ONLY on the caller's own row. */
  agentToolProfile: AgentToolProfile | null;
  /**
   * **WHO ANSWERS THIS MEMBER'S UNTAGGED MESSAGES HERE** (2026-09-07, Samuel's ruling on
   * items 10 and 11) — the per-person replacement for `defaultResponderAgentName`.
   *
   * ⚠ **PRIVATE — PRESENT ONLY ON THE CALLER'S OWN ROW**, on `agentToolProfile`'s
   * precedent and enforced twice: scrubbed in `server/dto.ts › mapMemberRow`, and
   * column-privileged in `20260928130000` so it never rides a peer's realtime feed.
   * ⚠ **`null` MEANS "NOT YOUR ROW", NEVER `"none"`** — opposite readings, never to be
   * collapsed. Your OWN row is always one of the two settings (`NOT NULL` column, and
   * the mapper coerces an absent one to the default).
   * ⚠ **THIS IS THE ONE CLIENT-SIDE SOURCE** — the composer's recipient line and the
   * Settings control both read it off the roster (`lib/draft-recipients.ts`,
   * `settings-channel-agents.tsx`); no `Channel.my*` twin, on purpose.
   *
   * ⚠ **OPTIONAL BECAUSE THE CACHE IS A DIFFERENT MOMENT (§8, the standing 2026-08-25
   * rule).** The IndexedDB-persisted members payload (24h `gcTime`) renders rows minted
   * BEFORE the field existed, so `undefined` is a THIRD reading and every reader takes
   * an explicit fallback (`lib/draft-recipients.ts › viewerUnaddressedResponder`, `??
   * undefined` into `normalizeUnaddressedResponder`) — the default, never a crash and
   * never `'none'`.
   */
  unaddressedResponder?: UnaddressedResponderSetting | null;
  /** ⚠ Private preference — present ONLY on the caller's own row. The
   *  favourite-toggle PATCH echoes it back; the sidebar reads
   *  `Channel.myFavoritedAt` instead. ⚠ **RENAMED FROM `favoritedAt` BY R-27.** */
  myFavoritedAt: string | null;
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
 * SESSION and LAUNCH types live in `types-sessions.ts` / `types-launch.ts` (split
 * 2026-08-22 at the 500-line cap), re-exported here so every existing
 * `@/features/channels/types` import is unchanged — **this file is the barrel, and
 * there is no third path to a symbol.**
 */
export type {
  AgentColorKey, SessionPillState, SessionDetailKey,
  ChannelSessionState,
  ChannelSessionTelemetry,
  ChannelSessionHealth,
  ChannelSessionStateOwn,
} from "./types-sessions";

export type {
  LaunchRefusalReason,
  LaunchDirectiveKind,
  LaunchDirective,
  // ⚠ THE TWO POSTURE AXES (2026-09-01, T24) — ORDERED unions whose order the desktop's
  // clamp depends on; read their docblock in `types-launch.ts` before touching either.
  LaunchToolMode,
  LaunchMessageMode,
} from "./types-launch";

// THE DELIVERY KEYSTONE (2026-09-02, A9) — the `delivery=` verdict and the recipient
// resolution behind it. ⚠ `ChannelAgentPosture` IS NO LONGER RE-EXPORTED (2026-09-06);
// it is deleted at its source in `types-delivery.ts`.
export type {
  ChannelDelivery,
  ChannelWakeVerdict,
  MachineDelivery,
} from "./types-delivery";

export type { DirectionRefusalReason, AgentDirection } from "./types-direction";

// THE ACCOUNT-WIDE STATUS ANSWER — the shape `op="status"` renders and the Overview
// "Needs you" card reads. ⚠ A `types-*.ts` rather than the service's own export because
// the service is `server-only`; see that file's header.
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
