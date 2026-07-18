import "server-only";

/**
 * Raw Supabase I/O for the knowledge feature — the public surface. No
 * business logic, no auth checks, no error translation — that all lives
 * in the service layer.
 *
 * Convention:
 *   - `find*` returns `T | null` for "not found".
 *   - `list*` returns `T[]` (possibly empty).
 *   - `insert*` / `update*` / `mark*Deleted` / `restore*` throw on error.
 *   - Active vs trashed: every list/find takes `includeDeleted`. Default
 *     `false` (active rows only). Trash views pass `true` and filter
 *     `deletedAt !== null` themselves; restore paths pass `true` so they
 *     can read deleted rows.
 *   - Service-role client bypasses RLS; the service is responsible for
 *     workspace scoping. Every method that takes a `workspaceId` param
 *     filters by it explicitly so RLS bypass is contained.
 *
 * This module is a barrel: the implementation lives in per-domain
 * siblings so each file has one clear purpose. Every existing importer
 * (`import * as repo from "./repository"`) keeps working unchanged.
 *   - `repository-bases.ts`   — base reads + writes + cascade trash/restore
 *   - `repository-folders.ts` — folder reads + ancestor walk + writes
 *   - `repository-entries.ts` — entry reads (incl. path-resolver helpers) + writes
 *   - `repository-trash.ts`   — trash listing + hard-delete (purge)
 */

export {
  findBaseById,
  listBasesByIds,
  findBaseBySlug,
  findBaseByPublicId,
  listBasesForWorkspace,
  listBaseSlugsForWorkspace,
  insertBase,
  updateBaseRow,
  markBaseDeleted,
  restoreBaseRow,
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
  markFolderDeleted,
  restoreFolderRow,
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
  updateEntryRow,
  markEntryDeleted,
  restoreEntryRow,
} from "./repository-entries";
export type {
  ListEntriesOpts,
  InsertEntryArgs,
  UpdateEntryPatch,
} from "./repository-entries";

export {
  listDeletedForWorkspace,
  hardDeleteOlderThan,
  purgeBaseRow,
  purgeFolderRow,
  purgeEntryRow,
} from "./repository-trash";
export type { DeletedRows } from "./repository-trash";
