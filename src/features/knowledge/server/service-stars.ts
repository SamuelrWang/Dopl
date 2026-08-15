import "server-only";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";

/**
 * PER-USER knowledge-base stars — a favourite, not a workspace property.
 * ⚠ NOTHING here takes a user id as an argument, deliberately: it comes from
 * `KnowledgeContext`, so no handler can fill one from a request body.
 * ⚠ THE SERVICE IS THE FENCE, NOT RLS — reads run on the service-role client,
 * which bypasses row-level security (INVARIANTS §2). The table's own-row SELECT
 * policy is defence in depth for a future client-side reader; here
 * `.eq("user_id", ctx.userId)` in `repository-stars.ts` is the only scoping.
 */

/**
 * Caller's starred ids narrowed to `bases` — the fold behind
 * `GET /api/knowledge/bases › starredBaseIds`. One query for N bases.
 *
 * ⚠ Takes the POST-visibility base list: the id set IS the fence. A star row
 * surviving from before a base was locked down can never surface, so the array
 * is always a SUBSET of the ids in the same response — the client sorts
 * against it and would otherwise get ids it has no card for.
 */
export async function listStarredBaseIds(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<string[]> {
  if (bases.length === 0) return [];
  const visible = new Set(bases.map((b) => b.id));
  const starred = await repo.listStarredBaseIds(ctx.userId, [...visible]);
  // Belt and braces over the `in` filter: an id outside the visible set means
  // the filter was ignored; drop it rather than hand the grid an unmatched id.
  return starred.filter((id) => visible.has(id));
}

/**
 * Star a base for the calling user. Idempotent — starring twice is one row.
 * ⚠ GATED ON VISIBILITY: `getBaseById` 404s for another workspace's base or
 * one the private/teams gate hides, so a star can't probe id existence.
 */
export async function starBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await getBaseById(ctx, baseId);
  await repo.insertBaseStar(ctx.userId, baseId);
}

/**
 * Unstar. ⚠ DELIBERATELY NOT GATED ON VISIBILITY — the asymmetry with
 * `starBase` is the decision: a member must always be able to drop their own
 * row, else a base since made private strands a star invisible except in the
 * sort order. Leaks nothing — a delete matching zero rows is indistinguishable
 * from one matching a row.
 */
export async function unstarBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await repo.deleteBaseStar(ctx.userId, baseId);
}
