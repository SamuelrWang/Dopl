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
 *   - `service-pins.ts`     — WORKSPACE-WIDE pins (the launch reading list)
 *   - `service-startup-context.ts` — the capped payload a session starts with
 *   - `service-seed.ts`     — workspace fixture seeding
 *
 * Deletes are PERMANENT — no soft-delete, trash, restore or purge (Samuel's
 * ruling, restated 2026-09-18: *"When a user deletes a KB, it's just gone."*).
 *
 * ⚠ **THE SWEEP THIS BLOCK USED TO WAIT ON HAS HAPPENED.**
 * `20260807110000_purge_soft_deleted_rows.sql` applied and there are no
 * tombstones left to hide (a COUNT is a measurement — re-derive with `SELECT
 * count(*) FROM knowledge_bases WHERE deleted_at IS NOT NULL`, and the same on
 * `knowledge_entries` / `knowledge_folders`; all three read 0 on 2026-09-18).
 * The DATABASE half of the retirement landed with
 * `20261013120000_drop_knowledge_soft_delete.sql`, which drops the trash/restore
 * RPCs and the two trigger functions that still wrote the dropped
 * `workflow_*` tables.
 *
 * What survives here is the `deleted_at` COLUMNS, their indexes and the
 * `deleted_at IS NULL` read filters — inert, because nothing in this tree
 * writes the column and `includeDeleted` is `false` at every call site. They
 * stay because removing them is not mechanical: three of the indexes are
 * PARTIAL UNIQUE constraints that would have to be rebuilt, and `deletedAt` is
 * on the `@dopl/client` mirror that `scripts/check-knowledge-type-drift.ts`
 * pins. **F-730 carries the exact remaining work.** A column nothing writes is
 * not a soft delete; it is a column.
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
  readBaseById,
} from "./service-bases";

export {
  createBase,
  // The create's gate chain without the write — what `POST
  // /api/knowledge/bases?dryRun=1` runs, so the MCP preview is answered by the
  // same gates the confirmed call passes.
  assertCreateBaseAllowed,
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
  readEntry,
  resolveEntryRefs,
  createEntry,
  updateEntry,
  moveEntry,
  deleteEntry,
} from "./service-entries";
export type { ListEntriesOpts, KnowledgeEntryRef } from "./service-entries";

// The changelog's READ half. The capture half is deliberately NOT on this
// barrel: nothing outside `server/` may record a revision by hand — a write
// records its own, in the same request, or the history has a hole in it.
export {
  listEntryRevisions,
  listBaseRevisions,
  restoreEntryRevision,
} from "./service-revisions-read";

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

export {
  listPinnedBaseIds,
  pinBase,
  pinEntry,
} from "./service-pins";

export {
  getStartupContext,
  STARTUP_CONTEXT_CHAR_CAP,
} from "./service-startup-context";
export type {
  StartupContext,
  StartupContextItem,
  StartupContextPointer,
} from "./service-startup-context";

export { seedWorkspace } from "./service-seed";
