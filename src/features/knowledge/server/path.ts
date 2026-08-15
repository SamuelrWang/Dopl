import "server-only";
import type {
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import { KnowledgePathConflictError } from "./errors";
import * as repo from "./repository";

/**
 * Path addressing. `/`-separated, leading/trailing slashes tolerated, `""` and
 * `"/"` = base root. Segments match folder `name` or entry `title`,
 * CASE-SENSITIVE.
 *
 * Unique partial indexes make the resolver deterministic — within one
 * (knowledge_base_id, parent_id) bucket no two active folders share a name and
 * no two active entries share a title. No fuzzy matching, no "first one wins".
 *
 * Rules: non-final segments must resolve to an active folder else
 * `PathTraversalError`; the final segment may be folder or entry, folder tried
 * FIRST (extensionless paths can legitimately name a folder); neither match ⇒
 * `not_found` returned, not thrown, so write-file can mkdir -p on it.
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
 * `"/foo//bar/"` → `["foo", "bar"]`; `""` → `[]`. `.` and `..` DROPPED — flat
 * name tree, not a filesystem — so `"../escape"` → `["escape"]` rather than a
 * folder literally named `..`.
 */
export function parsePath(path: string): string[] {
  return path
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..");
}

export function pathToString(segments: string[]): string {
  return segments.join("/");
}

// ─── Resolution ─────────────────────────────────────────────────────

/**
 * Walks a path through the folder tree, skipping soft-deleted folders. Pure —
 * NEVER throws on missing segments; strict callers (read/delete/move) check
 * `kind === "not_found"` themselves, mkdir -p callers consume it directly.
 * `not_found.lastFolder` = deepest folder that DID resolve; `entry.folder` =
 * parent (null = base root).
 */
export async function resolvePath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<ResolvedPath> {
  const segments = parsePath(path);
  if (segments.length === 0) return { kind: "root" };

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

  // Final segment: folder first, then entry.
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

  // Slug fallback for the write-with-title-then-read-with-sluggy-path footgun
  // (write `title: "LinkedIn Job Alerts"`, read `path:
  // "linkedin-job-alerts.md"`). ⚠ Refuses to guess on slug collisions —
  // titles in a bucket are unique but can collide after slugification ("Foo
  // Bar" vs "Foo-Bar"); exact-title lookup stays the deterministic answer.
  const querySlug = slugForPathSegment(lastSegment);
  if (querySlug) {
    const candidates = await repo.listActiveEntryTitlesIn(
      baseId,
      currentFolder?.id ?? null
    );
    const matches = candidates.filter(
      (c) => slugForPathSegment(c.title) === querySlug
    );
    if (matches.length === 1) {
      const hydrated = await repo.findActiveEntryById(matches[0].id);
      if (hydrated) {
        assertSameWorkspace(hydrated.workspaceId, ctx.workspaceId, "entry");
        return { kind: "entry", folder: currentFolder, entry: hydrated };
      }
    }
  }

  return {
    kind: "not_found",
    lastFolder: currentFolder,
    missingSegment: lastSegment,
  };
}

/**
 * ⚠ Must mirror `slugify` normalization (NFKC + lowercase + non-alphanumeric
 * runs → '-'), PLUS strips a trailing extension (`.md`, `.txt`, ...) so
 * `linkedin-jobs.md` resolves to an entry titled `LinkedIn Jobs`. Returns ""
 * when the slug is empty = "no fallback possible".
 */
function slugForPathSegment(segment: string): string {
  const stripped = segment.replace(/\.(md|markdown|txt)$/i, "");
  return stripped
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * mkdir -p. Returns leaf folder, null for an empty segment list (= root).
 * ⚠ Does NOT enforce workspace or agent-write — caller must validate base +
 * agent permission first.
 * ⚠ Unique partial indexes only cover folder-folder and entry-entry, so a
 * segment matching an existing ENTRY of the same name (entry "foo" at root,
 * mkdir -p "foo/bar") throws `KnowledgePathConflictError` rather than creating
 * a folder that shadows it.
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
    // Same-name entry in same parent ⇒ ambiguous path. Refuse to create.
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
      // 23505 = parallel call inserted this folder first. Re-find, continue —
      // idempotency under contention.
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
