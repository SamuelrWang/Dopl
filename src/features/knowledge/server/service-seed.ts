import "server-only";
import { randomUUID } from "node:crypto";
import type { KnowledgeContext } from "../types";
import * as repo from "./repository";
import { buildSeedKnowledgeBases, DOPL_GUIDE_SLUG } from "./seed";
import { deriveSlug } from "./service-shared";

/** Seeded base with each entry's stable `key` → inserted uuid + title. The
 *  orchestrator threads `entryIdByKey` into the ontology seed. */
export interface SeededBase {
  baseId: string;
  slug: string;
  entryIdByKey: Record<string, { id: string; title: string }>;
}

export interface SeedKnowledgeResult {
  basesCreated: number;
  /** Dopl Guide base (cross-reference anchor), null if nothing seeded. */
  guide: SeededBase | null;
}

/**
 * Idempotent — skips entirely if the workspace has any active base. Returns
 * created ids so callers can cross-reference entries.
 *
 * ⚠ TWO writes total whatever the corpus size (one bases insert, one entries
 * insert) — this runs in front of the post-signup redirect. Positions are
 * assigned BY INDEX, matching what sequential max+1 yields on a fresh base.
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
      // Starter content: public so every member sees it. ⚠ The one path where
      // public is correct — `createBase` defaults to private.
      visibility: "public" as const,
      createdBy: ctx.userId,
    }))
  );
  // ⚠ Keyed by slug, not index — nothing may depend on returned row order.
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
      // ⚠ uuid minted HERE so the cross-reference map is complete before the
      // insert resolves — the ontology seed builds attributes from it.
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
        // System-origin, not an agent edit: even an agent-triggered lazy seed
        // records `last_edited_source = 'user'`.
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
