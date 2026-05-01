/**
 * Item 4 path-resolver smoke test. Exercises the new path-based
 * service methods (writeFileByPath, readFileByPath, createFolderByPath,
 * listDirByPath, moveByPath, deleteByPath) against the user's real
 * workspace.
 *
 * Cleans up after itself — creates everything under a "smoke-paths-<ts>"
 * scratch base and soft-deletes the base at the end.
 *
 * Usage:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/smoke-knowledge-paths.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const WORKSPACE_ID = "46090e9c-e033-452b-a77b-dda54d9c9da6";
const USER_ID = "e95bd11c-32b9-42ab-b754-ffe93787de0a";

async function main() {
  const {
    buildKnowledgeContext,
    createBase,
    softDeleteBase,
    writeFileByPath,
    readFileByPath,
    createFolderByPath,
    listDirByPath,
    moveByPath,
    deleteByPath,
  } = await import("@/features/knowledge/server/service");
  const { parsePath, pathToString } = await import(
    "@/features/knowledge/server/path"
  );
  const { PathTraversalError } = await import(
    "@/features/knowledge/server/errors"
  );

  // ── Pure path utilities ───────────────────────────────────────────
  if (parsePath("foo/bar/").join(",") !== "foo,bar")
    throw new Error("parsePath trailing slash");
  if (parsePath("/foo//bar/").join(",") !== "foo,bar")
    throw new Error("parsePath empty segments");
  if (parsePath("").length !== 0) throw new Error("parsePath empty");
  if (pathToString(["a", "b"]) !== "a/b") throw new Error("pathToString");
  console.log("✅ parsePath / pathToString");

  // ── Setup: scratch base with agent_write_enabled = true ───────────
  const ctx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    apiKeyId: null,
  });
  const base = await createBase(ctx, {
    name: `smoke paths ${new Date().toISOString()}`,
    description: "auto-cleanup",
    agentWriteEnabled: true,
  });
  console.log(`✅ scratch base: ${base.slug}`);

  try {
    // ── writeFileByPath: mkdir -p + create ─────────────────────────
    const entry = await writeFileByPath(ctx, base.id, "a/b/c.md", {
      body: "hello",
    });
    if (entry.body !== "hello") throw new Error("write body mismatch");
    if (entry.title !== "c.md") throw new Error("write title mismatch");
    console.log(`✅ writeFileByPath (create): a/b/c.md`);

    // ── writeFileByPath: same path → update ────────────────────────
    const updated = await writeFileByPath(ctx, base.id, "a/b/c.md", {
      body: "hello updated",
    });
    if (updated.id !== entry.id) throw new Error("upsert produced new entry");
    if (updated.body !== "hello updated") throw new Error("update body");
    console.log(`✅ writeFileByPath (update): same id, new body`);

    // ── readFileByPath ─────────────────────────────────────────────
    const read = await readFileByPath(ctx, base.id, "a/b/c.md");
    if (read.body !== "hello updated") throw new Error("read body mismatch");
    console.log(`✅ readFileByPath`);

    // ── createFolderByPath: idempotent ─────────────────────────────
    const folderA = await createFolderByPath(ctx, base.id, "a");
    if (folderA.name !== "a") throw new Error("folder name");
    const folderB = await createFolderByPath(ctx, base.id, "a/b");
    if (folderB.parentId !== folderA.id) throw new Error("parent mismatch");
    console.log(`✅ createFolderByPath (idempotent): a, a/b`);

    // ── listDirByPath at root ──────────────────────────────────────
    const rootListing = await listDirByPath(ctx, base.id, "");
    if (rootListing.folders.length !== 1) throw new Error("root folders");
    if (rootListing.folders[0].name !== "a") throw new Error("root folder name");
    console.log(`✅ listDirByPath ""`);

    // ── listDirByPath at a/b ───────────────────────────────────────
    const innerListing = await listDirByPath(ctx, base.id, "a/b");
    if (innerListing.entries.length !== 1)
      throw new Error("inner entries count");
    if (innerListing.entries[0].title !== "c.md")
      throw new Error("inner entry title");
    console.log(`✅ listDirByPath "a/b"`);

    // ── moveByPath: rename ─────────────────────────────────────────
    await moveByPath(ctx, base.id, "a/b/c.md", "a/b/c2.md");
    const renamed = await readFileByPath(ctx, base.id, "a/b/c2.md");
    if (renamed.id !== entry.id) throw new Error("rename produced new id");
    console.log(`✅ moveByPath (rename in place)`);

    // ── moveByPath: cross-folder ───────────────────────────────────
    await moveByPath(ctx, base.id, "a/b/c2.md", "a/d.md");
    const moved = await readFileByPath(ctx, base.id, "a/d.md");
    if (moved.id !== entry.id) throw new Error("move produced new id");
    console.log(`✅ moveByPath (cross-folder)`);

    // ── PathTraversalError on missing parent ──────────────────────
    let threw = false;
    try {
      await readFileByPath(ctx, base.id, "missing/dir/file.md");
    } catch (err) {
      threw = err instanceof PathTraversalError;
    }
    if (!threw) throw new Error("expected PathTraversalError");
    console.log(`✅ PathTraversalError thrown for missing parent`);

    // ── deleteByPath ───────────────────────────────────────────────
    await deleteByPath(ctx, base.id, "a/d.md");
    let stillExists = true;
    try {
      await readFileByPath(ctx, base.id, "a/d.md");
    } catch {
      stillExists = false;
    }
    if (stillExists) throw new Error("delete didn't take effect");
    console.log(`✅ deleteByPath`);
  } finally {
    await softDeleteBase(ctx, base.id);
    console.log(`✅ cleanup: scratch base soft-deleted`);
  }

  console.log(`\nAll Item 4 path-resolver checks passed.`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
