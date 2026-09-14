import type {
  AgentToolProfile,
  Channel,
  ChannelArtifact,
  ChannelDelivery,
  ChannelMember,
  ChannelMessage,
  ChannelMessageKind,
  ChannelRole,
  ChannelThread,
  // ⚠ `ChannelAgentPosture` LEFT THIS IMPORT ON 2026-09-07 — it is deleted at its
  // source (`types-delivery.ts`, items 12/13/14) and this import was the last
  // dangling reference to it in the tree. ⚠ `LaunchMessageMode` / `LaunchToolMode`
  // LEFT IT THE SAME DAY: the posture ceiling was their only reader here, so they
  // outlived it as unused imports (a `--max-warnings 0` red, not a type error).
  ChannelVisibility,
  ChannelWakeVerdict,
  MessageAuthorKind,
  NotifyScope,
  ThreadMode,
  ThreadOutcome,
  ThreadStatus,
} from "../types";
import { authorAgentIdOf } from "../lib/agent-post-stamp";
// ⚠ THE ONE COERCION, IMPORTED RATHER THAN REPEATED (2026-09-07). The rule that junk and
// absence land on the DEFAULT and never on `"none"` is a ruling, and a mapper with its own
// `as` cast would be a second place it lived — the shape this wave has now found four times.
import { normalizeUnaddressedResponder } from "../lib/agent-mentions";
import { parseInfoCard } from "../info-card";

// ⚠ THE ROW SHAPES MOVED TO `dto-rows.ts` (2026-09-14, 500-line cap) AND ARE
// RE-EXPORTED HERE VERBATIM: ~100 files import `ChannelRow` / `ChannelMemberRow`
// / `ChannelMessageRow` / `ProfileRef` and friends from `./dto`, so the barrel is
// the public name for them and no importer moved.
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelArtifactRow,
  ChannelRow,
  ChannelTaskActivityRow,
  ChannelTaskRow,
  ChannelViewerState,
  MapMemberOptions,
  ProfileRef,
} from "./dto-rows";
export type {
  ChannelArtifactRow,
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskActivityRow,
  ChannelTaskRow,
  ChannelViewerState,
  MapMemberOptions,
  MemberPresence,
  ProfileRef,
} from "./dto-rows";
export { CHANNEL_TASK_ACTIVITY_COLS } from "./dto-rows";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * **THE CHANNEL'S POSTURE CEILING, READ OFF THE ROW** (2026-09-02, A9 — G6/G7).
 *
 * ⚠ ALWAYS AN OBJECT, NEVER `undefined` — `infoCard`'s discipline, for
 * `infoCard`'s reason: a reader must not have to ask whether the field loaded.
 * The three axes inside it are independently nullable, and `null` there is "no
 * ceiling recorded", never "unrestricted".
 *
 * ⚠ **EXPORTED FOR `service-launch.ts`, WHICH HAS THE ROW AND NOT THE DTO.** The
 * create already loaded the channel through `loadVisibleChannel`; building a
 * whole `Channel` (which needs a membership STATE the clamp has no use for) to
 * read three columns would be a second read of a fact already in hand. One
 * reader of the columns, two callers.
 */
// ⚠ **`mapAgentPosture` IS DELETED (2026-09-06, Samuel's rulings on items 12, 13 and 14).**
//
// The three columns it read — `agent_tool_ceiling`, `agent_message_ceiling`,
// `agent_chain_allowed` — were a room MANAGER's clamps over EVERY member's agents in the
// channel. All three are removed, with the containment loss stated to him before he ruled:
// *"all agents launched should just inherit the original tools' permissions"*, and *"make sure
// all the logic is deleted"*.
//
// ⚠ ITS ONE OTHER CALLER WENT WITH IT. This function was exported for `service-launch.ts`,
// which held the ROW and not the DTO and used it to build the launch clamp. There is no clamp
// now, so there is no second reader and nothing to export.
//
// ⚠ THE COLUMNS ARE LEFT ON THE TABLE, dropped by a NON-DESTRUCTIVE migration that stops
// reading them rather than by a `DROP COLUMN` — this repo's standing posture. Nothing here maps
// them, so a row that still carries values is simply not looked at.

