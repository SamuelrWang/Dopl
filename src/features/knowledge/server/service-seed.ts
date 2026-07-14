import "server-only";
import type { KnowledgeContext } from "../types";
import * as repo from "./repository";
import { buildSeedKnowledgeBases } from "./seed";
import { deriveSlug } from "./service-shared";

/**
 * Idempotent — skips entirely if the workspace already has any active
 * base. Inserts each fixture as a base + its root entries (folders are
 * empty in the legacy fixtures).
 */
export async function seedWorkspace(
  ctx: KnowledgeContext
): Promise<{ basesCreated: number }> {
  const existing = await repo.listBasesForWorkspace(ctx.workspaceId, false);
  if (existing.length > 0) return { basesCreated: 0 };

  const fixtures = buildSeedKnowledgeBases();
  const taken = await repo.listBaseSlugsForWorkspace(ctx.workspaceId);
  let basesCreated = 0;

  for (const fixture of fixtures) {
    const slug = deriveSlug(fixture.slug, taken);
    taken.push(slug);
    const base = await repo.insertBase({
      workspaceId: ctx.workspaceId,
      name: fixture.name,
      slug,
      description: fixture.description,
      agentWriteEnabled: fixture.agentWriteEnabled ?? false,
      // Seeded fixtures are workspace starter content — public so
      // every member sees them. (Owner-explicit `createBase` calls
      // default to private; this is the one path where public is
      // semantically correct.)
      visibility: "public",
      createdBy: ctx.userId,
    });
    basesCreated += 1;

    for (const entryInput of fixture.rootEntries) {
      await repo.insertEntry({
        workspaceId: ctx.workspaceId,
        knowledgeBaseId: base.id,
        folderId: null,
        title: entryInput.title,
        excerpt: entryInput.excerpt,
        body: entryInput.body,
        entryType: entryInput.entryType,
        position: entryInput.position,
        createdBy: ctx.userId,
        // Seed inserts are system-origin, not agent edits — even when
        // an agent triggers the lazy seed via listBases, the rows
        // themselves should record `last_edited_source = 'user'`.
        source: "user",
      });
    }
    // Folder seeding deferred — legacy fixtures are flat. When Item 3
    // introduces nested seed data, recurse `fixture.rootFolders` here.
  }

  return { basesCreated };
}
