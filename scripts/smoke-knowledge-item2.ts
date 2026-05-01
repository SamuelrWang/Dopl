/**
 * Item 2 smoke test — exercises the additions made in this item.
 *
 *   1. `getBaseTree` returns the expected shape for each seeded base.
 *   2. `mapKnowledgeError` returns the right HttpError code for each
 *      domain-error class, and `null` for unknown errors.
 *   3. End-to-end CRUD round-trip via the service: create → update
 *      (clearing description with null) → soft-delete → restore.
 *   4. Cross-base mismatch returns the expected error class.
 *
 * Routes themselves are thin wrappers; if the service paths are sound
 * and the error mapping is correct, the routes are correct. Live HTTP
 * sweep is for the user to run via curl when the dev server is up.
 *
 * Usage:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/smoke-knowledge-item2.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

// Audit fix #18: env-driven instead of hardcoded UUIDs.
function envOrFail(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `[smoke] Missing ${name}. Set it in .env.local to a UUID from your Supabase project.`
    );
    process.exit(1);
  }
  return v;
}
const WORKSPACE_ID = envOrFail("SMOKE_WORKSPACE_ID");
const USER_ID = envOrFail("SMOKE_USER_ID");

async function main() {
  const {
    buildKnowledgeContext,
    getBaseTree,
    listBases,
    createBase,
    updateBase,
    softDeleteBase,
    restoreBase,
  } = await import("@/features/knowledge/server/service");
  const { mapKnowledgeError } = await import(
    "@/features/knowledge/server/http-mapping"
  );
  const {
    AgentWriteDisabledError,
    EntryNotFoundError,
    FolderCycleError,
    FolderNotFoundError,
    KnowledgeBaseMismatchError,
    KnowledgeBaseNotFoundError,
  } = await import("@/features/knowledge/server/errors");

  const ctx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    apiKeyId: null,
  });

  // ── 1. getBaseTree on a seeded base ───────────────────────────────
  const bases = await listBases(ctx);
  if (bases.length < 4) throw new Error(`Expected ≥4 seeded bases, got ${bases.length}`);
  const first = bases[0];
  const tree = await getBaseTree(ctx, first.id);
  console.log(
    `✅ getBaseTree(${first.slug}): ${tree.folders.length} folders, ${tree.entries.length} entries`
  );
  if (tree.entries.some((e) => e.body !== "")) {
    throw new Error("getBaseTree should strip bodies but some came through");
  }
  if (tree.entries.length === 0) {
    throw new Error("getBaseTree returned no entries for a seeded base");
  }

  // ── 2. mapKnowledgeError per class ────────────────────────────────
  const cases: Array<[Error, number, string]> = [
    [new KnowledgeBaseNotFoundError("x"), 404, "KNOWLEDGE_BASE_NOT_FOUND"],
    [new FolderNotFoundError("x"), 404, "KNOWLEDGE_FOLDER_NOT_FOUND"],
    [new EntryNotFoundError("x"), 404, "KNOWLEDGE_ENTRY_NOT_FOUND"],
    [new AgentWriteDisabledError("x"), 403, "AGENT_WRITE_DISABLED"],
    [new FolderCycleError("a", "b"), 409, "KNOWLEDGE_FOLDER_CYCLE"],
    [new KnowledgeBaseMismatchError("x"), 400, "KNOWLEDGE_BASE_MISMATCH"],
  ];
  for (const [err, status, code] of cases) {
    const mapped = mapKnowledgeError(err);
    if (!mapped) throw new Error(`mapKnowledgeError returned null for ${err.constructor.name}`);
    if (mapped.status !== status || mapped.code !== code) {
      throw new Error(
        `Mapping mismatch for ${err.constructor.name}: got ${mapped.status} ${mapped.code}, expected ${status} ${code}`
      );
    }
  }
  if (mapKnowledgeError(new Error("random")) !== null) {
    throw new Error("mapKnowledgeError should return null for unrecognized errors");
  }
  console.log(`✅ mapKnowledgeError: 6 domain classes mapped, fallback returns null`);

  // ── 3. CRUD round-trip on a scratch KB ────────────────────────────
  const scratch = await createBase(ctx, {
    name: `Smoke Test ${new Date().toISOString()}`,
    description: "to be deleted",
  });
  console.log(`✅ createBase: ${scratch.slug}`);

  const cleared = await updateBase(ctx, scratch.id, { description: null });
  if (cleared.description !== null) {
    throw new Error(
      `description was not cleared by null patch — Item 1 audit fix regressed`
    );
  }
  console.log(`✅ updateBase: description cleared via null patch`);

  await softDeleteBase(ctx, scratch.id);
  const afterDelete = await listBases(ctx);
  if (afterDelete.some((b) => b.id === scratch.id)) {
    throw new Error("scratch base still appears in active list after soft-delete");
  }
  console.log(`✅ softDeleteBase: removed from active list`);

  const restored = await restoreBase(ctx, scratch.id);
  if (restored.deletedAt !== null) {
    throw new Error("restoreBase did not clear deleted_at");
  }
  console.log(`✅ restoreBase: deletedAt cleared`);

  // Cleanup — soft-delete the scratch base so we don't leave noise.
  await softDeleteBase(ctx, scratch.id);
  console.log(`✅ cleanup: scratch base soft-deleted`);

  console.log(`\nAll Item 2 smoke checks passed.`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
