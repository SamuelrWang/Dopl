import "server-only";

/**
 * Service layer for the knowledge feature — the public surface.
 *
 * Single source of truth — REST handlers (Item 2) and MCP tools (Item 4)
 * both call into this. The service:
 *   - Builds `KnowledgeContext` from auth metadata at the route boundary.
 *   - Enforces the per-base `agent_write_enabled` toggle for any
 *     `source: "agent"` mutation.
 *   - Resolves slugs / IDs into rows, validates workspace scope, throws
 *     domain errors that the route layer maps to HTTP responses.
 *   - Walks the folder tree for cycle detection on `moveFolder`.
 *   - Lazy-seeds brand-new workspaces with the legacy fixtures via
 *     `listBases`.
 *
 * This module is a barrel: the implementation lives in per-domain
 * siblings so each file has one clear purpose. Cross-cutting gates and
 * helpers used by more than one domain live in `service-shared.ts`.
 *   - `service-shared.ts`   — context, visibility gates, write gate, helpers
 *   - `service-bases.ts`    — base reads (`getBaseById` is the shared gate)
 *   - `service-base-writes.ts` — base create/update/delete
 *   - `service-folders.ts`  — folder reads + writes + `getBaseTree`
 *   - `service-entries.ts`  — entry reads + writes + `resolveEntryRefs`
 *   - `service-paths.ts`    — path-addressed reads + writes
 *   - `service-seed.ts`     — workspace fixture seeding
 *
 * DELETES ARE PERMANENT (2026-08-07). Soft-delete, trash listing, restore
 * and purge are gone — `delete*` removes the rows immediately. The
 * `deleted_at` columns and the read-path `deleted_at IS NULL` filters stay
 * so rows tombstoned before the switch remain hidden until the one-time
 * cleanup migration (`20260807110000_purge_soft_deleted_rows.sql`) sweeps
 * them.
 */

export { buildKnowledgeContext, assertBaseWritable } from "./service-shared";
export type { AuthLike } from "./service-shared";

export {
  listBases,
  listBaseOwnerNames,
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

export { seedWorkspace } from "./service-seed";
