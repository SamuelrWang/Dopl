import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole } from "@/features/workspaces/types";
import { assertChannelScopeAllowedInContainer } from "@/shared/tenancy/channel-scope";
import type {
  ChannelGrantLevelInput,
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeContext,
} from "../types";
import {
  AgentWriteDisabledError,
  ChannelGrantInvalidError,
  ScopeChangeForbiddenError,
} from "./errors";
import {
  deleteChannelKnowledgeGrant,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  listSharedBaseIds,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";

/**
 * Channel resource grants — the map behind the `channelGrants` key of
 * `GET /api/knowledge/bases?channelId=`, and the three-state write behind
 * `PUT /api/knowledge/bases/[baseId]/channel-grants`.
 *
 * This module imports nothing from `service-shared.ts`'s gate half: those gates
 * encode the workspace audience (`canSeeBase` refuses a private-to-guest KB,
 * `assertBaseVisible` refuses guests outright), which is the wrong question for
 * a channel-scoped grant.
 *
 * The caller fences the base (route → `getBaseById`) and the channel
 * (route → `isChannelVisibleTo`); the one question answered here is
 * `canManage`.
 */

/**
 * R-18 (2026-09-17): the guest lane's own gates (`ChannelKnowledgeContext`,
 * `listVisibleChannelGrants`, `assertGrantVisible`, `assertGrantWritable`) are
 * deleted with the lane they fenced. The grant row itself is untouched — still
 * written, still read to badge the KB list, still reaching agents through
 * `shared/tenancy/resource-grant-reach.ts`. Re-adding a channel-side human read
 * means writing these gates again.
 */

/**
 * Ceiling on the lane's base list. Same reason as {@link BASE_GRANT_LIMIT}:
 * PostgREST truncates an un-limited select silently.
 */
export const CHANNEL_GRANT_LIMIT = 200;

/**
 * `{ baseId → {level, guestWrite} }` for the grants on `channelId` among
 * `baseIds`. Both levels ride the map so the UI can badge `agent_only`. A base
 * with no grant is absent from the map (never `'none'`).
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

/**
 * Which of `baseIds` is shared into at least one channel — the set behind the
 * card's `Shared` pill.
 *
 * A set, not a count and not a channel list: anything richer would put channel
 * identities on the wire for a surface that renders none of them.
 *
 * `baseIds` comes from the already visibility-fenced `listBases` and the grants
 * read is `workspace_id`-filtered on top, so no further fence is needed. The
 * grants are deliberately NOT intersected with the caller's visible channels: a
 * base shared into a room they were later removed from is still shared, and
 * reporting it as private would understate the base's exposure to its owner.
 */
export async function listSharedIntoChannelBaseIds(
  workspaceId: string,
  baseIds: string[]
): Promise<string[]> {
  return listSharedBaseIds(
    supabaseAdmin(),
    workspaceId,
    baseIds,
    // The ceiling is over grant rows, not bases: one base granted into four
    // channels spends four. De-duplication happens after it.
    CHANNEL_GRANT_LIMIT * Math.max(1, baseIds.length)
  );
}

/**
 * Ceiling on the settings section's read — the other direction of the same table
 * ("which channels is this KB shared into"). Same reason as
 * `repository-overview.ts › VISIBLE_CHANNEL_LIMIT`: PostgREST truncates an
 * un-limited select silently.
 */
export const BASE_GRANT_LIMIT = 200;

/**
 * `{ channelId → {level, guestWrite} }` for one base, across the channels it is
 * granted into — the settings section's inverted question.
 *
 * Not fenced, and must not be printed raw: it returns grants on channels the
 * caller may not see. The route intersects it with the caller's visible channel
 * list, and that intersection goes on the wire. A grant on an invisible channel
 * reads as absent — fewer rows, never a name.
 */
export async function getBaseGrantMap(
  workspaceId: string,
  baseId: string
): Promise<Record<string, ChannelResourceGrant>> {
  const rows = await listChannelGrantsForBase(
    supabaseAdmin(),
    workspaceId,
    baseId,
    BASE_GRANT_LIMIT
  );
  const map: Record<string, ChannelResourceGrant> = {};
  for (const row of rows) {
    map[row.channel_id] = { level: row.level, guestWrite: row.guest_write };
  }
  return map;
}

/**
 * May this caller change who this KB reaches? — creator or workspace admin+.
 *
 * It mirrors the sharing gate, not the write gate:
 * `service-shared.ts › assertBaseWritable` admits any member with an `edit`
 * grant, which is right for content and wrong for audience. Same predicate as
 * `service-base-writes.ts › updateBase` on scope changes and
 * `components/kb-sharing-section.tsx › canManage`.
 *
 * Boolean, not a throw, because the settings read needs the same answer to pick
 * between the editor and the read-only summary.
 */
export function canManageChannelGrants(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): boolean {
  return base.createdBy === ctx.userId || meetsMinRole(ctx.role, "admin");
}

/**
 * Set one (KB, channel) grant to its three-state end value. Returns the stored
 * grant, or `null` for `"none"` — `null` means "remove the key", never "level
 * none".
 *
 * `level: "none"` deletes the row: absence is the third state, and the CHECK
 * constraint would refuse a `'none'` row.
 *
 * `guestWrite` is forced false at `agent_only`. That level has no human
 * audience, so a stored `true` would be a latent permission that comes back on
 * the moment someone raises the level.
 *
 * The source is consulted here rather than on a route because
 * `service-base-writes.ts › createBase`'s create-and-share branch is a second
 * caller, reached from `POST /api/knowledge/bases`, which is not `sessionOnly`
 * and must not become so (MCP `kb_create_base` rides it). An agent token cannot
 * widen its operator's audience, whichever door it comes in by. The PUT route's
 * `sessionOnly` stays — it refuses the credential at the door, this refuses the
 * act; removing either is a widening.
 */
export async function setChannelKnowledgeGrant(
  ctx: KnowledgeContext,
  base: KnowledgeBase,
  input: { channelId: string; level: ChannelGrantLevelInput; guestWrite: boolean }
): Promise<ChannelResourceGrant | null> {
  if (ctx.source === "agent") {
    throw new AgentWriteDisabledError(
      base.slug,
      "Sharing a knowledge base into a channel is a human-only setting — an agent cannot change who can read it."
    );
  }
  if (!canManageChannelGrants(ctx, base)) throw new ScopeChangeForbiddenError();
  // Channel scope is a home-channel mechanism (2026-09-17), and it fences
  // `"none"` too: a DELETE that silently succeeded would teach a client the
  // three-state control still works here. The channel is already fenced to
  // `ctx.workspaceId` upstream, so the caller's container is the channel's.
  await assertChannelScopeAllowedInContainer(ctx.workspaceId);

  const db = supabaseAdmin();
  if (input.level === "none") {
    await deleteChannelKnowledgeGrant(
      db,
      ctx.workspaceId,
      input.channelId,
      base.id
    );
    return null;
  }

  const guestWrite = input.level === "visible" ? input.guestWrite : false;
  try {
    const row = await upsertChannelKnowledgeGrant(db, {
      workspaceId: ctx.workspaceId,
      channelId: input.channelId,
      baseId: base.id,
      level: input.level,
      guestWrite,
      createdBy: ctx.userId,
    });
    return { level: row.level, guestWrite: row.guest_write };
  } catch (err) {
    if (isGrantValidityViolation(err)) throw new ChannelGrantInvalidError();
    throw err;
  }
}

/**
 * Did the grant validity trigger refuse this write?
 *
 * `enforce_resource_grant()` refuses on eight branches and all of them mean the
 * same thing to a caller — refused, not broken — so this is a predicate over the
 * message prefix rather than a branch per RAISE.
 *
 * `RAISE EXCEPTION` with no `ERRCODE` is `P0001`, which any other `plpgsql`
 * RAISE in this write path would also be, so the message prefix must match too:
 * a bare `P0001` match would relabel an unrelated failure as a refused grant.
 *
 * `23514` rides along for the per-scope `level` CHECK and `23503` for the
 * workspace row disappearing between the route's fence and this write.
 */
function isGrantValidityViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "23503" || code === "23514") return true;
  return code === "P0001" && (message ?? "").includes("resource_grants:");
}
