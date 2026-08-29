import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  KbShelf,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeContext,
} from "../types";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import { audienceAdmits, resolveAgentAudience } from "./service-audience";
import {
  assertBaseVisible,
  assertSameWorkspace,
  canSeeBase,
  filterTeamVisibleBases,
} from "./service-shared";
import { seedWorkspace } from "./service-seed";

/**
 * Knowledge base reads. `getBaseById` / `getBaseBySlug` are the foundational
 * visibility-checked lookups the other service modules build on.
 *
 * 🔒 THEY ARE ALSO WHERE THE AGENT AUDIENCE CEILING IS APPLIED
 * (`service-audience.ts`, plan §4.2). Every other knowledge read — trees,
 * entries, folders, stars, search, export — composes one of the lookups in this
 * file, so fencing here fences the surface.
 *
 * ⚠ THAT LAST SENTENCE WAS FALSE WHEN IT WAS WRITTEN, AND SAYING SO IS THE
 * POINT (corrected 2026-08-26). `service-entries.ts › getEntry` did NOT compose
 * one of these — it checked `assertSameWorkspace` alone — so
 * `GET /api/knowledge/entries/[entryId]` (viewer default) read the body of any
 * entry in any private base, bypassing BOTH the ceiling and M-10, and
 * `resolveEntryRefs` applied `canSeeBase` without the ceiling. `export.ts ›
 * buildEntryFile` had already noticed half of it and bolted its own `getBaseById`
 * on. Both are fixed AT THE ENTRY SERVICE, so the claim above is now true —
 * but it is a claim about every OTHER module, and this file cannot enforce it.
 *
 * ⚠ A NEW foundational lookup that reaches `repository-bases.ts` directly
 * instead of composing one of these owes itself the same two lines; that is the
 * regression to watch for, and it is the one that ALREADY HAPPENED ONCE.
 * `service-audience.test.ts` pins the lookups that exist by driving them, and
 * pins the entry lane the same way.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Which of `bases` sit on the caller's PERSONAL (/home) shelf — the sibling key
 * behind `GET /api/knowledge/bases › homeScopedBaseIds` (MCP surface v2 wave B,
 * 2026-08-28).
 *
 * 🔒 ⚠ **A LABEL OVER AN ALREADY-FENCED LIST, NEVER A SECOND READ PATH.** It
 * takes the POST-visibility rows — the ones `listBases` already put through
 * `canSeeBase`, `filterTeamVisibleBases` AND the agent audience ceiling — and
 * answers which of THOSE carry the flag. It applies no visibility of its own and
 * must never be handed a wider set; the id set IS the fence, exactly as
 * `service-stars.ts › listStarredBaseIds` states it.
 *
 * ⚠ IT DOES NOT PROJECT `home_scoped` ONTO THE ROW. That column stays out of
 * `KNOWLEDGE_BASE_COLS` so no client can re-derive the shelf FENCE, and out of
 * the SDK-mirrored `KnowledgeBase` so `check-knowledge-type-drift` has nothing
 * new to compare. A sibling key is the shipped answer for this exact shape.
 */
