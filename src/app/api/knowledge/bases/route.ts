import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createBase,
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listStarredBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";
import type { KnowledgeBaseStats } from "@/features/knowledge/types";
import { KnowledgeBaseCreateSchema } from "@/features/knowledge/schema";

/**
 * GET /api/knowledge/bases — the caller's visible bases, plus two
 * derived maps keyed by the same list:
 *   - `ownerNames`: display names for the bases created by *other*
 *     members, keyed by user id (attribution).
 *   - `baseStats`: `{entryCount, lastEntryUpdatedAt, storageBytes}` per
 *     base id, keyed by base id — the knowledge home grid's "{N} entries ·
 *     updated {when}" line and its storage bar. Computed here so the grid
 *     never has to fetch every base's tree to count it (one request per card).
 *
 * Both are folded in rather than given their own endpoints because
 * neither read is useful apart from this one: each takes the base list as
 * its input, so a separate route would mean a round trip that can only
 * ever follow this one (this is exactly the chain
 * `knowledge/page.tsx:50-51` ran).
 *
 * Plus ONE scalar, `kbStorageLimit`: the workspace's per-base byte cap, from
 * its entitlement-resolved plan. It rides here for the same reason the maps do
 * — it is the `limit` half of every bar the grid is about to draw, it is the
 * SAME number for every card, and fetching it separately would make a grid of
 * N bases cost two requests instead of one. `null` = unknown (the billing read
 * failed); the client draws no bar rather than guessing a cap.
 *
 * Plus ONE array, `starredBaseIds`: the CALLER'S OWN stars, narrowed to the
 * bases above. Per-user, so it can never ride on the base row — two members
 * reading this route see the same `bases` and different `starredBaseIds`. It
 * folds in for the same reason everything else here does: it takes the visible
 * base list as its input, so a separate endpoint could only ever follow this
 * one. `[]` = nothing starred, which is a real answer; a degraded read answers
 * `[]` too, and that is deliberate — the failure mode of an unreadable star is
 * a card in its unstarred place, never a missing card.
 *
 * `ownerNames` is `{}` when every base is the caller's own (the common
 * solo case skips the profiles query entirely). All four keys are additive —
 * existing clients read `bases` and ignore them, and none of them widens the
 * `KnowledgeBase` type the SDK mirrors
 * (`scripts/check-knowledge-type-drift.ts`).
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const bases = await listBases(ctx);
    // Attribution and counters are cosmetic; the base list is not. A
    // profiles- or entries-table hiccup must degrade to no names / no
    // stats, never 500 the list (kb_list_bases over MCP rides this same
    // route). Run together — neither depends on the other.
    const [ownerNames, baseStats, kbStorageLimit, starredBaseIds] =
      await Promise.all([
        listBaseOwnerNames(ctx, bases).catch(
          () => ({}) as Record<string, string>
        ),
        listBaseStats(ctx, bases).catch(
          () => ({}) as Record<string, KnowledgeBaseStats>
        ),
        // Already fails soft to `null` internally; the `.catch` is the same
        // belt-and-braces the two maps get.
        resolveKbStorageLimit(ctx.workspaceId).catch(() => null),
        // Same rule, and here the degraded value is `[]` rather than a
        // sentinel: an unknown star is indistinguishable from no star at every
        // surface that reads this, so there is nothing for an "unknown" to
        // change. The grid renders in list order and the toggle still works.
        listStarredBaseIds(ctx, bases).catch(() => [] as string[]),
      ]);
    return NextResponse.json({
      bases,
      ownerNames,
      baseStats,
      kbStorageLimit,
      starredBaseIds,
    });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, KnowledgeBaseCreateSchema);
    const ctx = buildKnowledgeContext(auth);
    const base = await createBase(ctx, input);
    return NextResponse.json({ base }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
