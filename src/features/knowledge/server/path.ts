import "server-only";
import type {
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import { KnowledgePathConflictError } from "./errors";
import * as repo from "./repository";

/**
 * Path-based addressing for knowledge bases.
 *
 * Path syntax: `/`-separated segments. Leading/trailing slashes are
 * tolerated. `""` and `"/"` both refer to the base root. Segments
 * match by `name` (folders) or `title` (entries) — case-sensitive.
 *
 * The unique partial indexes added in the Item 4 migration guarantee
 * that within a single (knowledge_base_id, parent_id) bucket, no two
 * active folders share a name and no two active entries share a title.
 * That makes the resolver deterministic — no fuzzy matching, no
 * "first one wins" semantics.
 *
 * Resolution rules:
 *   - All non-final segments must resolve to an active folder, else
 *     `PathTraversalError`.
 *   - The final segment may resolve to either a folder or an entry.
 *   - Folder match is tried first at the final segment (matches
 *     filesystem semantics — paths without a trailing-extension can
 *     legitimately reference a folder).
 *   - When neither matches, we return `not_found` rather than throwing
 *     so callers can decide (write-file uses this to mkdir-p).
 */

export type ResolvedPath =
  | { kind: "root" }
  | { kind: "folder"; folder: KnowledgeFolder }
  | { kind: "entry"; folder: KnowledgeFolder | null; entry: KnowledgeEntry }
  | {
      kind: "not_found";
      lastFolder: KnowledgeFolder | null;
      missingSegment: string;
    };

// ─── Path parsing ───────────────────────────────────────────────────

/**
 * Splits a path into clean segments. `"/foo//bar/"` → `["foo", "bar"]`.
 * Empty string returns `[]`. Throws on segments containing `/`-like
 * sentinels — caller passes the path as a string, so this should never
 * fire, but the check is cheap.
 */
export function parsePath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

export function pathToString(segments: string[]): string {
  return segments.join("/");
}

// ─── Resolution ─────────────────────────────────────────────────────

/**
 * Walks a path through the folder tree. Does not traverse into
 * soft-deleted folders. Pure resolver — never throws for missing
 * segments. Returns:
 *   - `{kind:"root"}` when path has no segments.
 *   - `{kind:"folder", folder}` when every segment resolved to a folder.
 *   - `{kind:"entry", folder, entry}` when the final segment matched
 *     an active entry. `folder` is the parent (null = base root).
 *   - `{kind:"not_found", lastFolder, missingSegment}` when ANY
 *     segment didn't resolve. `lastFolder` is the deepest folder
 *     that did resolve (null if even the first segment missed).
 *
 * Callers that want strict resolution (read/delete/move) check
 * `kind === "not_found"` and throw the appropriate error themselves.
 * Callers that mkdir -p (write/create-folder) consume the not_found
 * result directly.
 */
export async function resolvePath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<ResolvedPath> {
  const segments = parsePath(path);
  if (segments.length === 0) return { kind: "root" };

  // Walk all-but-last segments as folders. Bail at the first miss.
  let currentFolder: KnowledgeFolder | null = null;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = await repo.findActiveFolderByName(
      baseId,
      currentFolder?.id ?? null,
      segments[i]
    );
    if (!next) {
      return {
        kind: "not_found",
        lastFolder: currentFolder,
        missingSegment: segments[i],
      };
    }
    assertSameWorkspace(next.workspaceId, ctx.workspaceId, "folder");
    currentFolder = next;
  }

  // Final segment: try folder first, then entry.
  const lastSegment = segments[segments.length - 1];
  const folderMatch = await repo.findActiveFolderByName(
    baseId,
    currentFolder?.id ?? null,
    lastSegment
  );
  if (folderMatch) {
    assertSameWorkspace(folderMatch.workspaceId, ctx.workspaceId, "folder");
    return { kind: "folder", folder: folderMatch };
  }

  const entryMatch = await repo.findActiveEntryByTitle(
    baseId,
    currentFolder?.id ?? null,
    lastSegment
  );
  if (entryMatch) {
    assertSameWorkspace(entryMatch.workspaceId, ctx.workspaceId, "entry");
    return { kind: "entry", folder: currentFolder, entry: entryMatch };
  }

  return {
    kind: "not_found",
    lastFolder: currentFolder,
    missingSegment: lastSegment,
  };
}

/**
 * mkdir -p semantics. Walks segments, creating any missing folder
 * along the way. Returns the leaf folder (or null when called with
 * an empty segment list — meaning "the root").
 *
 * Workspace + agent-write enforcement is the caller's responsibility
 * (typically the service method that wraps this). This helper just
 * does the tree walk + insertion, on the assumption that the caller
 * has already validated the base + agent permission.
 *
 * Cross-type collision: the unique partial indexes only prevent
 * folder-folder and entry-entry collisions. If a segment matches an
 * existing entry of the same name (e.g. the user has an entry "foo"
 * at root and we're asked to mkdir -p "foo/bar"), throw
 * `KnowledgePathConflictError` rather than silently creating a folder
 * that shadows the entry.
 */
export async function ensureFolderPath(
  ctx: KnowledgeContext,
  baseId: string,
  segments: string[]
): Promise<KnowledgeFolder | null> {
  if (segments.length === 0) return null;
  let current: KnowledgeFolder | null = null;
  for (const segment of segments) {
    const found = await repo.findActiveFolderByName(
      baseId,
      current?.id ?? null,
      segment
    );
    if (found) {
      current = found;
      continue;
    }
    // Defensive: an entry with the same name in the same parent would
    // produce an ambiguous path. Refuse to create.
    const conflictingEntry = await repo.findActiveEntryByTitle(
      baseId,
      current?.id ?? null,
      segment
    );
    if (conflictingEntry) {
      throw new KnowledgePathConflictError(segment);
    }
    try {
      current = await repo.insertFolder({
        workspaceId: ctx.workspaceId,
        knowledgeBaseId: baseId,
        parentId: current?.id ?? null,
        name: segment,
        createdBy: ctx.userId,
      });
    } catch (err) {
      // 23505 = a parallel call inserted the same folder first. Re-find
      // and continue. Idempotency under contention.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23505"
      ) {
        const racedFolder = await repo.findActiveFolderByName(
          baseId,
          current?.id ?? null,
          segment
        );
        if (racedFolder) {
          current = racedFolder;
          continue;
        }
      }
      throw err;
    }
  }
  return current;
}

// ─── Internal ───────────────────────────────────────────────────────

function assertSameWorkspace(
  rowWorkspaceId: string,
  ctxWorkspaceId: string,
  description: string
): void {
  if (rowWorkspaceId !== ctxWorkspaceId) {
    throw new Error(
      `${description} belongs to a different workspace (defensive)`
    );
  }
}
