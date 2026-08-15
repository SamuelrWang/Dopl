import "server-only";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";

/**
 * PER-USER knowledge-base stars — a favourite, not a workspace property.
 *
 * The caller's user id comes from `KnowledgeContext`, which is built at the
 * route boundary from the auth wrapper (`service-shared.ts ›
 * buildKnowledgeContext`). NOTHING here takes a user id as an argument, and
 * that is the fence: a star is only ever the caller's own, so there is no
 * parameter a handler could fill in from a request body.
 *
 * ⚠ THE SERVICE IS THE FENCE, NOT RLS. Every read below runs on the
 * service-role client, which bypasses row-level security entirely (INVARIANTS
 * §2). The table's own-row SELECT policy is defence in depth for a future
 * client-side reader; on this path the `.eq("user_id", ctx.userId)` in
 * `repository-stars.ts` is the only thing scoping the answer.
 */

/**
 * The caller's starred ids, narrowed to `bases` — the fold behind
 * `GET /api/knowledge/bases › starredBaseIds`.
 *
 * TAKES THE POST-VISIBILITY BASE LIST, for the same reason `listBaseStats` and
 * `listBaseOwnerNames` do: the id set is the fence. A base hidden by the
 * private/teams gate can never appear here even if a star row for it survives
 * from before the base was locked down, so the returned array is always a
 * SUBSET of the ids the same response carries. The client sorts against it and
 * would otherwise be handed ids it has no card for.
 *
 * ONE QUERY FOR N BASES. The grid must cost one request; this rides the list
 * response rather than a second endpoint, on the same terms as the other folds.
 */
export async function listStarredBaseIds(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<string[]> {
  if (bases.length === 0) return [];
  const visible = new Set(bases.map((b) => b.id));
  const starred = await repo.listStarredBaseIds(ctx.userId, [...visible]);
  // Belt and braces on top of the `in` filter: a row for a base outside the
  // visible set can only mean the query ignored its filter, and the honest
  // answer to that is to drop it rather than hand the grid an unmatched id.
  return starred.filter((id) => visible.has(id));
}

/**
 * Star a base for the calling user.
 *
 * GATED ON VISIBILITY. `getBaseById` throws `KnowledgeBaseNotFoundError` (→
 * 404) for a base in another workspace or one the private/teams gate hides, so
 * a star cannot be used to probe whether an id exists. Idempotent below that:
 * starring twice is one row.
 */
export async function starBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await getBaseById(ctx, baseId);
  await repo.insertBaseStar(ctx.userId, baseId);
}

/**
 * Unstar. DELIBERATELY NOT GATED ON VISIBILITY, and the asymmetry with
 * `starBase` is the decision, not an oversight: a member must always be able
 * to drop their own row. Gating it would strand a star on a base that has
 * since been made private or moved out of the caller's teams — permanently, on
 * a surface where the row is invisible and only the sort order shows it is
 * still there.
 *
 * It leaks nothing. The statement is keyed `(this user, that base)` and a
 * delete matching zero rows is indistinguishable from one matching a row, so
 * the response is the same either way and the id is not an oracle.
 */
export async function unstarBase(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  await repo.deleteBaseStar(ctx.userId, baseId);
}
