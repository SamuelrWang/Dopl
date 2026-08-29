import "server-only";

/**
 * Public surface of the knowledge service — a BARREL. Single source of truth
 * for REST handlers and MCP tools alike; implementation lives in per-domain
 * siblings:
 *   - `service-shared.ts`   — context, visibility gates, write gate, helpers
 *   - `service-bases.ts`    — base reads (`getBaseById` is the shared gate)
 *   - `service-base-writes.ts` — base create/update/delete
 *   - `service-folders.ts`  — folder reads + writes + `getBaseTree`
 *   - `service-entries.ts`  — entry reads + writes + `resolveEntryRefs`
 *   - `service-paths.ts`    — path-addressed reads + writes
 *   - `service-storage.ts`  — per-KB storage cap (growth gate + limit)
 *   - `service-stars.ts`    — PER-USER base stars, scoped to ctx.userId
 *   - `service-seed.ts`     — workspace fixture seeding
 *
 * ⚠ DELETES ARE PERMANENT. No soft-delete, trash, restore or purge. The
 * `deleted_at` columns and read-path `deleted_at IS NULL` filters remain only
 * so pre-switch tombstones stay hidden until
 * `20260807110000_purge_soft_deleted_rows.sql` sweeps them.
 */

export { buildKnowledgeContext, assertBaseWritable } from "./service-shared";
export type { AuthLike } from "./service-shared";

export {
  listBases,
  listBaseOwnerNames,
  listBaseStats,
  listHomeScopedBaseIds,
  getBaseById,
  getBaseBySlug,
} from "./service-bases";

export {
  createBase,
  updateBase,
  deleteBase,
} from "./service-base-writes";

export {
  listFolders,
  getBaseTree,
  createFolder,
  updateFolder,
  moveFolder,
  deleteFolder,
} from "./service-folders";

export {
  listEntries,
  getEntry,
  resolveEntryRefs,
  createEntry,
  updateEntry,
  moveEntry,
  deleteEntry,
} from "./service-entries";
export type { ListEntriesOpts, KnowledgeEntryRef } from "./service-entries";

export {
  readFileByPath,
  writeFileByPath,
  createFolderByPath,
  deleteByPath,
  moveByPath,
  listDirByPath,
} from "./service-paths";
export type { WriteFileByPathInput } from "./service-paths";

export {
  assertStorageHeadroom,
  bodyBytes,
  kbStorageDeniedBody,
  resolveKbStorageLimit,
} from "./service-storage";

export {
  listStarredBaseIds,
  starBase,
  unstarBase,
} from "./service-stars";

export { seedWorkspace } from "./service-seed";
