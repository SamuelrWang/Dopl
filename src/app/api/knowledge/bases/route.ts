import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createBase,
  listBaseOwnerNames,
  listBaseStats,
  listBases,
  listHomeScopedBaseIds,
  listPinnedBaseIds,
  listStarredBaseIds,
  resolveKbStorageLimit,
} from "@/features/knowledge/server/service";
import {
  getChannelGrantMap,
  listSharedIntoChannelBaseIds,
} from "@/features/knowledge/server/service-channel-grants";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import type { KbShelf, KnowledgeBaseStats } from "@/features/knowledge/types";
import { KnowledgeBaseCreateSchema } from "@/features/knowledge/schema";

/**
 * GET /api/knowledge/bases — the caller's visible bases plus the sibling keys below, each derived
 * FROM that same list (so a separate endpoint could only ever follow this one). ⚠ The count is
 * deliberately not stated: it has been wrong twice as keys were added, and the list IS the count.
 *   - `ownerNames`: display names for bases created by OTHER members, keyed by user id. `{}` when
 *     every base is the caller's own (solo case skips the profiles query).
 *   - `baseStats`: `{entryCount, lastEntryUpdatedAt, storageBytes}` per base id.
 *   - `kbStorageLimit`: per-base byte cap from the entitlement-resolved plan. `null` = unknown;
 *     the client draws no bar rather than guessing a cap.
 *   - `starredBaseIds`: the CALLER'S OWN stars. Per-user, so it can never ride on the base row.
 *     `[]` for both "nothing starred" and a degraded read — an unreadable star means an unstarred
 *     card, never a missing one.
 *   - `homeScopedBaseIds` (2026-08-28): which of the listed bases sit on the caller's PERSONAL
 *     (/home) shelf. 🔒 A SIBLING KEY, AND IT SURVIVED THE COLUMN IT WAS NAMED FOR: since
 *     2026-09-02 (slice B15) the shelf is a TENANCY — the caller's own `kind='personal'` container —
 *     so the question is "is this row in my container" and there is no flag to project. The key
 *     shape and the `?? []` rule are unchanged. `[]` for both "none on the personal
 *     shelf" and a degraded read: an unreadable flag means an UNLABELLED card, never a mislabelled
 *     one — and never a card that vanishes.
 *     ⚠ Only ever a SUBSET of the ids in `bases`, so a consumer can index straight into the list.
 *   - `sharedBaseIds` (2026-09-01): which of the listed bases are granted into AT LEAST ONE
 *     channel — the set behind the card's `Shared` pill. 🔒 A SIBLING KEY for the same reason
 *     `homeScopedBaseIds` is one: it is a fact about GRANTS, not a column on the base, so it must
 *     not widen `KnowledgeBase` (which `check-knowledge-type-drift` mirrors into the SDK). A SET,
 *     never a count and never a channel list — the pill asks one boolean per base, and anything
 *     richer would put the identity of channels the caller may not see onto the wire.
 *     ⚠ `[]` on a degraded read, which reproduces exactly what shipped before this key existed
 *     (every private base labelled "Private"). It is stated rather than claimed SAFE: the
 *     direction under-states a base's exposure to its own owner. Failing the whole list instead is
 *     worse — `kb_list_bases` over MCP rides this route.
 *
 *   - `pinnedBaseIds` (2026-09-01, T81): which of the listed bases are PINNED — their entries are
 *     handed to every agent session launched in this workspace
 *     (`GET /api/knowledge/startup-context`). 🔒 A SIBLING KEY for the same reason
 *     `homeScopedBaseIds` is one: `pinned` stays out of `server/dto.ts › KNOWLEDGE_BASE_COLS`, so
 *     no client re-implements the startup-context read from a projected column, and the
 *     SDK-mirrored `KnowledgeBase` does not widen (`check-knowledge-type-drift`).
 *     ⚠ Unlike `starredBaseIds` this is a WORKSPACE fact, not the caller's own: two members get
 *     the same array. `[]` degrades to "no card is marked pinned", which is what every surface
 *     showed before the key existed; the unsafe direction — a pinned base rendering as unpinned
 *     to the person about to unpin it — is a display gap, never a content leak.
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
 *
 * ⚠ `?shelf=home|workspace` NARROWS THE LIST ITSELF — not a sibling key, the actual rows
 * (`features/knowledge/types.ts › KbShelf`). The /home Knowledge pane's "across all channels"
 * asks for `home`; the workspace Knowledge page asks for `workspace`; the two exclude each other
 * BOTH ways (Samuel's ruling 2026-08-26). ABSENT = both shelves, which is every pre-existing
 * caller — MCP `kb_list_bases` rides this route and must keep seeing the whole workspace.
 * 🔒 The narrowing is a `WHERE`, not a post-filter: a shelf the caller did not ask for never
 * reaches the wire. See `readShelf` below for why a misspelled value is a 400.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const shelf = readShelf(request);
    const bases = await listBases(ctx, { shelf });
    // ⚠ Attribution and counters are cosmetic; the base list is not. A profiles/entries hiccup
    // degrades to no names / no stats, never a 500 (`kb_list_bases` over MCP rides this route).
    const [
      ownerNames,
      baseStats,
      kbStorageLimit,
      starredBaseIds,
      homeScopedBaseIds,
      sharedBaseIds,
      pinnedBaseIds,
    ] = await Promise.all([
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
        // ⚠ Same degradation, and it is the SAFE direction: `[]` means no card
        // carries a shelf label, which is what every surface showed before this
        // key existed. The unsafe direction would be labelling a workspace base
        // as personal, and no failure mode here can produce that.
        listHomeScopedBaseIds(ctx, bases).catch(() => [] as string[]),
        // ⚠ SEE THE DOCBLOCK for why `[]` is the degraded value and why that
        // direction is stated rather than called safe.
        listSharedIntoChannelBaseIds(
          ctx.workspaceId,
          bases.map((b) => b.id)
        ).catch(() => [] as string[]),
        // ⚠ SAME `[]` DEGRADE as its siblings, and the direction is the display
        // gap rather than the leak: an unreadable flag leaves every card
        // UNMARKED, which is what shipped before this key existed. A pin decides
        // what agents are HANDED, never what anyone may read, so no failure here
        // can widen an audience.
        listPinnedBaseIds(ctx, bases).catch(() => [] as string[]),
      ]);
    const base = {
      bases,
      ownerNames,
      baseStats,
      kbStorageLimit,
      starredBaseIds,
      homeScopedBaseIds,
      sharedBaseIds,
      pinnedBaseIds,
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

/**
 * `?shelf=home|workspace` — which SHELF to list (`features/knowledge/types.ts ›
 * KbShelf`). ABSENT = both, which is every pre-existing caller including MCP
 * `kb_list_bases`.
 *
 * 🔒 AN UNRECOGNISED VALUE IS A 400, NOT AN IGNORED PARAM. Silently dropping a
 * misspelled `?shelf=hom` would answer the WIDER list — the workspace shelf
 * folded back into the /home pane, i.e. exactly the bug this wave closes — and
 * it would look like it worked. Fail loud, fail narrow.
 */
