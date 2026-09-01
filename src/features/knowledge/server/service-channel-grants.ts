import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole } from "@/features/workspaces/types";
import { isUuid } from "@/shared/lib/id/uuid";
import type {
  ChannelGrantLevelInput,
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeContext,
  WriteSource,
} from "../types";
import {
  AgentWriteDisabledError,
  ChannelGrantInvalidError,
  ChannelGrantReadOnlyError,
  KnowledgeBaseNotFoundError,
  ScopeChangeForbiddenError,
} from "./errors";
import * as repo from "./repository";
import {
  deleteChannelKnowledgeGrant,
  findChannelKnowledgeGrant,
  listChannelGrantsAtLevel,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  listSharedBaseIds,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";

/**
 * Channel resource GRANTS — the read half (M0), the write half (M1), and the
 * GUEST LANE'S OWN GATES (M2). The grant map behind the `channelGrants` sibling
 * key of `GET /api/knowledge/bases?channelId=`, the three-state write behind
 * `PUT /api/knowledge/bases/[baseId]/channel-grants`, and
 * `assertGrantVisible` / `assertGrantWritable` — the two questions every route
 * under `/api/channels/[channelId]/knowledge/**` asks before it reads a row.
 *
 * 🔒 §3.3: THIS MODULE IMPORTS NOTHING FROM `service-shared.ts`'s GATE HALF.
 * Those gates encode the WORKSPACE audience — `canSeeBase` refuses a
 * private-to-guest KB and `assertBaseVisible` (via `requireEffectiveAccess`)
 * refuses guests outright, because `defaultLevelForRole("guest")` is `null` —
 * which is the wrong question for a channel-scoped grant. The lane owns the
 * gates below instead, and `grant-lane.test.ts` scans this file AND
 * `service-channel-lane.ts` for the import that would quietly undo it.
 *
 * ⚠ THE CHANNEL FENCE IS NOT HERE AND MUST NOT MOVE HERE. Nothing in this file
 * proves the caller is in the channel; `ChannelKnowledgeContext.channelId` is
 * taken on trust, and it is only trustworthy because
 * `shared/api/channel-knowledge-lane.ts › requireChannelKnowledgeContext` builds
 * it from a channel the CHANNELS service already resolved and whose membership
 * row it already required. Composing the two features at the route is §3.3's
 * rule (no cross-feature import), and the cost of that rule is this sentence.
 *
 * ⚠ For the M0/M1 halves the CALLER additionally fences the base
 * (route → `getBaseById`) and the channel (route → `isChannelVisibleTo`); the
 * ONE question those halves answer themselves is `canManage`.
 */

/**
 * Request-scoped context for the CHANNEL lane. Deliberately NOT
 * `KnowledgeContext`: it carries a `channelId` and, more to the point, it
 * carries NO `role` and NO `apiKeyWorkspaceId`.
 *
 * 🔒 THE MISSING `role` IS THE DESIGN. Every workspace knowledge gate resolves
 * an access LEVEL from the caller's workspace role, and a guest's is `null` — so
 * a lane function handed a role would sooner or later be "tidied" into asking
 * the workspace question and would answer `no` for exactly the caller this lane
 * exists to serve. There is no role here to tidy with. The lane's authority is
 * the grant row and nothing else.
 */
export interface ChannelKnowledgeContext {
  workspaceId: string;
  channelId: string;
  userId: string;
  /** Session vs. agent token, for the `last_edited_source` stamp and for the
   *  agent refusal in {@link assertGrantWritable}. */
  source: WriteSource;
}

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
 * `{ baseId → grant }` for every base granted onto this channel AT `visible` —
 * the lane's list read, and the ONLY place the guest's base set comes from.
 *
 * ⚠ `agent_only` NEVER ENTERS THIS MAP, and the filter is in SQL rather than in
 * a `.filter()` here. A grant at `agent_only` is a DIFFERENT AUDIENCE, not a
 * lower rung of this one: the operator said "my agent may read this in this
 * room", and the guest sitting in that room was not part of the sentence. Its
 * mere existence must not leak, so it is absent from the list for the same
 * reason it 404s in {@link assertGrantVisible} — those two must always agree, or
 * a base appears in the list and then refuses to open (or worse, the reverse).
 */
export async function listVisibleChannelGrants(
  ctx: ChannelKnowledgeContext
): Promise<Record<string, ChannelResourceGrant>> {
  const rows = await listChannelGrantsAtLevel(
    supabaseAdmin(),
    ctx.workspaceId,
    ctx.channelId,
    "visible",
    CHANNEL_GRANT_LIMIT
  );
  const map: Record<string, ChannelResourceGrant> = {};
  for (const row of rows) {
    map[row.resource_id] = { level: row.level, guestWrite: row.guest_write };
  }
  return map;
}

/**
 * 🔒 FENCES 3 AND 4 OF THE GUEST LANE (§3.2), and the only door to a row on it.
 * Fences 1 and 2 — the `minRole:"guest"` floor and `loadVisibleChannel` with a
 * REQUIRED membership — ran at the route before this was called.
 *
 * Answers with the grant and the base, or throws `KnowledgeBaseNotFoundError`.
 * FOUR different failures collapse into that ONE answer, deliberately:
 *   - `baseId` is not UUID-shaped (it would reach a `uuid =` filter as a 22P02
 *     cast failure — a 500 and a `system_events` row per probe);
 *   - there is NO grant row for (this channel, this base);
 *   - there is one and it is `agent_only` — see {@link listVisibleChannelGrants}
 *     for why that is not a lower level but a different audience;
 *   - the base is deleted, or belongs to another workspace.
 * "Not shared with you", "shared with somebody else" and "does not exist" have
 * to be indistinguishable, or the lane becomes an id oracle for the container's
 * whole knowledge surface.
 *
 * ⚠ THE GRANT IS READ BEFORE THE BASE, and the order is load-bearing rather
 * than incidental: the base read is not narrowed by the channel at all, so
 * doing it first would answer "does this uuid name a live base in this
 * workspace" for every id a guest cares to try, and only then refuse.
 *
 * ⚠ THE SAME-WORKSPACE ASSERT IS REDUNDANT AND STAYS. The
 * `enforce_channel_resource_grant()` trigger already guarantees
 * `knowledge_bases.workspace_id = channels.workspace_id = grant.workspace_id`,
 * and the grant read is workspace-filtered on top of that. It is asserted anyway
 * because the consequence of the trigger being dropped in some future migration
 * is a CROSS-TENANT read by a guest, which is the one outcome the whole design
 * exists to prevent (§1) — and because `findBaseById` takes no workspace id.
 */
export async function assertGrantVisible(
  ctx: ChannelKnowledgeContext,
  baseId: string
): Promise<{ base: KnowledgeBase; grant: ChannelResourceGrant }> {
  if (!isUuid(baseId)) throw new KnowledgeBaseNotFoundError(baseId);

  const row = await findChannelKnowledgeGrant(
    supabaseAdmin(),
    ctx.workspaceId,
    ctx.channelId,
    baseId
  );
  if (row === null || row.level !== "visible") {
    throw new KnowledgeBaseNotFoundError(baseId);
  }

  // `includeDeleted` left at its default `false`, so a base whose grant outlived
  // it reads as gone rather than as an empty tree.
  const base = await repo.findBaseById(baseId, false);
  if (base === null || base.workspaceId !== ctx.workspaceId) {
    throw new KnowledgeBaseNotFoundError(baseId);
  }

  return { base, grant: { level: row.level, guestWrite: row.guest_write } };
}

/**
 * 🔒 THE WRITE GATE FOR THE GUEST LANE (§3.4): membership (at the route) AND
 * `visible` AND `guest_write === true` AND the base alive. Everything
 * {@link assertGrantVisible} refuses, this refuses identically and with the same
 * 404; the ONE refusal it adds of its own is a 403, because by then the caller
 * has already been handed the row.
 *
 * ⚠ `agent_write_enabled` IS NOT CONSULTED, AND THAT IS ONLY SAFE BECAUSE OF THE
 * LINE BELOW IT. That per-KB flag answers "may an AGENT write this base"; the
 * grant's `guest_write` answers "may this channel's PEOPLE write it", and they
 * are different questions about different callers. But an agent token can issue
 * any HTTP the operator could (`full` profile has Bash and the 90-day device
 * token is on disk), so leaving the human premise unstated would have made this
 * route the one place `agent_write_enabled` could be walked around — F-10/F-10b
 * re-opened through a new door. The lane is for people; an agent that wants a
 * granted base uses the MCP/workspace surface, where its own gate applies.
 *
 * ⚠ THIS SERVICE IS THE FENCE, NOT RLS. Every read and write below it runs on
 * the SERVICE-ROLE client, which bypasses row-level security entirely — the
 * `channel_resource_grants` policies are defense-in-depth and will never fire
 * for this caller. If this function returns, the write happens.
 */
export async function assertGrantWritable(
  ctx: ChannelKnowledgeContext,
  baseId: string
): Promise<{ base: KnowledgeBase; grant: ChannelResourceGrant }> {
  const { base, grant } = await assertGrantVisible(ctx, baseId);
  if (ctx.source === "agent") {
    throw new AgentWriteDisabledError(
      base.id,
      "The channel knowledge lane is a lane for people. An agent writes a knowledge base through the workspace surface, where the agent-write setting applies."
    );
  }
  if (!grant.guestWrite) throw new ChannelGrantReadOnlyError();
  return { base, grant };
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
