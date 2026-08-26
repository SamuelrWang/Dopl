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
import { getChannelGrantMap } from "@/features/knowledge/server/service-channel-grants";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import type { KnowledgeBaseStats } from "@/features/knowledge/types";
import { KnowledgeBaseCreateSchema } from "@/features/knowledge/schema";

/**
 * GET /api/knowledge/bases — the caller's visible bases plus four sibling keys, each derived FROM
 * that same list (so a separate endpoint could only ever follow this one):
 *   - `ownerNames`: display names for bases created by OTHER members, keyed by user id. `{}` when
 *     every base is the caller's own (solo case skips the profiles query).
 *   - `baseStats`: `{entryCount, lastEntryUpdatedAt, storageBytes}` per base id.
 *   - `kbStorageLimit`: per-base byte cap from the entitlement-resolved plan. `null` = unknown;
 *     the client draws no bar rather than guessing a cap.
 *   - `starredBaseIds`: the CALLER'S OWN stars. Per-user, so it can never ride on the base row.
 *     `[]` for both "nothing starred" and a degraded read — an unreadable star means an unstarred
 *     card, never a missing one.
 *
 *   - `channelGrants` (ONLY when `?channelId=<uuid>` is sent): `{baseId → {level, guestWrite}}` for
 *     the grants of THAT channel among the visible bases — the scope-A grant map behind Home
 *     Knowledge Panels. ABSENT param ⇒ ABSENT key (never `{}`); a sent-but-ungranted channel yields
 *     `{}` (asked, none granted). 🔒 The channelId is FENCED via `isChannelVisibleTo` BEFORE any
 *     service-role grant read — a non-visible or cross-workspace channel is 404, the same answer an
 *     unknown one gets, so existence is never an oracle (§9, the `overview-series?channelId=`
 *     precedent). The fence read is SKIPPED entirely when no channelId is sent.
 *
 * ⚠ All are SIBLING keys, additive on the wire: none may widen the `KnowledgeBase` type the
 * SDK mirrors (`scripts/check-knowledge-type-drift.ts`).
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const bases = await listBases(ctx);
    // ⚠ Attribution and counters are cosmetic; the base list is not. A profiles/entries hiccup
    // degrades to no names / no stats, never a 500 (`kb_list_bases` over MCP rides this route).
    const [ownerNames, baseStats, kbStorageLimit, starredBaseIds] =
      await Promise.all([
        listBaseOwnerNames(ctx, bases).catch(
          () => ({}) as Record<string, string>
        ),
        listBaseStats(ctx, bases).catch(
          () => ({}) as Record<string, KnowledgeBaseStats>
        ),
        // Already fails soft to `null` internally; `.catch` is belt-and-braces.
        resolveKbStorageLimit(ctx.workspaceId).catch(() => null),
        // Degraded value is `[]`, not a sentinel: unknown and unstarred render identically.
        listStarredBaseIds(ctx, bases).catch(() => [] as string[]),
      ]);
    const base = {
      bases,
      ownerNames,
      baseStats,
      kbStorageLimit,
      starredBaseIds,
    };

    // ⚠ THE GRANT READ RUNS ONLY WHEN A CHANNEL WAS ASKED FOR. Absent param ⇒
    // absent key: the workspace/knowledge pages must not pay two extra queries
    // (fence + grants) for a scope nobody requested, and an absent key reads
    // correctly as "this response was not channel-scoped".
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (channelId === null) {
      return NextResponse.json(base);
    }

    // 🔒 Fence the id against the caller's visible channels BEFORE any
    // service-role grant read. A miss (not visible, archived, or another
    // workspace) answers 404 — the same answer an unknown channel gets — so
    // "cannot see" and "does not exist" stay indistinguishable.
    if (!(await isChannelVisibleTo(ctx.workspaceId, ctx.userId, channelId))) {
      return NextResponse.json(
        { error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } },
        { status: 404 }
      );
    }

    const channelGrants = await getChannelGrantMap(
      ctx.workspaceId,
      channelId,
      bases.map((b) => b.id)
    );
    return NextResponse.json({ ...base, channelGrants });
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
