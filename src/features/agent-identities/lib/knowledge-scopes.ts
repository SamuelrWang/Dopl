import type {
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
} from "../client/types";

/**
 * THE CLIENT HALF OF A KNOWLEDGE SCOPE — the §8 fallback, the identity, the
 * chip label, and the draft ⇄ wire conversion (2026-09-08).
 *
 * ⚠ PURE — no React, no transport, no zod. The picker, the draft and the
 * optimistic patch all ask the same questions about a scope, and three answers
 * to "are these the same attachment" is how a chip removes the wrong row.
 */

/**
 * 🔒 **THE §8 STALE-CACHE FALLBACK, AND IT IS SPELLED INLINE AT EVERY READ.**
 * `AgentIdentity.knowledge` is a field ADDED to an already-persisted payload;
 * an entry written by the previous bundle survives the upgrade with a 24h
 * `gcTime` and has no such key. Frozen so a caller cannot mutate the shared
 * empty and hand every other reader a populated "nothing".
 *
 * ⚠ **DO NOT WRAP THIS IN AN ACCESSOR.** INVARIANTS §8 is explicit: the wire
 * type is what makes the optionality invisible, and a helper nobody has to call
 * is a rule the next read forgets. `?? EMPTY_KNOWLEDGE` belongs in the
 * reviewer's line of sight.
 */
export const EMPTY_KNOWLEDGE: readonly IdentityKnowledgeRef[] = Object.freeze([]);

/**
 * The identity of one attachment — THE SHAPE PLUS THE ID THAT SHAPE NAMES,
 * deliberately the same vocabulary the server computes
 * (`server/repository-knowledge-links.ts › knowledgeScopeKey`).
 *
 * ⚠ **THE BASE ID ALONE WILL NOT DO**, which is the whole reason this exists: a
 * whole-base scope and a folder scope of that base share it, so keying on it
 * would make removing one chip remove the other.
 */
export function scopeKey(
  scope: Pick<IdentityKnowledgeRef, "scope" | "baseId" | "folderId" | "entryId">
): string {
  if (scope.scope === "folder") return `folder:${scope.folderId}`;
  if (scope.scope === "entry") return `entry:${scope.entryId}`;
  return `base:${scope.baseId}`;
}

/** The same identity over a RESOLVED ref. */
export const refKey: (ref: IdentityKnowledgeRef) => string = scopeKey;

/** A resolved ref, back to the scope that would re-request it. ⚠ The draft holds
 *  SCOPES, not refs: names and paths are the server's answer and re-sending them
 *  would be the client claiming a fact it read. */
export function refToScope(ref: IdentityKnowledgeRef): IdentityKnowledgeScope {
  if (ref.scope === "folder" && ref.folderId) {
    return { baseId: ref.baseId, scope: "folder", folderId: ref.folderId };
  }
  if (ref.scope === "entry" && ref.entryId) {
    return { baseId: ref.baseId, scope: "entry", entryId: ref.entryId };
  }
  return { baseId: ref.baseId, scope: "base" };
}

/** Order-insensitive set comparison — the pick order of a picker is not a fact,
 *  which is the argument `identity-draft.ts › sameIds` already makes for ids. */
export function sameScopes(
  a: ReadonlyArray<IdentityKnowledgeScope>,
  b: ReadonlyArray<IdentityKnowledgeScope>
): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(b.map(scopeKey));
  return a.every((s) => keys.has(scopeKey(s)));
}

/**
 * THE CHIP LABEL — `Base`, `Base / Folder`, `Base / Folder / Entry`.
 *
 * ⚠ **THE SERVER'S `path` WINS, AND THE FALLBACK IS THE BASE NAME.** The picker
 * mints an optimistic path from the tree it has loaded (`composeDisplayPath`);
 * the next read replaces it with the server's, so a folder renamed in another
 * window corrects itself rather than persisting in a chip forever. An empty
 * `path` means neither answered, and the base name is true of every scope.
 */
export function scopeChipLabel(ref: IdentityKnowledgeRef): string {
  return ref.path || ref.baseName;
}

/**
 * The DISPLAY path a picker composes for a scope it just checked — the same
 * `" / "`-joined, base-name-leading shape the server derives
 * (`server/service-knowledge-scopes.ts › displayPath`).
 *
 * ⚠ **IT IS NOT A KNOWLEDGE PATH.** The tool path is `/`-joined and does NOT
 * lead with the base name; `IdentityKnowledgeRef.toolPath` is that one, and the
 * two are never interchangeable — a base called "Ops / Legal" makes splitting
 * one back into the other silently wrong.
 */
export function composeDisplayPath(
  baseName: string,
  segments: ReadonlyArray<string>
): string {
  return [baseName, ...segments].join(" / ");
}
