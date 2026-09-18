import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  readResourceById,
  type ContainerRead,
} from "@/shared/tenancy/read-resource";
import type {
  KbShelf,
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeContext,
} from "../types";
import {
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
} from "./errors";
import * as repo from "./repository";
import { audienceAdmits, resolveAgentAudience } from "./service-audience";
import {
  assertBaseVisible,
  assertSameWorkspace,
  canSeeBase,
  baseGrantsFor,
  filterTeamVisibleBases,
} from "./service-shared";
import { seedWorkspace } from "./service-seed";

/**
 * Knowledge base reads. `getBaseById` / `getBaseBySlug` are the foundational
 * visibility-checked lookups the other service modules build on, and where the
 * agent audience ceiling (`service-audience.ts`) is applied — every other
 * knowledge read composes one of them, so fencing here fences the surface.
 *
 * A NEW foundational lookup that reaches `repository-bases.ts` directly instead
 * of composing one of these owes itself the same two gates; that regression has
 * happened once (`service-entries.ts › getEntry`, fixed 2026-08-26).
 * `service-audience.test.ts` pins the lookups by driving them.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Which of `bases` sit on the caller's PERSONAL (/home) shelf — the sibling key
 * behind `GET /api/knowledge/bases › homeScopedBaseIds`.
 *
 * A label over an already-fenced list, never a second read path: it takes the
 * POST-visibility rows and applies no visibility of its own, so it must never be
 * handed a wider set — the id set IS the fence, exactly as
 * `service-stars.ts › listStarredBaseIds` states it.
 *
 * It projects nothing shelf-shaped onto the row, so the SDK-mirrored
 * `KnowledgeBase` does not widen (`check-knowledge-type-drift`).
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
 * `opts.shelf` narrows to one shelf (`../types.ts › KbShelf`); omitting it means
 * BOTH. It is applied in the QUERY, not over the result, so a shelf the caller
 * did not ask for never reaches the wire (INVARIANTS §11).
 *
 * A shelf read never seeds: the seed gate below is "this workspace has NO bases
 * at all", and asked of one shelf it would re-seed a <24h-old workspace whose
 * content all lives on the other shelf on every visit.
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
  // The ceiling is the OUTERMOST filter, applied after the workspace gates
  // rather than instead of them: an agent gets the intersection of what this
  // caller could see anyway and what was granted into this container's
  // channels. Neither gate substitutes for the other.
  const [audience, granted] = await Promise.all([
    resolveAgentAudience(ctx),
    baseGrantsFor(ctx, all),
  ]);
  const visible = (
    await filterTeamVisibleBases(ctx, all.filter((b) => canSeeBase(ctx, b, granted)))
  ).filter((b) => audienceAdmits(audience, b.id));
  if (visible.length > 0) return visible;
  // A narrowed read stops here — see the docblock. `all` is this SHELF's rows,
  // so every gate below would answer a different question.
  if (opts.shelf !== undefined) return visible;
  // Gate on the UNFILTERED count, not what the caller sees — else a member
  // joining a workspace whose only bases are someone else's private items
  // re-triggers seed on every list call.
  if (all.length > 0) return visible;
  // Demo bypass: auto-seed off; new workspaces start empty. Flip to false to
  // restore onboarding seeding. Typed `boolean`, not literal `true`, so TS keeps
  // the code below reachable.
  const DEMO_DISABLE_AUTO_SEED: boolean = true;
  if (DEMO_DISABLE_AUTO_SEED) return visible;
  const workspaceCreatedAt = await fetchWorkspaceCreatedAt(ctx.workspaceId);
  if (
    workspaceCreatedAt !== null &&
    Date.now() - workspaceCreatedAt.getTime() < TWENTY_FOUR_HOURS_MS
  ) {
    await seedWorkspace(ctx);
    const seeded = await repo.listBasesForWorkspace(ctx.workspaceId, false);
    const seededGrants = await baseGrantsFor(ctx, seeded);
    return (
      await filterTeamVisibleBases(
        ctx,
        seeded.filter((b) => canSeeBase(ctx, b, seededGrants))
      )
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
 * "{N} entries · updated {when}" line and usage bar. Takes the POST-visibility
 * base list: the id set IS the fence. Every id gets an entry — empty base is
 * `0`, never a missing key.
 * `storageBytes` reads a column existing only after
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
    // Parsed, not lexicographic: Postgres timestamps arrive with a variable
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

/**
 * Keyed to `ctx.workspaceId`: one container, both gates. The in-container load
 * every other door in this file is built from — {@link loadVisibleBase} calls it
 * once per container, {@link getBaseForWrite} is that plus the landed context.
 *
 * Not a write gate for a row the caller may name elsewhere (2026-09-06). Sites
 * still on it — `service-pins.ts`, `service-stars.ts`, the channel-grants route
 * — keep a workspace-keyed refusal on a cross-container id; migrating one means
 * switching to {@link getBaseForWrite} AND passing the returned `ctx` to
 * everything after it, never just the first half.
 */
