/** Split out of `dto.ts` (2026-09-14, 500-line cap): the hand-written DB row shapes and the per-caller state layered onto them; the mappers that consume them stay in `dto.ts`, which re-exports every name here. */
import "server-only";
import type {
  AgentToolProfile,
  ChannelContainer,
  ChannelDirectPeer,
  ChannelPeer,
  ChannelPendingLink,
  ChannelRole,
  NotifyScope,
} from "../types";
import type { Role } from "@/features/workspaces/types";

/**
 * DB row shapes for the channels tables. Hand-written because
 * `src/shared/supabase/types.ts` is not regenerated for this migration — the
 * same cast pattern chats uses for its newer columns. The repository casts
 * Supabase results to these shapes at the boundary.
 */
export type ChannelRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  slug: string;
  name: string;
  topic: string;
  visibility: string;
  is_direct: boolean;
  direct_key: string | null;
  // ── THE POSTURE CEILING (20260912120000, A9 — G6/G7) ────────────────────
  // ⚠ OPTIONAL ON THE TYPE for `info_card`'s reason: these row shapes are CAST
  // from PostgREST results, so a server reading a database whose migration has
  // not landed sees no such key at all. `undefined` and `null` are one answer
  // here — "no ceiling is recorded" — and neither is "unrestricted".
  agent_tool_ceiling?: string | null;
  agent_message_ceiling?: string | null;
  agent_chain_allowed?: boolean | null;
  // ⚠ **`default_responder_agent_name` IS OFF THIS ROW TYPE (2026-09-07, Samuel's ruling on
  // items 10 and 11).** It was the room-wide pin of ONE agent to answer EVERY member's
  // untagged messages; the question is per-person now and its answer lives on
  // `channel_members.unaddressed_responder` ({@link ChannelMemberRow}).
  //
  // ⚠ THE COLUMN IS STILL ON THE TABLE and this is not an oversight: `20260928130000` retires
  // it non-destructively so the previous release stays runnable. Taking it off the ROW TYPE is
  // the reader's half of that fence — a mapper that still reached for it would be a live read
  // of a value the product no longer has a meaning for.
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The curated Main-info card (`20260825120000_channel_info_card.sql`).
   *
   * ⚠ TYPED `unknown`, NOT `ChannelInfoCard`, and that is the whole discipline:
   * this is a row shape, and the database's only promise is a bounded JSON
   * OBJECT. Narrowing it here would let every reader treat stored bytes as
   * validated ones. {@link mapChannelRow} runs it through `parseInfoCard`,
   * which is where it becomes a card.
   *
   * ⚠ OPTIONAL, because a row read by a server whose migration has not landed
   * has no such key — and because the hand-written row types in this file are
   * cast from PostgREST results, so a missing column is `undefined` rather than
   * a type error.
   */
  info_card?: unknown;
};

export type ChannelTaskRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  title: string;
  status: string;
  outcome: string | null;
  mode: string;
  created_by: string;
  target_user_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  outcome_summary: string | null;
};

/**
 * The same task row read through `channel_tasks_activity` (migration
 * `20260818120000`), which adds the ONE derived column the base table cannot
 * hold: when the thread last saw real activity, off `channel_messages`.
 *
 * ⚠ A DISTINCT TYPE, not the base row with an optional field (INVARIANTS §9):
 * the presence of `last_activity_at` is what says this read DERIVED the clock.
 * A single-row load off `channel_tasks` did not, and must not be able to
 * pass itself off as having done so.
 */
export type ChannelTaskActivityRow = ChannelTaskRow & {
  /**
   * Newest non-proposal message tagged for the thread, falling back to the
   * thread's own `created_at`. NEVER `channel_tasks.updated_at` — see
   * `repository-tasks.ts › updateTask`.
   */
  last_activity_at: string;
};

/** The columns `listTasksByChannel` reads off `channel_tasks_activity`. ⚠ Not
 *  `*`: the view carries `client_msg_id`, which is an idempotency key and no
 *  reader's business (INVARIANTS §9). Must stay in step with
 *  {@link ChannelTaskActivityRow}. */
export const CHANNEL_TASK_ACTIVITY_COLS =
  "id,channel_id,workspace_id,title,status,outcome,mode,created_by,target_user_id,created_at,updated_at,closed_at,outcome_summary,last_activity_at";

