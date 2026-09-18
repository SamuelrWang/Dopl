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
 * Channel resource GRANTS — the read half (M0) and the write half (M1). The grant
 * map behind the `channelGrants` sibling key of `GET /api/knowledge/bases?
 * channelId=`, and the three-state write behind
 * `PUT /api/knowledge/bases/[baseId]/channel-grants`.
 *
 * ⚠ **THE GUEST LANE'S OWN GATES (M2) LEFT THIS FILE ON 2026-09-17** with the
 * lane they fenced — see the block below the imports.
 *
 * 🔒 §3.3: THIS MODULE IMPORTS NOTHING FROM `service-shared.ts`'s GATE HALF.
 * Those gates encode the WORKSPACE audience — `canSeeBase` refuses a
 * private-to-guest KB and `assertBaseVisible` (via `requireEffectiveAccess`)
 * refuses guests outright, because `defaultLevelForRole("guest")` is `null` —
 * which is the wrong question for a channel-scoped grant. ⚠ The rule outlived the
 * lane: a grant is a CHANNEL-scoped fact, and reasoning about it through the
 * workspace audience is the mistake this line has always been about.
 *
 * ⚠ THE CALLER FENCES the base (route → `getBaseById`) and the channel
 * (route → `isChannelVisibleTo`); the ONE question this file answers itself is
 * `canManage`.
 */

/**
 * ⚠ **`ChannelKnowledgeContext`, `listVisibleChannelGrants`, `assertGrantVisible`
 * AND `assertGrantWritable` ARE DELETED (Samuel's ruling R-18, 2026-09-17).**
 * They were the GUEST LANE'S OWN GATES (M2) — fences 3 and 4 of
 * `/api/channels/[channelId]/knowledge/**`. That lane had no UI host after
 * 2026-09-04, so its tab, hook, client module, three route files,
 * `shared/api/channel-knowledge-lane.ts` and `service-channel-lane.ts` are all
 * gone; four functions guarding routes that no longer exist are dead code, not
 * inventory (INVARIANTS §15). ⚠ **THE GRANT ROW ITSELF IS UNTOUCHED** — it is
 * still written (`setChannelKnowledgeGrant`), still read to badge the KB list
 * ({@link getChannelGrantMap}, {@link listSharedIntoChannelBaseIds}) and still
 * reaches agents through `shared/tenancy/resource-grant-reach.ts`. What is gone
 * is the channel-side HUMAN read of a granted base. ⚠ Re-adding one means
 * writing these gates again, not un-commenting them.
 */

/**
 * Ceiling on the lane's base list. ⚠ Same reason as {@link BASE_GRANT_LIMIT}:
 * PostgREST truncates an un-limited select silently, and a channel with 200
 * knowledge bases shared into it is a bug report rather than a page to
 * paginate.
 */
export const CHANNEL_GRANT_LIMIT = 200;

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
 * WHICH OF `baseIds` IS SHARED INTO AT LEAST ONE CHANNEL — the set behind the
 * card's `Shared` pill (2026-09-01, Samuel: a base shared into a channel was
 * still wearing "Private").
 *
 * ⚠ **A SET, NOT A COUNT AND NOT A CHANNEL LIST.** The pill asks one boolean
 * per base — "has this left my private shelf" — and answering it with anything
 * richer would put channel identities on the wire for a surface that renders
 * none of them (§9, and the leak `listChannelGrantsForBase`'s docblock warns
 * about from the other direction).
 *
 * ⚠ **NO FENCE BEYOND THE CALLER'S OWN BASE LIST, AND THAT IS SUFFICIENT
 * HERE.** `baseIds` comes from `listBases`, which is already visibility-fenced,
 * so the answer only ever concerns bases the caller can see; the grants read is
 * `workspace_id`-filtered on top. What is deliberately NOT done is intersecting
 * the grants with the caller's visible CHANNELS — a base the operator shared
 * into a room they were later removed from is still shared, and reporting it as
 * private would understate the base's own exposure to its own owner.
 */
