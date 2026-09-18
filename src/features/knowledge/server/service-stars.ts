import "server-only";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";

/**
 * Per-user knowledge-base stars — a favourite, not a workspace property.
 *
 * Nothing here takes a user id as an argument: it comes from
 * `KnowledgeContext`, so no handler can fill one from a request body. The
 * service is the fence, not RLS — reads run on the service-role client, which
 * bypasses row-level security (INVARIANTS §2), so `.eq("user_id", ctx.userId)`
 * in `repository-stars.ts` is the only scoping.
 */

/**
 * Caller's starred ids narrowed to `bases` — the fold behind
 * `GET /api/knowledge/bases › starredBaseIds`. One query for N bases.
 *
 * Takes the post-visibility base list: the id set is the fence, so the array is
 * always a subset of the ids in the same response and a star surviving a
 * lockdown can never surface.
 */
export async function listStarredBaseIds(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<string[]> {
  if (bases.length === 0) return [];
  const visible = new Set(bases.map((b) => b.id));
  const starred = await repo.listStarredBaseIds(ctx.userId, [...visible]);
  // An id outside the visible set means the `in` filter was ignored; drop it
  // rather than hand the grid an unmatched id.
  return starred.filter((id) => visible.has(id));
}

/**
 * Star a base for the calling user. Idempotent — starring twice is one row.
 * Gated on visibility: `getBaseById` 404s for another workspace's base or one
 * the private/teams gate hides, so a star cannot probe id existence.
 */
export async function starBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await getBaseById(ctx, baseId);
  await repo.insertBaseStar(ctx.userId, baseId);
}

/**
 * Unstar. Deliberately not gated on visibility: a member must always be able to
 * drop their own row, else a base since made private strands a star. Leaks
 * nothing — a delete matching zero rows looks like one matching a row.
 */
export async function unstarBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await repo.deleteBaseStar(ctx.userId, baseId);
}
