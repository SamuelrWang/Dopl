import type {
  AgentStatus,
  ChannelAgent,
  ParticipantKind,
  ThreadParticipant,
} from "../types";

/**
 * DB row shapes + mappers for the multiplayer tables (`channel_agents`,
 * `channel_task_participants`). Hand-written rather than pulled from the
 * generated `Database` type — the same cast-at-the-boundary pattern the rest of
 * the channels feature uses (`dto.ts`, `collab-dto.ts`), since the repository
 * talks to the untyped `supabaseAdmin()` client.
 *
 * Kept out of `dto.ts` (239 lines) so that file stays clear of the §2 cap.
 */

export type ChannelAgentRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  status: string;
  /** When a HUMAN last addressed it. Null = idle. Never swept server-side. */
  engaged_at: string | null;
  /** The human who engaged it (audit + who it is listening for). */
  engaged_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ThreadParticipantRow = {
  id: string;
  task_id: string;
  workspace_id: string;
  kind: string;
  user_id: string | null;
  agent_id: string | null;
  added_by: string | null;
  created_at: string;
};

export function mapAgentRow(row: ChannelAgentRow): ChannelAgent {
  return {
    id: row.id,
    channelId: row.channel_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    status: row.status as AgentStatus,
    // `?? null` rather than a bare read: a row selected from a deployment that
    // predates the engagement migration has no such property, and `undefined`
    // on the wire would make every consumer distinguish "idle" from "unknown".
    engagedAt: row.engaged_at ?? null,
    engagedBy: row.engaged_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `task_id` -> `threadId` is the storage/domain boundary (§8: the table keeps
 * the `task` spelling on purpose). The two identity columns are carried through
 * as-is rather than collapsed into one field: the DB CHECK already guarantees
 * exactly one is set for a given `kind`, and collapsing them would make a
 * caller re-derive which one it is holding.
 */
export function mapParticipantRow(
  row: ThreadParticipantRow
): ThreadParticipant {
  return {
    id: row.id,
    threadId: row.task_id,
    workspaceId: row.workspace_id,
    kind: row.kind as ParticipantKind,
    userId: row.user_id,
    agentId: row.agent_id,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}