export async function getBaseById(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseById(id, false);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  // 404, not 403, so visibility itself isn't an oracle.
  await assertBaseVisible(ctx, base);
  await assertWithinAudience(ctx, base.id);
  return base;
}

/**
 * The id-resolving read: same row, same two gates, same 404 — but the id says
 * which container to apply them in, so `workspace=` is optional and a
 * `workspace=` contradicting a resolvable id is ignored rather than refused.
 *
 * Resolution is not authorisation, and the order says so:
 * `shared/tenancy/resolve-resource.ts` is strictly NARROWER than this file's
 * gates, so the matrix AND the agent audience ceiling both run again in the
 * container it named, with the caller's real role there.
 */
export async function readBaseById(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  return (await readBaseInContext(ctx, id)).value;
}

/**
 * The same read, plus the container it landed in. A base's contents are
 * workspace-keyed, so a caller that followed an id and then composed against the
 * ORIGINAL context reads the row from one container and its entries from another
 * (`read-resource.ts › ContainerRead`); `service-paths.ts › readFileByPath` is
 * the caller that needs it.
 */
export async function readBaseInContext(
  ctx: KnowledgeContext,
  id: string
): Promise<ContainerRead<KnowledgeContext, KnowledgeBase>> {
  const hit = await readResourceById(ctx, "knowledge_base", id, loadVisibleBase);
  if (!hit) throw new KnowledgeBaseNotFoundError(id);
  return hit;
}

/**
 * The write gate (2026-09-06, Samuel's ruling — see
 * `shared/tenancy/read-resource.ts`): the id names its own container on a WRITE
 * as it already did on a read, and the caller gets the container back so the
 * write lands in it.
 *
 * It is {@link readBaseInContext} and not a second composition. The follow
 * is one mechanic; a write-flavoured copy of it would be the copy that stops
 * matching the read (F-278). What makes it a WRITE gate is the obligation the
 * return type puts on the caller: the `ctx` it hands back is the one every
 * workspace-keyed call downstream must use.
 *
 * It authorises nothing by itself — `assertBaseWritable`, `assertAgentCanDelete`
 * and the sharing/creator checks are the caller's to run, against the RETURNED
 * ctx, so a grant is weighed where the base actually lives.
 */
export async function getBaseForWrite(
  ctx: KnowledgeContext,
  id: string
): Promise<ContainerRead<KnowledgeContext, KnowledgeBase>> {
  return readBaseInContext(ctx, id);
}

/**
 * {@link getBaseById}'s answer as a `null`, which is what a follow needs.
 *
 * It wraps the gate rather than restating it:
 * a second null-returning copy of them is the F-278 shape ("the copy is the one
 * that will not notice"). So the twin TRANSLATES two errors, listed explicitly —
 * anything else this read can throw still propagates.
 *
 * `KnowledgeBaseMismatchError` is one of the two, and is why a follow is needed
 * at all: it is what `getBaseById` says about a base in another container.
 */
async function loadVisibleBase(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase | null> {
  try {
    return await getBaseById(ctx, id);
  } catch (err) {
    if (
      err instanceof KnowledgeBaseNotFoundError ||
      err instanceof KnowledgeBaseMismatchError
    ) {
      return null;
    }
    throw err;
  }
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
 * The single-base half of the ceiling. Throws the SAME
 * `KnowledgeBaseNotFoundError` an invisible base throws, so "not granted into
 * this container", "not visible to you" and "does not exist" are one answer: a
 * 403 here would tell an agent the id it guessed was real.
 *
 * It runs AFTER `assertBaseVisible`, which keeps the audience read off the path
 * of every caller the workspace gates already refuse.
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
