import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeContext,
} from "../types";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
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
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Active bases for the workspace. Lazy-seeds only when the workspace has zero
 * bases AND is <24h old, so a mature workspace that intentionally cleared
 * everything is never re-seeded.
 */
export async function listBases(
  ctx: KnowledgeContext
): Promise<KnowledgeBase[]> {
  const all = await repo.listBasesForWorkspace(ctx.workspaceId, false);
  const visible = await filterTeamVisibleBases(
    ctx,
    all.filter((b) => canSeeBase(ctx, b))
  );
  if (visible.length > 0) return visible;
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
    return filterTeamVisibleBases(ctx, seeded.filter((b) => canSeeBase(ctx, b)));
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
  return base;
}

export async function getBaseBySlug(
  ctx: KnowledgeContext,
  slug: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseBySlug(ctx.workspaceId, slug, false);
  if (!base) throw new KnowledgeBaseNotFoundError(slug);
  await assertBaseVisible(ctx, base);
  return base;
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
