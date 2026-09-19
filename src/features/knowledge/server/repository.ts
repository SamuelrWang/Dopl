import "server-only";

/**
 * Raw Supabase I/O for knowledge — a BARREL. No business logic, no auth checks,
 * no error translation; those live in the service.
 *
 * Convention: `find*` → `T | null`; `list*` → `T[]`; `insert*` / `update*` /
 * `hardDelete*` throw on error.
 * - `includeDeleted` is a legacy-tombstone escape hatch, not a trash surface
 *     — deletes are permanent. Default `false` keeps the `deleted_at IS NULL`
 *     filter hiding pre-switch rows. ⚠ **THERE ARE NO SUCH ROWS LEFT** (the
 *     purge migration ran; counts read 0 on 2026-09-18) and **NO CALL SITE
 *     PASSES `true`** — re-derive with `grep -rn includeDeleted src`. The
 *     parameter and the filters are inert; **F-730** carries removing them and
 *     the columns together, which the partial-unique indexes make non-mechanical.
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