export function mapChannelRow(
  row: ChannelRow,
  state: ChannelViewerState
): Channel {
  const isMember = state.role !== null;
  // ⚠ Compare INSTANTS, not raw ISO strings: `lastMessageAt` (Postgres,
  // `+00:00`, microseconds) and `lastReadAt` (JS `toISOString()`, `Z`,
  // milliseconds) are formatted differently, so lexicographic `>` is wrong.
  const unread =
    isMember &&
    state.lastMessageAt !== null &&
    (state.lastReadAt === null ||
      Date.parse(state.lastMessageAt) > Date.parse(state.lastReadAt));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    visibility: row.visibility as ChannelVisibility,
    isDirect: row.is_direct,
    directPeer: row.is_direct ? state.directPeer : null,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: state.memberCount,
    lastMessageAt: state.lastMessageAt,
    role: state.role,
    isMember,
    lastReadAt: state.lastReadAt,
    unread,
    myNotifyScope: state.notifyScope,
    myAgentToolProfile: state.agentToolProfile,
    myFavoritedAt: state.favoritedAt,
    onlineMemberCount: state.onlineMemberCount,
    // ⚠ PARSED, NEVER CAST. `parseInfoCard` never throws: an older shape, a
    // hand-edited row or a built-in key retired since it was written all
    // degrade to the card as shipped, because the facts under the card are
    // still there and a channel that cannot render is the worse answer.
    infoCard: parseInfoCard(row.info_card),
    // ⚠ **`agentPosture` AND `defaultResponderAgentName` ARE BOTH OFF THIS MAPPER
    // (2026-09-07).** The first went with the posture ceiling (items 12/13/14) and the second
    // with the room-wide responder (items 10/11); both were still being mapped here after
    // their fields left `Channel`, which is the shape a half-finished deletion takes. The
    // per-member replacement is on the MEMBER row, not this one — see {@link mapMemberRow}.
  };
}

/** The joined name for a row's author agent, or `null`. ⚠ Gated on
 *  `author_kind`: a person's cookie session carries a `session_id` too, and a
 *  member is not an agent. */
function agentNameOf(
  row: ChannelMessageRow,
  agentNames: ReadonlyMap<string, string> | undefined
): string | null {
  if (!agentNames || row.author_kind !== "agent") return null;
  const id = authorAgentIdOf({
    clientMsgId: row.client_msg_id,
    metadata: isRecord(row.metadata) ? row.metadata : null,
  });
  return id === null ? null : (agentNames.get(id) ?? null);
}

export function mapMessageRow(
  row: ChannelMessageRow,
  profile: ProfileRef | undefined,
  /**
   * Agent id → the operator's name for it, for THIS page
   * (`service-shared.ts › agentNamesFor`). ⚠ OPTIONAL, and a miss is `null`
   * rather than a guess: the write path builds a message with no page to join
   * against, and every renderer already falls back to the `agent-<id>` handle.
   */
  agentNames?: ReadonlyMap<string, string>
): ChannelMessage {
  return {
    id: row.id,
    seq: Number(row.seq),
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    authorKind: row.author_kind as MessageAuthorKind,
    kind: row.kind as ChannelMessageKind,
    body: row.body,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    clientMsgId: row.client_msg_id,
    createdAt: row.created_at,
    authorName: profile?.display_name || profile?.email || null,
    authorAvatarUrl: profile?.avatar_url ?? null,
    // ⚠ THE ONE PARSER decides WHICH agent wrote the row (`lib/agent-post-stamp
    // .ts › authorAgentIdOf` — the stamp, else the server's own session key);
    // this only looks the answer up. `null` for a human, for an unnameable row
    // and for a page nobody resolved names for — three situations every
    // renderer answers the same way, with the `agent-<id>` handle.
    authorAgentName: agentNameOf(row, agentNames),
    // ⚠ PASSED THROUGH, NEVER RE-DERIVED. The verdict was computed ONCE, on the
    // write, by `service-wake-verdict.ts`; a mapper that recomputed it would be
    // the second reader this whole slice exists to delete. `?? null` normalizes
    // an ABSENT column (migration not applied) onto the same "not answered"
    // value as a NULL one, which is the same answer to the caller.
    wakeVerdict: (row.wake_verdict ?? null) as ChannelWakeVerdict | null,
    recipientUserIds: row.recipient_user_ids ?? null,
    recipientAgentIds: row.recipient_agent_ids ?? null,
    delivery: (row.delivery ?? null) as ChannelDelivery | null,
    deliveryAt: row.delivery_at ?? null,
    // ⚠ CARRIED THROUGH EVEN THOUGH THE DEFAULT READ FOLDS THESE ROWS AWAY, and
    // the reason is the design's addressing PIN (#1220 §3): a read that NAMES a
    // message returns the MESSAGE. Such a read hands back a member row, and the
    // renderer still has to be able to say which box it belongs to — a citation
    // that resolved to a body with no way back to its artifact would be the
    // "it is in that box somewhere" failure the pin exists to prevent.
    artifactId: row.artifact_id ?? null,
  };
}

/**
 * Artifact row → DTO. ⚠ COUNT AND SPAN ARE NOT HERE, deliberately: they are an
 * aggregate over `channel_messages` (`repository-artifacts.ts › artifactSpans`),
 * not columns, so a mapper that invented zeroes for them would render a card
 * claiming an artifact was empty. The folded entry is assembled in
 * `service-artifacts.ts`, which has both halves in hand.
 */
export function mapArtifactRow(row: ChannelArtifactRow): ChannelArtifact {
  return {
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    name: row.name,
    summary: row.summary,
    createdBy: row.created_by,
    createdByAgent: row.created_by_agent,
    dissolvedAt: row.dissolved_at,
    createdAt: row.created_at,
  };
}

