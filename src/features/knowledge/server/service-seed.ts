import "server-only";
import { randomUUID } from "node:crypto";
import type { KnowledgeContext } from "../types";
import * as repo from "./repository";
import { buildSeedKnowledgeBases, DOPL_GUIDE_SLUG } from "./seed";
import { deriveSlug } from "./service-shared";

/**
 * A base inserted by the seed, with each entry's stable `key` mapped to
 * its inserted uuid + title. The orchestrator threads `entryIdByKey`
 * into the ontology + workflow seeds so their cross-references resolve.
 */
export interface SeededBase {
  baseId: string;
  slug: string;
  entryIdByKey: Record<string, { id: string; title: string }>;
}

export interface SeedKnowledgeResult {
  basesCreated: number;
  /** The Dopl Guide base (the cross-reference anchor), or null if nothing seeded. */
  guide: SeededBase | null;
}

/**
 * Idempotent — skips entirely if the workspace already has any active
 * base. Inserts each fixture as a base + its root entries (folders are
 * empty in the current fixtures) and returns the created ids so callers
 * can cross-reference specific entries.
 *
 * TWO writes total, whatever the corpus size — one bases insert, one
 * entries insert. It used to be `1 + entries` inserts per fixture, each
 * awaited, plus a `maxEntryPositionIn` read per entry because the fixtures
 * don't pin `position`; the whole thing sat in front of the post-signup
 * redirect. Positions are assigned by index here, which is exactly what
 * the sequential max+1 produced on a fresh base.
 */
export async function seedWorkspace(
  ctx: KnowledgeContext
): Promise<SeedKnowledgeResult> {
  const existing = await repo.listBasesForWorkspace(ctx.workspaceId, false);
  if (existing.length > 0) return { basesCreated: 0, guide: null };

  const fixtures = buildSeedKnowledgeBases();
  const taken = await repo.listBaseSlugsForWorkspace(ctx.workspaceId);
  const slugByFixture = fixtures.map((fixture) => {
    const slug = deriveSlug(fixture.slug, taken);
    taken.push(slug);
    return slug;
  });

  const bases = await repo.insertBases(
    fixtures.map((fixture, i) => ({
      workspaceId: ctx.workspaceId,
      name: fixture.name,
      slug: slugByFixture[i],
      description: fixture.description,
      agentWriteEnabled: fixture.agentWriteEnabled ?? false,
      // Seeded fixtures are workspace starter content — public so
      // every member sees them. (Owner-explicit `createBase` calls
      // default to private; this is the one path where public is
      // semantically correct.)
      visibility: "public" as const,
      createdBy: ctx.userId,
    }))
  );
  // Keyed by slug, not by index: nothing here depends on the order the
  // insert returns its rows in.
  const baseIdBySlug = new Map(bases.map((base) => [base.slug, base.id]));

  const entryRows: repo.InsertEntriesArgs[] = [];
  const guideEntryIds: Record<string, { id: string; title: string }> = {};
  let guide: SeededBase | null = null;

  for (const [i, fixture] of fixtures.entries()) {
    const slug = slugByFixture[i];
    const baseId = baseIdBySlug.get(slug);
    if (!baseId) continue;
    const isGuide = fixture.slug === DOPL_GUIDE_SLUG;
    if (isGuide) guide = { baseId, slug, entryIdByKey: guideEntryIds };

    fixture.rootEntries.forEach((entryInput, position) => {
      // The uuid is minted HERE so the cross-reference map is complete
      // before the insert resolves — the ontology seed's attributes are
      // built from it, and nothing has to match returned rows back to
      // authoring keys.
      const id = randomUUID();
      entryRows.push({
        id,
        workspaceId: ctx.workspaceId,
        knowledgeBaseId: baseId,
        folderId: null,
        title: entryInput.title,
        excerpt: entryInput.excerpt,
        body: entryInput.body,
        entryType: entryInput.entryType,
        position: entryInput.position ?? position,
        createdBy: ctx.userId,
        // Seed inserts are system-origin, not agent edits — even when
        // an agent triggers the lazy seed via listBases, the rows
        // themselves should record `last_edited_source = 'user'`.
        source: "user",
      });
      if (isGuide && entryInput.key) {
        guideEntryIds[entryInput.key] = { id, title: entryInput.title };
      }
    });
  }

  await repo.insertEntries(entryRows);

  return { basesCreated: bases.length, guide };
}
