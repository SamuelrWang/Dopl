import "server-only";

/**
 * Raw Supabase I/O for the knowledge feature — the public surface. No
 * business logic, no auth checks, no error translation — that all lives
 * in the service layer.
 *
 * Convention:
 *   - `find*` returns `T | null` for "not found".
 *   - `list*` returns `T[]` (possibly empty).
 *   - `insert*` / `update*` / `hardDelete*` throw on error.
 *   - `includeDeleted` on the list/find helpers is a LEGACY-TOMBSTONE
 *     escape hatch, not a trash surface: deletes are permanent as of
 *     2026-08-07, so nothing new is ever soft-deleted. The default
 *     (`false`) keeps the `deleted_at IS NULL` filter that hides rows
 *     tombstoned before the switch.
 *   - Service-role client bypasses RLS; the service is responsible for
 *     workspace scoping. Every method that takes a `workspaceId` param
 *     filters by it explicitly so RLS bypass is contained.
 *
 * This module is a barrel: the implementation lives in per-domain
 * siblings so each file has one clear purpose. Every existing importer
 * (`import * as repo from "./repository"`) keeps working unchanged.
 *   - `repository-bases.ts`   — base reads + writes + hard delete
 *   - `repository-folders.ts` — folder reads + ancestor walk + writes + hard delete
 *   - `repository-entries.ts` — entry reads (incl. path-resolver helpers) + writes + hard delete
 */

export {
  findBaseById,
  listBasesByIds,
  findBaseBySlug,
  findBaseByPublicId,
  listBasesForWorkspace,
  listBaseSlugsForWorkspace,
  insertBase,
  insertBases,
  updateBaseRow,
  hardDeleteBase,
  fetchProfileNames,
} from "./repository-bases";
export type { InsertBaseArgs, UpdateBasePatch } from "./repository-bases";

export {
  findFolderById,
  listFoldersForBase,
  findActiveFolderByName,
  listFolderAncestors,
  insertFolder,
  updateFolderRow,
  hardDeleteFolder,
} from "./repository-folders";
export type { InsertFolderArgs, UpdateFolderPatch } from "./repository-folders";

export {
  findEntryById,
  findActiveEntryByTitle,
  listActiveEntryTitlesIn,
  findActiveEntryById,
  listEntriesForBase,
  countEntriesForBase,
  listEntriesByIds,
  insertEntry,
  insertEntries,
  updateEntryRow,
  hardDeleteEntry,
} from "./repository-entries";
export type {
  ListEntriesOpts,
  InsertEntryArgs,
  InsertEntriesArgs,
  UpdateEntryPatch,
} from "./repository-entries";
