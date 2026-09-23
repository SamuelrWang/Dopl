import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole } from "@/features/workspaces/types";
import { assertChannelScopeAllowedInContainer } from "@/shared/tenancy/channel-scope";
import {
  HomeChannelRowNotSharedError,
  isHomeChannelContainer,
} from "@/features/workspaces/server/home-channel-destination";
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
 * Knowledge channel grants: the `channelGrants` map of `GET /api/knowledge/bases?channelId=` and the
 * three-state write of `PUT …/channel-grants`. None of `service-shared.ts`'s gates: they answer the
 * workspace audience, the wrong question for a channel grant. The route fences base and channel.
 */

/** PostgREST truncates an un-limited select silently. */
export const CHANNEL_GRANT_LIMIT = 200;

/** `{ baseId → grant }` on `channelId` among `baseIds`; an ungranted base is absent (never `'none'`). */
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
 * Which of the (already visibility-fenced) `baseIds` is shared into any channel — a set, so no channel
 * identity reaches the wire. Not intersected with the caller's channels: a room they left still counts.
 */
export async function listSharedIntoChannelBaseIds(
  workspaceId: string,
  baseIds: string[]
): Promise<string[]> {
  return listSharedBaseIds(
    supabaseAdmin(),
    workspaceId,
    baseIds,
    // The ceiling counts grant rows, not bases; de-duplication happens after it.
    CHANNEL_GRANT_LIMIT * Math.max(1, baseIds.length)
  );
}

/** Ceiling on the per-base read; PostgREST truncates an un-limited select silently. */
export const BASE_GRANT_LIMIT = 200;

/** `{ channelId → grant }` for one base. Unfenced: the route intersects it with visible channels. */
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
 * Creator or admin+: the sharing gate, not `assertBaseWritable` (an `edit` grant is for content, not
 * audience). Boolean because the settings read uses it to pick editor vs summary.
 */
export function canManageChannelGrants(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): boolean {
  return base.createdBy === ctx.userId || meetsMinRole(ctx.role, "admin");
}

/**
 * Revoke twin of the create's home-channel fence (F-289): dropping a private base's last channel grant
 * would re-mint the orphan `assertCreateBaseAllowed` refuses. The early returns are the create's `shared`
 * expression read backwards, asked of `base.workspaceId` (the row's container, not the call's room).
 */
async function assertRevokeLeavesNoOrphan(
  base: KnowledgeBase,
  channelId: string
): Promise<void> {
  if (base.visibility !== "private") return;
  if (!(await isHomeChannelContainer(base.workspaceId))) return;
  // A grant on any other channel keeps the base shared after this delete.
  const granted = await getBaseGrantMap(base.workspaceId, base.id);
  if (Object.keys(granted).some((id) => id !== channelId)) return;
  throw new HomeChannelRowNotSharedError(
    "A home channel holds only what is shared into it, so this grant was not removed. " +
      "Revoking the last channel grant would leave the knowledge base inside the " +
      "channel's container, where nothing in the app lists it — move it to your home " +
      "space, or delete it, instead."
  );
}

/**
 * Set one (KB, channel) grant; `null` = row deleted (the CHECK refuses a `'none'` row). `guestWrite` is
 * forced false at `agent_only` so raising the level revives no latent permission. The agent refusal is
 * here, not only on the `sessionOnly` PUT, because `createBase`'s create-and-share is a second caller.
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
  // Home-channel-only; fences `"none"` too, so a no-op DELETE can't imply the control works here.
  await assertChannelScopeAllowedInContainer(ctx.workspaceId);

  const db = supabaseAdmin();
  if (input.level === "none") {
    await assertRevokeLeavesNoOrphan(base, input.channelId);
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
 * Did `enforce_resource_grant()` refuse this write? The message prefix must match too: any plpgsql RAISE
 * is `P0001`. `23514` is the per-scope `level` CHECK; `23503` a workspace row vanishing mid-request.
 */
function isGrantValidityViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "23503" || code === "23514") return true;
  return code === "P0001" && (message ?? "").includes("resource_grants:");
}
