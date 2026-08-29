import "server-only";

/**
 * Raw Supabase I/O for knowledge — public surface, a BARREL. No business
 * logic, no auth checks, no error translation; those live in the service.
 *
 * Convention:
 *   - `find*` → `T | null`; `list*` → `T[]`; `insert*` / `update*` /
 *     `hardDelete*` throw on error.
 *   - ⚠ `includeDeleted` is a LEGACY-TOMBSTONE escape hatch, NOT a trash
 *     surface — deletes are permanent, nothing new is soft-deleted. Default
 *     `false` keeps the `deleted_at IS NULL` filter hiding pre-switch rows.
 *   - ⚠ Service-role client BYPASSES RLS. Every method taking `workspaceId`
 *     filters by it explicitly so the bypass stays contained.
 *
 * Implementation siblings:
 *   - `repository-bases.ts`   — base reads + writes + hard delete
 *   - `repository-folders.ts` — folder reads + ancestor walk + writes + delete
 *   - `repository-entries.ts` — entry reads (incl. path helpers) + writes + delete
 *   - `repository-stars.ts`   — PER-USER base stars, every statement by user_id
 */

export {
  findBaseById,
  listBasesByIds,
  findBaseBySlug,
  findBaseByPublicId,
  listBasesForWorkspace,
  listBaseSlugsForWorkspace,
  listHomeScopedBaseIds,
  insertBase,
  insertBases,
  updateBaseRow,
  hardDeleteBase,
  listBaseStorageBytes,
  getBaseStorageBytes,
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
  listEntryStampsForBases,
  listEntriesByIds,
  insertEntry,
  insertEntries,
  updateEntryRow,
  hardDeleteEntry,
} from "./repository-entries";
export type {
  EntryStamp,
  ListEntriesOpts,
  InsertEntryArgs,
  InsertEntriesArgs,
  UpdateEntryPatch,
} from "./repository-entries";

export {
  listStarredBaseIds,
  insertBaseStar,
  deleteBaseStar,
} from "./repository-stars";