function readShelf(request: NextRequest): KbShelf | undefined {
  const raw = request.nextUrl.searchParams.get("shelf");
  if (raw === null) return undefined;
  if (raw === "home" || raw === "workspace") return raw;
  throw new HttpError(400, "VALIDATION_FAILED", "shelf must be 'home' or 'workspace'");
}

/**
 * `POST` — create one base, optionally SHARED INTO A CHANNEL in the same call
 * (`shareToChannelId`, Samuel's ruling 2026-08-27: the /home Shared section's
 * create button). The two writes are atomic by rollback in `createBase`.
 *
 * 🔒 THE CHANNEL IS FENCED HERE, BEFORE ANY SERVICE-ROLE WRITE, exactly as
 * `bases/[baseId]/channel-grants`'s PUT does it: `isChannelVisibleTo` or 404 —
 * the SAME answer an unknown channel gets, so the field is not an oracle for
 * which channels exist. ⚠ Deliberately BEFORE `createBase`, not after: a base
 * created and then rolled back because the channel was invisible would still
 * have burned a slug and a `public_id`, and would tell the caller by TIMING
 * what the 404 refuses to tell them in words.
 *
 * ⚠ THIS ROUTE IS NOT `sessionOnly` AND MUST NOT BECOME SO — MCP
 * `kb_create_base` rides it. The agent refusal that the grant write needs lives
 * in `features/knowledge/server/service-channel-grants.ts ›
 * setChannelKnowledgeGrant` instead, which is the one place BOTH doors pass
 * through; see its docblock for why it moved there on 2026-08-27.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, KnowledgeBaseCreateSchema);
    const ctx = buildKnowledgeContext(auth);
    if (
      input.shareToChannelId &&
      !(await isChannelVisibleTo(
        ctx.workspaceId,
        ctx.userId,
        input.shareToChannelId
      ))
    ) {
      return NextResponse.json(
        { error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } },
        { status: 404 }
      );
    }
    const base = await createBase(ctx, input);
    return NextResponse.json({ base }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
