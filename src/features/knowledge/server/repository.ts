import "server-only";

/**
 * Raw Supabase I/O for knowledge — a BARREL. No business logic, no auth checks,
 * no error translation; those live in the service.
 *
 * Convention: `find*` → `T | null`; `list*` → `T[]`; `insert*` / `update*` /
 * `hardDelete*` throw on error.
 * - `includeDeleted` is inert: deletes are permanent, no tombstones remain and
 *     no call site passes `true`. ⚠ **F-730** removes it with the columns
 *     (partial-unique indexes make that non-mechanical).
 * - The service-role client BYPASSES RLS, so every method taking
 *     `workspaceId` filters by it explicitly.
 *
 * Implementation siblings:
 *   - `repository-bases.ts`   — base reads + writes + hard delete
 *   - `repository-folders.ts` — folder reads + ancestor walk + writes + delete
 *   - `repository-entries.ts` — entry reads (incl. path helpers) + writes + delete
 *   - `repository-stars.ts`   — PER-USER base stars, every statement by user_id
 */

export {
  findBaseById,
  findBaseByClientWriteId,
  listBasesByIds,
  findBaseBySlug,
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

export {
  findFolderById,
  listFoldersForBase,
  findActiveFolderByName,
  listFolderAncestors,
  insertFolder,
  updateFolderRow,
  hardDeleteFolder,
} from "./repository-folders";

export {
  findEntryById,
  findEntryByClientWriteId,
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
export type { InsertEntriesArgs } from "./repository-entries";

export {
  listStarredBaseIds,
  insertBaseStar,
  deleteBaseStar,
} from "./repository-stars";
