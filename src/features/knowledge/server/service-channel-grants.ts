import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole } from "@/features/workspaces/types";
import type {
  ChannelGrantLevelInput,
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeContext,
} from "../types";
import { ChannelGrantInvalidError, ScopeChangeForbiddenError } from "./errors";
import {
  deleteChannelKnowledgeGrant,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";

/**
 * Channel resource GRANTS — the read half (M0) and the write half (M1). The
 * grant map behind the `channelGrants` sibling key of
 * `GET /api/knowledge/bases?channelId=`, and the three-state write behind
 * `PUT /api/knowledge/bases/[baseId]/channel-grants`.
 *
 * 🔒 §3.3: THIS MODULE IMPORTS NOTHING FROM `service-shared.ts`'s GATE HALF.
 * Those gates encode the WORKSPACE audience — `canSeeBase` refuses a
 * private-to-guest KB and `assertBaseVisible` (via `requireEffectiveAccess`)
 * refuses guests outright — which is the wrong question for a channel-scoped
 * grant. The channel lane (M2) will own its own gates; this module only serves
 * callers who have ALREADY cleared the workspace floor and the channel
 * visibility fence at the route.
 *
 * ⚠ The CALLER fences the channel AND the base first, and the write half is
 * the reason that sentence is load-bearing rather than tidy. This service
 * assumes `channelId` was proved visible to the caller (route →
 * `isChannelVisibleTo`), that the `KnowledgeBase` it is handed came back from
 * the workspace service's own 404 gate (route → `getBaseById`), and that
 * `baseIds` is the caller's already-visibility-filtered list. It adds no oracle
 * of its own; those two fences are the boundary, and the ONE question it
 * answers itself is `canManage` (below).
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

/**
 * Ceiling on the settings section's read — the OTHER direction of the same
 * table ("which channels is this KB shared into"). ⚠ Same reason as
 * `repository-overview.ts › VISIBLE_CHANNEL_LIMIT`: PostgREST truncates an
 * un-limited select SILENTLY, and a KB shared into 200 channels is a bug
 * report, not a page to paginate.
 */
export const BASE_GRANT_LIMIT = 200;

/**
 * `{ channelId → {level, guestWrite} }` for ONE base, across the channels it is
 * granted into. Behind the settings section, where the question is inverted:
 * one KB, many channels.
 *
 * ⚠ IT IS NOT FENCED AND MUST NOT BE PRINTED RAW. It returns grants on channels
 * the caller may not see; the ROUTE intersects it with the caller's own visible
 * channel list, and that intersection — not this map — is what goes on the
 * wire. A grant on an invisible channel therefore reads as absent, which is the
 * fail-safe direction: the section shows fewer rows, never a name.
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
 * MAY THIS CALLER CHANGE WHO THIS KB REACHES? — creator or workspace admin+,
 * and nobody else.
 *
 * ⚠ IT MIRRORS THE SHARING GATE RATHER THAN THE WRITE GATE, deliberately.
 * `service-shared.ts › assertBaseWritable` would admit any member with an
 * `edit` grant — correct for CONTENT, wrong for AUDIENCE: editing a page and
 * deciding which channel (and which guest) can read the whole base are
 * different powers. The predicate is the same one
 * `service-base-writes.ts › updateBase` applies to scope changes and
 * `components/kb-sharing-section.tsx › canManage` renders, so all three agree
 * about who owns sharing.
 *
 * ⚠ Boolean, not a throw, because the settings READ needs the same answer to
 * decide between the editor and the read-only summary.
 */
export function canManageChannelGrants(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): boolean {
  return base.createdBy === ctx.userId || meetsMinRole(ctx.role, "admin");
}

/**
 * Set ONE (KB, channel) grant to its three-state end value. Returns the stored
 * grant, or `null` for `"none"` — the shape the caller patches its cache with,
 * where `null` means "remove the key", never "level none".
 *
 * ⚠ `level: "none"` DELETES THE ROW. Absence is the third state (§1); a
 * `'none'` row would be a fourth, and the CHECK constraint would refuse it.
 *
 * ⚠ `guestWrite` IS FORCED FALSE AT `agent_only`. That level has no human in
 * its audience at all, so a stored `true` there would be a latent permission
 * waiting for someone to raise the level — the flag would silently come back ON
 * with the audience. Re-raising to `visible` therefore always starts from OFF
 * unless the caller says otherwise, which is the same default the schema sets.
 *
 * ⚠ THE SOURCE IS NOT CONSULTED, because the ROUTE is `sessionOnly` and no
 * agent token can reach it. If that gate is ever relaxed, this is where an
 * `ctx.source === "agent"` refusal belongs — do not conclude from its absence
 * that an agent may set grants.
 */
export async function setChannelKnowledgeGrant(
  ctx: KnowledgeContext,
  base: KnowledgeBase,
  input: { channelId: string; level: ChannelGrantLevelInput; guestWrite: boolean }
): Promise<ChannelResourceGrant | null> {
  if (!canManageChannelGrants(ctx, base)) throw new ScopeChangeForbiddenError();

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
 * Did the same-workspace VALIDITY TRIGGER refuse this write?
 *
 * `RAISE EXCEPTION` with no `ERRCODE` is `P0001` (`raise_exception`), which is
 * also what any other `plpgsql` RAISE in the write path would be — so the
 * MESSAGE PREFIX is checked too, and both must match. ⚠ A bare `P0001` match
 * would relabel an unrelated trigger's failure as a cross-workspace grant and
 * hand the user a wrong explanation with a confident 400.
 *
 * `23503` (foreign_key_violation) rides along: the channel or workspace row
 * disappearing between the route's fence and this write is the same class of
 * answer — refused, not broken.
 */
function isGrantValidityViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "23503") return true;
  return (
    code === "P0001" && (message ?? "").includes("channel_resource_grants:")
  );
}