/**
 * Member row → DTO. The privacy scrub lives HERE, not at each caller:
 * `notify_scope`, `agent_tool_profile`, `favorited_at` and `unaddressed_responder` are the
 * member's own preferences and are nulled for everyone but the viewer, so the roster read AND
 * the single-row returns from addMember / updateMyMemberSettings all get it.
 *
 * ⚠ `unaddressed_responder` (`20260928130000`) JOINED THAT LIST ON 2026-09-07 and followed the
 * standing instruction below to the letter: scrubbed here, and absent from every GRANT — which
 * is what keeps it out of a peer's realtime change FEED, not merely out of this response.
 * Presence IS public to the workspace — you need it to know whether the agent
 * you are addressing is live.
 *
 * ⚠ `favoritedAt` rides here so the members PATCH's own response tells the truth
 * about what it just wrote. The SIDEBAR does not read it from this DTO — it
 * reads `Channel.myFavoritedAt` off the channel list, which already loads the
 * caller's membership row. One column, two mappers, one scrub rule.
 *
 * ⚠ THIS SCRUB IS NOT THE ONLY LINE OF DEFENCE AND NEVER WAS SUFFICIENT ALONE:
 * this DTO is not on every path. `channel_members` is in the realtime
 * publication, so the RAW row reaches any channel member over CDC and over
 * direct PostgREST. Enforcement lives in the DATABASE — column-level privileges
 * bind both consumers
 * (`supabase/migrations/20260810120000_channel_members_column_privileges.sql`:
 * `agent_tool_profile` is service_role-only; `role`, `user_id`, `channel_id`,
 * `workspace_id`, `last_read_at`, `added_by`, `joined_at` stay readable).
 *
 * ⚠ KEEP THIS SCRUB — defence in depth, and it is what shapes the API response
 * (the server reads as service_role, so the column privilege redacts nothing on
 * THIS path). A new per-member SETTING must be added to the scrub AND left out
 * of that migration's GRANT list. `favorited_at` (`20260819120000`) is the
 * worked example: it is scrubbed below and it appears in no GRANT, so it is
 * service_role-only for PostgREST and CDC both.
 */
export function mapMemberRow(
  row: ChannelMemberRow,
  profile: ProfileRef | undefined,
  opts: MapMemberOptions
): ChannelMember {
  const isSelf = row.user_id === opts.viewerUserId;
  const presence = opts.presence;
  return {
    channelId: row.channel_id,
    userId: row.user_id,
    role: row.role as ChannelRole,
    workspaceRole: opts.workspaceRole ?? null,
    lastReadAt: row.last_read_at,
    notifyScope: isSelf ? ((row.notify_scope as NotifyScope) ?? "all") : null,
    agentToolProfile: isSelf
      ? ((row.agent_tool_profile as AgentToolProfile) ?? "full")
      : null,
    favoritedAt: isSelf ? (row.favorited_at ?? null) : null,
    // ⚠ **VIEWER-ONLY, ON `agentToolProfile`'S PRECEDENT EXACTLY** (2026-09-07, items 10/11).
    // It is nobody else's business whether a given member's agents auto-answer them: the roster
    // says WHO is here, this would say how somebody works. `null` on a peer's row therefore
    // means "not yours to see" and NEVER "that member chose nobody" — the two readings are
    // opposite, which is why the type below is `Setting | null` rather than a bare setting.
    //
    // ⚠ NORMALISED, NOT CAST. `agent_tool_profile` above can get away with `as` + `?? "full"`
    // because its fallback is the widest value; here the fallback direction is a RULING, so the
    // shared coercion owns it (`normalizeUnaddressedResponder`) and an absent column — a
    // pre-migration read — lands on `last_addressed`, per B1.
    unaddressedResponder: isSelf
      ? normalizeUnaddressedResponder(row.unaddressed_responder)
      : null,
    agentOnline: presence?.online ?? false,
    lastSeenAt: presence?.lastSeenAt ?? null,
    addedBy: row.added_by,
    joinedAt: row.joined_at,
    displayName: profile?.display_name ?? null,
    email: profile?.email ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

/**
 * Task row -> DTO. Pure — the task is the authoritative status/mode store.
 *
 * ⚠ `lastActivityAt` rides through ONLY when the row came from the activity
 * view ({@link ChannelTaskActivityRow}). On a single-row load it is ABSENT, and
 * absent means "this view did not derive it" — never "no activity" and never
 * "same as created_at" (INVARIANTS §9: omitting the field says this view did
 * not ask). Anything ordering or windowing by it must read it from the LIST.
 */
export function mapTaskRow(
  row: ChannelTaskRow | ChannelTaskActivityRow
): ChannelThread {
  const lastActivityAt =
    "last_activity_at" in row ? { lastActivityAt: row.last_activity_at } : {};
  return {
    ...lastActivityAt,
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: row.status as ThreadStatus,
    outcome: (row.outcome as ThreadOutcome | null) ?? null,
    mode: row.mode as ThreadMode,
    createdBy: row.created_by,
    targetUserId: row.target_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    outcomeSummary: row.outcome_summary ?? null,
  };
}
