import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { KnowledgeBase, KnowledgeContext } from "../types";
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
 * Knowledge base reads. Single-base gates (`getBaseById` / `getBaseBySlug`)
 * are the foundational visibility-checked lookups the rest of the service
 * modules build on.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Returns active knowledge bases for the workspace. Triggers a lazy
 * seed when the workspace has zero bases AND was created within the
 * last 24 hours — keeps the empty-state nice for fresh workspaces
 * without re-seeding mature workspaces that intentionally cleared
 * everything.
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
  // CRITICAL: seed only when the workspace has NO bases at all, not
  // when the *caller* sees zero — otherwise a member who joins a
  // workspace whose only bases are someone else's private items would
  // re-trigger seed on every list call. (seedWorkspace's own guard
  // would early-return, but we shouldn't even try.)
  if (all.length > 0) return visible;
  // DEMO BYPASS: auto-seed disabled. New workspaces start empty;
  // populate explicitly via the agent or the UI. Flip
  // DEMO_DISABLE_AUTO_SEED to false (or delete the guard) to restore
  // the original onboarding-seed behavior below. `seedWorkspace` is
  // preserved as a callable function for explicit invocation paths.
  // Typed as `boolean` (not the literal `true`) so TypeScript keeps
  // the gating code below reachable for narrowing.
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

/**
 * Owner display names for a set of bases, keyed by user id — list-pane
 * attribution for bases shared by other members. Skips the query when
 * every base is the caller's own (the common solo case).
 */
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

export async function getBaseById(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseById(id, false);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  // Hide private items from non-owners and workspace-scoped keys, and
  // teams-mode bases from non-granted members — 404 is the right shape
  // so visibility itself isn't an oracle.
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
