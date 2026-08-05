import type { ChannelAgent } from "../types";

/**
 * DB row shape + mapper for `channel_agents` — the ATTRIBUTION READ, and the
 * only thing left of the multiplayer tables in this lane.
 *
 * Named agents are gone (rollback §1) and nothing writes this table any more,
 * but stored messages carry `metadata.author_agent_id` and the transcript still
 * has to name the handle that wrote them. So the row is still read, and mapped
 * down to the three fields attribution needs.
 *
 * `channel_task_participants` had its row shape and mapper here too; breakout
 * rooms went with the addressing and nothing reads that table now.
 *
 * Hand-written rather than pulled from the generated `Database` type — the same
 * cast-at-the-boundary pattern the rest of the channels feature uses (`dto.ts`,
 * `collab-dto.ts`), since the repository talks to the untyped `supabaseAdmin()`
 * client.
 */

export type ChannelAgentRow = {
  id: string;
  channel_id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  status: string;
  /** Historical: when a HUMAN last addressed it. Never written any more. */
  engaged_at: string | null;
  /** Historical: the human who engaged it. Never written any more. */
  engaged_by: string | null;
  created_at: string;
  updated_at: string;
};

export function mapAgentRow(row: ChannelAgentRow): ChannelAgent {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
  };
}
