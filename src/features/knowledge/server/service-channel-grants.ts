import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelResourceGrant } from "../types";
import { listChannelKnowledgeGrants } from "./repository-channel-grants";

/**
 * Channel resource GRANTS — read half (M0). The grant map behind the
 * `channelGrants` sibling key of `GET /api/knowledge/bases?channelId=`.
 *
 * 🔒 §3.3: THIS MODULE IMPORTS NOTHING FROM `service-shared.ts`'s GATE HALF.
 * Those gates encode the WORKSPACE audience — `canSeeBase` refuses a
 * private-to-guest KB and `assertBaseVisible` (via `requireEffectiveAccess`)
 * refuses guests outright — which is the wrong question for a channel-scoped
 * grant. The channel lane (M2) will own its own gates; M0 only reads the map
 * for callers who have ALREADY cleared the workspace floor and the channel
 * visibility fence at the route.
 *
 * ⚠ The CALLER fences the channel first. This service assumes `channelId` was
 * proved visible to the caller (route → `isChannelVisibleTo`) and that `baseIds`
 * is the caller's already-visibility-filtered base list. It adds no oracle of
 * its own; the id set is the boundary.
 */

/**
 * `{ baseId → {level, guestWrite} }` for the grants ON `channelId` among
 * `baseIds`. Includes BOTH levels — `agent_only` rides the map so the UI can
 * badge it; the read lane, not this map, is where `agent_only` becomes a 404.
 * A base with no grant is ABSENT from the map (never `'none'`).
 */
export async function getChannelGrantMap(
  workspaceId: string,
  channelId: string,
  baseIds: string[]
): Promise<Record<string, ChannelResourceGrant>> {
  const rows = await listChannelKnowledgeGrants(
    supabaseAdmin(),
    workspaceId,
    channelId,
    baseIds
  );
  const map: Record<string, ChannelResourceGrant> = {};
  for (const row of rows) {
    map[row.resource_id] = { level: row.level, guestWrite: row.guest_write };
  }
  return map;
}