export type ChannelMemberRow = {
  channel_id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  last_read_at: string | null;
  notify_scope: string;
  agent_tool_profile: string;
  /**
   * **WHO ANSWERS THIS MEMBER'S UNTAGGED MESSAGES IN THIS CHANNEL**
   * (`20260928130000` — Samuel's ruling on items 10 and 11). `'none'` or
   * `'last_addressed'`; the column is `NOT NULL DEFAULT 'last_addressed'`.
   *
   * ⚠ OPTIONAL ON THE TYPE, on the `info_card` / ceiling precedent: these row shapes are CAST
   * from PostgREST results, so a server reading a database whose migration has not landed sees
   * no such key at all. ⚠ **AND ABSENT MEANS THE DEFAULT, NEVER `'none'`** — that direction is
   * the ruling (`lib/agent-mentions.ts › normalizeUnaddressedResponder`), because `'none'`
   * silences a member who never chose it and the failure looks exactly like the setting working.
   *
   * ⚠ **A PRIVATE PER-MEMBER SETTING — same class as `agent_tool_profile`, scrubbed by the same
   * rule in {@link mapMemberRow}, and in NO GRANT list** (the migration's whole §"IT IS
   * PRIVATE"). Typed `string` rather than the union for `info_card`'s reason: the database's
   * only promise is text, and the CHECK is enforced there, not here. The mapper coerces.
   */
  unaddressed_responder?: string | null;
  /** When this member favourited this channel; null = not favourited
   *  (`20260819120000`). A PRIVATE per-member preference — same class as
   *  `agent_tool_profile`, and scrubbed by the same rule in
   *  {@link mapMemberRow}. */
  favorited_at: string | null;
  added_by: string | null;
  joined_at: string;
};

export type ChannelMessageRow = {
  id: string;
  seq: number;
  channel_id: string;
  workspace_id: string;
  author_user_id: string | null;
  author_kind: string;
  kind: string;
  body: string;
  metadata: unknown;
  client_msg_id: string | null;
  created_at: string;
  // ── THE DELIVERY KEYSTONE (20260912120000) ──────────────────────────────
  // ⚠ NULL IS "NOT ANSWERED HERE", NEVER "NOBODY" AND NEVER "NO". A row written
  // before the resolver carries NULL on all five, and `mapMessageRow` passes
  // that through rather than inventing a verdict — the desktop's fallback and
  // the MCP result line both key on it. Optional on the TYPE as well, because a
  // deployment whose migration has not landed reads back a row without the
  // columns at all.
  wake_verdict?: string | null;
  recipient_user_ids?: string[] | null;
  recipient_agent_ids?: string[] | null;
  delivery?: string | null;
  delivery_at?: string | null;
  // ── ARTIFACT MEMBERSHIP (20260926120000) ────────────────────────────────
  // ⚠ OPTIONAL IN THE TYPE, NULLABLE IN THE COLUMN, and both spellings mean the
  // same thing to every reader: not folded. Optional because a build whose
  // database has not run the migration yet still type-checks against rows that
  // lack the key — the same accommodation `wake_verdict` and the delivery
  // columns make one block up.
  artifact_id?: string | null;
};

/**
 * A `channel_artifacts` row — the card, never its members. Membership lives on
 * `channel_messages.artifact_id` and is read separately
 * (`repository-artifacts.ts`), because a list on the artifact is the shape the
 * design deliberately did NOT choose (#1220 §2).
 */
export type ChannelArtifactRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  name: string;
  summary: string;
  created_by: string;
  created_by_agent: string | null;
  dissolved_at: string | null;
  client_msg_id: string | null;
  created_at: string;
};

export type ProfileRef = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/** Per-caller state layered onto a channel row to form the list DTO. */
export interface ChannelViewerState {
  memberCount: number;
  lastMessageAt: string | null;
  role: ChannelRole | null;
  lastReadAt: string | null;
  /** The caller's own notify scope, null when they are not a member. */
  notifyScope: NotifyScope | null;
  /** The caller's own agent tool profile, null when they are not a member. */
  agentToolProfile: AgentToolProfile | null;
  /**
   * When the CALLER favourited this channel; null = not favourited, and null
   * for a non-member. ⚠ Read off the caller's OWN membership row, which
   * `listChannels` already loads — this is what lets the sidebar's Favorites
   * section exist with no extra read and no new endpoint.
   */
  favoritedAt: string | null;
  /** Members whose agent is currently online. */
  onlineMemberCount: number;
  /** The resolved peer for a direct channel; null for a normal channel. */
  directPeer: ChannelDirectPeer | null;
  /**
   * 🔒 THE ROW EXTRAS (R-26) — the container address, the caller's role in it,
   * the roster sample, the `@ N` count and the open bound link. ⚠ **REQUIRED, not
   * optional, so a second list path cannot silently omit one**: the whole point of
   * one projection is that every row of every scope carries the same shape.
   */
  container: ChannelContainer;
  workspaceRole: Role | null;
  peers: ChannelPeer[];
  mentionCount: number;
  linkOut: ChannelPendingLink | null;
}

/** Presence layered onto a member row (derived from agent_presence). */
export interface MemberPresence {
  online: boolean;
  lastSeenAt: string | null;
}

/** Everything the member mapper needs beyond the row + profile. */
export interface MapMemberOptions {
  /**
   * The caller. ⚠ REQUIRED, not optional, so the privacy rule cannot be
   * forgotten at a call site: `notifyScope` / `agentToolProfile` are personal
   * preferences and render only on the viewer's OWN row.
   */
  viewerUserId: string;
  presence?: MemberPresence;
  /**
   * The member's WORKSPACE role, for the roster's "Guest" pill. ⚠ Optional: only
   * the roster read resolves it (the member-mutation echoes don't), so it maps to
   * `workspaceRole: null` when absent — a fail-safe the renderer reads as "not a
   * guest". Never inferred from the channel `role`, which has no `guest`.
   */
  workspaceRole?: Role | null;
}
