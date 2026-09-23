import type {
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
} from "../client/types";

/** The client half of a knowledge scope — pure (no React, transport or zod), shared by server and UI. */

/**
 * The §8 stale-cache fallback: `knowledge` was added to an IndexedDB-persisted payload, so every
 * read spells `?? EMPTY_KNOWLEDGE` inline — never behind an accessor. Frozen so nobody mutates it.
 */
export const EMPTY_KNOWLEDGE: readonly IdentityKnowledgeRef[] = Object.freeze([]);

/**
 * One attachment's identity: the shape plus the id that shape names — never the base id alone (a
 * base scope and a folder scope of it share that). The server dedupes on the same key.
 */
export function scopeKey(
  scope: Pick<IdentityKnowledgeRef, "scope" | "baseId" | "folderId" | "entryId">
): string {
  if (scope.scope === "folder") return `folder:${scope.folderId}`;
  if (scope.scope === "entry") return `entry:${scope.entryId}`;
  return `base:${scope.baseId}`;
}

/** The same identity over a resolved ref. */
export const refKey: (ref: IdentityKnowledgeRef) => string = scopeKey;

/** A resolved ref back to the scope that re-requests it (names and paths are the server's answer). */
export function refToScope(ref: IdentityKnowledgeRef): IdentityKnowledgeScope {
  if (ref.scope === "folder" && ref.folderId) {
    return { baseId: ref.baseId, scope: "folder", folderId: ref.folderId };
  }
  if (ref.scope === "entry" && ref.entryId) {
    return { baseId: ref.baseId, scope: "entry", entryId: ref.entryId };
  }
  return { baseId: ref.baseId, scope: "base" };
}

/** Order-insensitive set comparison. */
export function sameScopes(
  a: ReadonlyArray<IdentityKnowledgeScope>,
  b: ReadonlyArray<IdentityKnowledgeScope>
): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(b.map(scopeKey));
  return a.every((s) => keys.has(scopeKey(s)));
}

/** The chip label: the server's `path` wins (so renames correct themselves), else the base name. */
export function scopeChipLabel(ref: IdentityKnowledgeRef): string {
  return ref.path || ref.baseName;
}

/**
 * The display path (`Base / Folder / Entry`, " / "-joined, base-led). Never a knowledge tool path —
 * that is `IdentityKnowledgeRef.toolPath` (base-relative, "/"-joined); the two are not interchangeable.
 */
export function composeDisplayPath(
  baseName: string,
  segments: ReadonlyArray<string>
): string {
  return [baseName, ...segments].join(" / ");
}