export async function listHomeScopedBaseIds(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<string[]> {
  if (bases.length === 0) return [];
  const visible = new Set(bases.map((b) => b.id));
  const scoped = await repo.listHomeScopedBaseIds(ctx.workspaceId, [...visible]);
  // Belt and braces over the `in` filter, the same guard the star fold keeps: an
  // id outside the visible set means the filter was ignored.
  return scoped.filter((id) => visible.has(id));
}

/**
 * Active bases for the workspace. Lazy-seeds only when the workspace has zero
 * bases AND is <24h old, so a mature workspace that intentionally cleared
 * everything is never re-seeded.
 *
 * ⚠ `opts.shelf` NARROWS TO ONE SHELF (`../types.ts › KbShelf`) — the /home
 * pane's "across all channels" asks for `"home"`, the workspace Knowledge page
 * for `"workspace"`, and everything else (MCP `kb_list_bases`, search) omits it
 * and gets BOTH. It is applied in the QUERY, not over the result, so a shelf
 * the caller did not ask for never reaches the wire (INVARIANTS §11: viewer
 * filtering is server-side by principle).
 *
 * 🔒 A SHELF READ NEVER SEEDS, and that is not an optimisation. The seed gate
 * below is "this workspace has NO bases at all"; asked of one shelf it becomes
 * "no bases ON THIS SHELF", which is the normal state of a workspace whose
 * content all lives on the other one — and a <24h-old workspace would then be
 * re-seeded by every visit to the /home Knowledge pane. Narrowed reads are
 * VIEWS; provisioning belongs to the unfiltered one.
 */
export async function listBases(
  ctx: KnowledgeContext,
  opts: { shelf?: KbShelf } = {}
): Promise<KnowledgeBase[]> {
  const all = await repo.listBasesForWorkspace(
    ctx.workspaceId,
    false,
    opts.shelf
  );
  // 🔒 The ceiling is the OUTERMOST filter, applied after the workspace gates
  // rather than instead of them: an agent in a shared container gets the
  // intersection of "what this caller could see anyway" and "what was granted
  // into this container's channels". Neither gate is a substitute for the other.
  const audience = await resolveAgentAudience(ctx);
  const visible = (
    await filterTeamVisibleBases(ctx, all.filter((b) => canSeeBase(ctx, b)))
  ).filter((b) => audienceAdmits(audience, b.id));
  if (visible.length > 0) return visible;
  // 🔒 A NARROWED READ STOPS HERE — see the docblock. `all` is this SHELF's
  // rows, so every gate below it would be answering a different question than
  // the one it was written for.
  if (opts.shelf !== undefined) return visible;
  // ⚠ CRITICAL: gate on the UNFILTERED count, not what the caller sees —
  // else a member joining a workspace whose only bases are someone else's
  // private items re-triggers seed on every list call.
  if (all.length > 0) return visible;
  // DEMO BYPASS: auto-seed off; new workspaces start empty. Flip to false to
  // restore onboarding seeding. `seedWorkspace` stays callable for explicit
  // paths. ⚠ Typed `boolean`, not literal `true`, so TS keeps the code below
  // reachable.
  const DEMO_DISABLE_AUTO_SEED: boolean = true;
  if (DEMO_DISABLE_AUTO_SEED) return visible;
  const workspaceCreatedAt = await fetchWorkspaceCreatedAt(ctx.workspaceId);
  if (
    workspaceCreatedAt !== null &&
    Date.now() - workspaceCreatedAt.getTime() < TWENTY_FOUR_HOURS_MS
  ) {
    await seedWorkspace(ctx);
    const seeded = await repo.listBasesForWorkspace(ctx.workspaceId, false);
    return (
      await filterTeamVisibleBases(ctx, seeded.filter((b) => canSeeBase(ctx, b)))
    ).filter((b) => audienceAdmits(audience, b.id));
  }
  return visible;
}

/** Owner display names keyed by user id — list-pane attribution. Skips the
 *  query when every base is the caller's own (common solo case). */
export async function listBaseOwnerNames(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<Record<string, string>> {
  const foreign = [
    ...new Set(
      bases
        .map((b) => b.createdBy)
        .filter((id): id is string => id !== null && id !== ctx.userId)
    ),
  ];
  if (foreign.length === 0) return {};
  const names = await repo.fetchProfileNames(foreign);
  return Object.fromEntries(names);
}

/**
 * Entry count + newest content write + stored bytes per base — the
 * "{N} entries · updated {when}" line and usage bar.
 * ⚠ Takes the POST-visibility base list: the id set IS the fence. Every id
 * gets an entry — empty base is `0`, never a missing key.
 * ⚠ `storageBytes` reads a column existing only after
 * `20260812120000_knowledge_base_storage_bytes.sql`, so a build ahead of its
 * migration loses the BAR and keeps the COUNTS — hence the local catch and
 * `null` (unknown) rather than degrading the whole map to `{}`.
 */
export async function listBaseStats(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<Record<string, KnowledgeBaseStats>> {
  const stats: Record<string, KnowledgeBaseStats> = {};
  for (const base of bases) {
    stats[base.id] = {
      entryCount: 0,
      lastEntryUpdatedAt: null,
      storageBytes: null,
    };
  }
  if (bases.length === 0) return stats;
  const baseIds = bases.map((b) => b.id);
  const [stamps, storage] = await Promise.all([
    repo.listEntryStampsForBases(ctx.workspaceId, baseIds),
    repo
      .listBaseStorageBytes(ctx.workspaceId, baseIds)
      .catch(() => new Map<string, number>()),
  ]);
  for (const base of bases) {
    const bytes = storage.get(base.id);
    if (bytes !== undefined) stats[base.id].storageBytes = bytes;
  }
  for (const { baseId, updatedAt } of stamps) {
    const stat = stats[baseId];
    // Row outside the visible set = the `in` filter was ignored. Drop it
    // rather than inventing a key.
    if (!stat) continue;
    stat.entryCount += 1;
    // ⚠ Parsed, not lexicographic: Postgres timestamps arrive with a variable
    // fractional-second tail, so string ordering is only accidentally right.
    if (
      stat.lastEntryUpdatedAt === null ||
      Date.parse(updatedAt) > Date.parse(stat.lastEntryUpdatedAt)
    ) {
      stat.lastEntryUpdatedAt = updatedAt;
    }
  }
  return stats;
}

export async function getBaseById(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseById(id, false);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  // ⚠ 404, not 403, so visibility itself isn't an oracle.
  await assertBaseVisible(ctx, base);
  await assertWithinAudience(ctx, base.id);
  return base;
}

export async function getBaseBySlug(
  ctx: KnowledgeContext,
  slug: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseBySlug(ctx.workspaceId, slug, false);
  if (!base) throw new KnowledgeBaseNotFoundError(slug);
  await assertBaseVisible(ctx, base);
  await assertWithinAudience(ctx, base.id);
  return base;
}

/**
 * 🔒 The single-base half of the ceiling. Throws the SAME
 * `KnowledgeBaseNotFoundError` an invisible base throws, so "not granted into
 * this container", "not visible to you" and "does not exist" are one answer —
 * the 404-not-403 rule this file already applies to visibility, extended to
 * audience for the same reason. A 403 here would tell an agent the id it
 * guessed was real.
 *
 * ⚠ It runs AFTER `assertBaseVisible`, not before. The order costs nothing (the
 * base row is already in hand) and keeps the audience read off the path of
 * every caller the workspace gates already refuse.
 */
async function assertWithinAudience(
  ctx: KnowledgeContext,
  baseId: string
): Promise<void> {
  const audience = await resolveAgentAudience(ctx);
  if (!audienceAdmits(audience, baseId)) {
    throw new KnowledgeBaseNotFoundError(baseId);
  }
}

async function fetchWorkspaceCreatedAt(
  workspaceId: string
): Promise<Date | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select("created_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return new Date((data as { created_at: string }).created_at);
}