export async function listSharedIntoChannelBaseIds(
  workspaceId: string,
  baseIds: string[]
): Promise<string[]> {
  return listSharedBaseIds(
    supabaseAdmin(),
    workspaceId,
    baseIds,
    // ⚠ The ceiling is over GRANT ROWS, not bases: one base granted into four
    // channels spends four. `CHANNEL_GRANT_LIMIT` per base is the same bound
    // the per-channel lane carries, and the de-duplication happens after it.
    CHANNEL_GRANT_LIMIT * Math.max(1, baseIds.length)
  );
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
 * 🔒 ⚠ THE SOURCE IS NOW CONSULTED HERE, AND THAT PARAGRAPH IS WHY (2026-08-27).
 * It used to read: *"THE SOURCE IS NOT CONSULTED, because the ROUTE is
 * `sessionOnly` and no agent token can reach it. If that gate is ever relaxed,
 * this is where an `ctx.source === "agent"` refusal belongs."* The gate was
 * relaxed the moment this function gained a SECOND caller —
 * `service-base-writes.ts › createBase`'s create-and-share branch, reached from
 * `POST /api/knowledge/bases`, which is **not** `sessionOnly` and must not
 * become so (MCP `kb_create_base` rides it). Rather than pin the new route, the
 * refusal moved to the one place both callers pass through: **an agent token
 * cannot widen its operator's audience, whichever door it comes in by.**
 *
 * ⚠ THE PUT ROUTE'S `sessionOnly` STAYS. Two statements of one rule is normally
 * the defect this repo pays for, but these are different fences: the route
 * refuses the CREDENTIAL at the door (so no agent-token request is even
 * parsed), this refuses the ACT. Removing either is a widening.
 *
 * ⚠ `AgentWriteDisabledError` rather than a new type, matching `createBase`'s
 * existing human-only refusal for teams scope — "sharing scope is a human-only
 * setting" is the same sentence, and it maps to 403 `AGENT_WRITE_DISABLED`.
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
  // 🔒 SAMUEL'S RULING 2026-09-17 — channel scope is a HOME-channel mechanism.
  // ⚠ IT FENCES `"none"` TOO, i.e. the DELETE as well as the lend: this door has
  // nothing to remove in a standard workspace (the migration converted those
  // rows), and a delete that silently succeeded would teach a client that the
  // three-state control still works here. ⚠ The channel is already fenced to
  // `ctx.workspaceId` by the route's `isChannelVisibleTo` / the create branch's
  // own fence, so the CALLER's container IS the channel's.
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
 * Did the GRANT VALIDITY TRIGGER refuse this write?
 *
 * ⚠ The question it answers widened in Wave B and the code did not have to.
 * `enforce_resource_grant()` (`20260914120000`) refuses on eight branches, not
 * one — an unknown scope, an unknown resource, a row filed under the wrong
 * container, and four ways the GRANTOR may not reach both sides — and every one
 * of them is the same answer to a caller: refused, not broken. So this stays a
 * predicate over the prefix rather than growing a branch per RAISE.
 *
 * `RAISE EXCEPTION` with no `ERRCODE` is `P0001` (`raise_exception`), which is
 * also what any other `plpgsql` RAISE in the write path would be — so the
 * MESSAGE PREFIX is checked too, and both must match. ⚠ A bare `P0001` match
 * would relabel an unrelated trigger's failure as a refused grant and hand the
 * user a wrong explanation with a confident 400.
 *
 * `23514` (check_violation) rides along for the per-scope `level` CHECK, and
 * `23503` (foreign_key_violation) for the workspace row disappearing between the
 * route's fence and this write. Same class of answer.
 */
function isGrantValidityViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "23503" || code === "23514") return true;
  return code === "P0001" && (message ?? "").includes("resource_grants:");
}
