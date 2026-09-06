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
  readBaseById,
} from "./service-bases";

export {
  createBase,
  // 🔒 THE CREATE'S GATE CHAIN WITHOUT THE WRITE — what `POST
  // /api/knowledge/bases?dryRun=1` runs, so the MCP confirm-class PREVIEW is
  // answered by the same gates the confirmed call passes. ⚠ A barrel row WITH
  // an importer (the route); see `service-base-writes.ts` for why parity here
  // is structural rather than a second list.
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
