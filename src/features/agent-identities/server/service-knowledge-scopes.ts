import "server-only";
import { DESCRIPTION_MAX } from "@/config";
import type {
  AgentIdentityContext,
  IdentityKnowledgeFolderBrief,
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
} from "../types";
import { composeDisplayPath, refKey, scopeKey } from "../lib/knowledge-scopes";
import { IdentityKnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import {
  resolveVisibleKnowledgeBases,
  type VisibleKnowledgeBase,
} from "./service-shared";

/**
 * SCOPE RESOLUTION — a set of `{baseId, scope, folderId?, entryId?}` in, a set
 * of viewer-filtered {@link IdentityKnowledgeRef} out (2026-09-08).
 *
 * ⚠ **ONE PREDICATE, TWO CONSUMERS**, exactly as `service-shared.ts ›
 * resolveVisibleKnowledgeBases` is for whole bases: the ATTACH GATE, where a
 * dropped scope is a 404, and the READ PATH, where it is simply omitted. An
 * attach that permitted what a read would hide is how an identity becomes a
 * laundering channel, and one function is what makes that impossible rather than
 * merely unlikely.
 *
 * ⚠ **ITS OWN FILE.** `service-shared.ts` is at 343 lines and this is ~150 of
 * decoration and path arithmetic; the seam is the one this feature has already
 * cut twice (`repository-knowledge-links.ts`, `service-knowledge-decoration.ts`)
 * — that file owns WHO MAY SEE A BASE, this one owns WHAT A SUB-BASE POINTER
 * RESOLVES TO. The arrow points one way: this imports from it, never back.
 *
 * ⚠ **THE BASE PREDICATE IS THE CEILING AND IT IS NOT RE-DERIVED HERE.** A
 * folder is reachable exactly when its BASE is; there is no per-folder grant in
 * this product and inventing one here would be a second visibility opinion.
 * What this adds is TENANCY and LIVENESS — the folder must live in the base the
 * scope names, and must not be in the trash.
 *
 * 🔒 ⚠ **AND IT IS NOT THE READ CEILING.** `knowledge/server/service-audience.ts
 * › resolveAgentAudience` decides what a SESSION's knowledge tools may open and
 * it is BASE-KEYED. An agent granted one folder can still `get_tree` the whole
 * base. That gap is filed in `docs/REFACTOR-FINDINGS.md` and is deliberately not
 * closed here; nothing in this file may be read as enforcing it.
 */

/**
 * ── THE BASE CARD'S TWO BOUNDS (2026-09-18, A4) ────────────────────────────
 *
 * 🔒 ⚠ **BOTH ARE ALL-OR-NOTHING, NEVER A SLICE.** The desktop renders the card
 * at a hard 400 characters per base and degrades by dropping WHOLE FACTS, so a
 * fact arriving already cut in half would defeat the one rule that makes the
 * card trustworthy: half a clause read as the whole clause is wrong in a way
 * the agent cannot detect, where a missing clause is merely missing.
 */
const CARD_SUMMARY_MAX = DESCRIPTION_MAX;

/**
 * ⚠ **AND THE CAP IS SAFE ONLY BECAUSE `baseFolderCount` TRAVELS BESIDE IT.**
 * Fifty short folder names fit inside 400 characters, so a silent truncation
 * here would render as a COMPLETE list of a base that has more; the renderer
 * compares the two and drops the line whenever they disagree.
 */
const MAX_CARD_FOLDERS = 50;

/** Query count: at most THREE beyond the base resolution, and flat in the number
 *  of scopes — bases, then every live folder of the bases involved, then the
 *  named entries.
 *
 *  ⚠ **THE FOLDER READ NOW ALSO SERVES WHOLE-BASE SCOPES (2026-09-18, A4)**, so
 *  an identity attaching only whole bases pays ONE query it did not pay before —
 *  and an identity with any sub-base scope pays exactly what it already did, the
 *  base ids being unioned into the one call. That query is the card's whole
 *  cost: `slug` and `description` ride the access row, and the READ-THIS-FIRST
 *  index pointer was DROPPED rather than bought with a second one. */
export async function resolveVisibleKnowledgeScopes(
  ctx: AgentIdentityContext,
  scopes: ReadonlyArray<IdentityKnowledgeScope>
): Promise<IdentityKnowledgeRef[]> {
  if (scopes.length === 0) return [];
  const baseIds = [...new Set(scopes.map((s) => s.baseId))];
  const visibleBases = await resolveVisibleKnowledgeBases(ctx, baseIds);
  if (visibleBases.length === 0) return [];
  // ⚠ **A SET FOR THE PREDICATE, A MAP FOR THE LABEL, AND THEY ARE NOT THE SAME
  // QUESTION.** Reading visibility off `map.get(id) === undefined` conflates "you
  // may not see this base" with "this base has no name" — and the second is a
  // display defect, never a reason to drop an attachment the operator made.
  const visibleBaseIds = new Set(visibleBases.map((b) => b.id));
  const baseById = new Map(visibleBases.map((b) => [b.id, b]));

  // ⚠ ONLY THE BASES THAT SURVIVED. Reading folders of a base the caller cannot
  // see would be a probe whose result we would then have to remember to discard.
  const visibleScopes = scopes.filter((s) => visibleBaseIds.has(s.baseId));
  const entryIds = visibleScopes
    .filter((s): s is Extract<IdentityKnowledgeScope, { scope: "entry" }> =>
      s.scope === "entry"
    )
    .map((s) => s.entryId);
  // ⚠ **ONE FOLDER READ, TWO JOBS.** A sub-base scope needs the ancestor chain
  // its path is walked from; a whole-base scope needs that base's TOP-LEVEL
  // folders for its card. Both are "every live folder of these bases", so the
  // base ids are unioned into the call that already existed rather than a
  // second one being added beside it.
  const folderBaseIds = [
    ...new Set(visibleScopes.map((s) => s.baseId)),
  ];
  const [folders, entries] = await Promise.all([
    folderBaseIds.length > 0
      ? repo.listLiveFoldersForBases(ctx.workspaceId, folderBaseIds)
      : Promise.resolve([]),
    entryIds.length > 0
      ? repo.listLiveEntryRows(ctx.workspaceId, entryIds)
      : Promise.resolve([]),
  ]);
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const rootFolders = rootFoldersByBase(folders);

  const out: IdentityKnowledgeRef[] = [];
  for (const scope of scopes) {
    if (!visibleBaseIds.has(scope.baseId)) continue;
    const baseRow = baseById.get(scope.baseId);
    const base = baseRow?.name ?? "";
    if (scope.scope === "base") {
      out.push({
        baseId: scope.baseId,
        baseName: base,
        scope: "base",
        path: base,
        // ⚠ THE CARD IS BASE-SCOPE ONLY. A folder or entry scope already names
        // the exact thing it points at; a card over it would be noise on top of
        // an answer, and noise is how the useful line stops being read.
        ...baseCard(baseRow, rootFolders.get(scope.baseId) ?? []),
      });
      continue;
    }
    if (scope.scope === "folder") {
      const folder = folderById.get(scope.folderId);
      // ⚠ THE TENANCY TEST IS HERE AND NOT ONLY IN THE TRIGGER. A folder of
      // ANOTHER base reaching this loop would render a path naming one base and
      // a tool call naming another — the trigger refuses the write, this refuses
      // the read of a row written before it existed.
      if (!folder || folder.knowledgeBaseId !== scope.baseId) continue;
      const segments = folderSegments(folder.id, folderById);
      out.push({
        baseId: scope.baseId,
        baseName: base,
        scope: "folder",
        folderId: folder.id,
        folderName: folder.name,
        path: composeDisplayPath(base, segments),
        toolPath: segments.join("/"),
      });
      continue;
    }
    const entry = entryById.get(scope.entryId);
    if (!entry || entry.knowledgeBaseId !== scope.baseId) continue;
    const segments = [
      ...(entry.folderId ? folderSegments(entry.folderId, folderById) : []),
      entry.title,
    ];
    out.push({
      baseId: scope.baseId,
      baseName: base,
      scope: "entry",
      entryId: entry.id,
      entryTitle: entry.title,
      path: composeDisplayPath(base, segments),
      toolPath: segments.join("/"),
    });
  }
  return out;
}

/**
 * The TOP-LEVEL folders of each base, in read order, keyed by base.
 *
 * ⚠ **`parentId === null` IS THE WHOLE TEST, AND IT IS NOT A DEPTH BUDGET.** A
 * card names where to start looking; the subtree under a folder is what
 * `get_tree` and `list_dir` are for. Recursing here is how a fixed-size fact
 * becomes a function of how big the base got — the exact thing the ≤400-char
 * rule exists to forbid.
 */
function rootFoldersByBase(
  folders: repo.KnowledgeFolderRow[]
): Map<string, repo.KnowledgeFolderRow[]> {
  const byBase = new Map<string, repo.KnowledgeFolderRow[]>();
  for (const folder of folders) {
    if (folder.parentId !== null) continue;
    const list = byBase.get(folder.knowledgeBaseId);
    if (list) list.push(folder);
    else byBase.set(folder.knowledgeBaseId, [folder]);
  }
  return byBase;
}

/**
 * The four CARD facts for one whole-base attachment (2026-09-18, A4) — name,
 * slug, what the base answers, and its top-level folders with a clause each.
 *
 * 🔒 ⚠ **NO ENTRY REACHES THIS FUNCTION, AT ANY DEPTH, AND THAT IS STRUCTURAL
 * RATHER THAN A RULE SOMEONE REMEMBERS.** It is handed base row + folder rows
 * and nothing else, so "a base with forty entries renders a card listing zero
 * of them" is not a behaviour to test for so much as a shape that cannot
 * express the alternative.
 *
 * ⚠ **A SUMMARY LONGER THAN A CARD IS NOT A SUMMARY.** `description` is bounded
 * at 2000 by its own editor and a card spends 400 on EVERYTHING, so carrying
 * the long ones would guarantee the renderer dropped them — and slicing one
 * here would put a half-sentence on the wire that reads like a whole one.
 * Omitted whole, at {@link CARD_SUMMARY_MAX}, on both this key and each folder
 * clause.
 *
 * ⚠ `baseFolders` / `baseFolderCount` ARE EMITTED EVEN WHEN THE BASE HAS NO
 * FOLDERS — a DECIDED ZERO, the same argument `service-knowledge-decoration.ts`
 * makes for its own: a base that was read and has none must not be
 * indistinguishable from a base nobody read.
 */
function baseCard(
  base: VisibleKnowledgeBase | undefined,
  roots: repo.KnowledgeFolderRow[]
): Partial<IdentityKnowledgeRef> {
  if (!base) return {};
  const summary = base.description ?? "";
  const folders: IdentityKnowledgeFolderBrief[] = roots
    .slice(0, MAX_CARD_FOLDERS)
    .map((folder) => {
      const clause = folder.description ?? "";
      return clause && clause.length <= CARD_SUMMARY_MAX
        ? { name: folder.name, summary: clause }
        : { name: folder.name };
    });
  return {
    ...(base.slug ? { baseSlug: base.slug } : {}),
    ...(summary && summary.length <= CARD_SUMMARY_MAX
      ? { baseSummary: summary }
      : {}),
    baseFolders: folders,
    // ⚠ THE TRUE TOTAL, NOT `folders.length`. They differ exactly when the cap
    // bit, and that difference is the only thing standing between a capped list
    // and a confident wrong claim about the base's shape.
    baseFolderCount: roots.length,
  };
}

/**
 * The id a REFUSAL names, per shape. ⚠ It is the id the CALLER PASSED, never a
 * neighbouring one: `IdentityKnowledgeBaseNotFoundError` is 404-shaped precisely
 * so "you may not attach this" and "no such thing" are indistinguishable, and
 * echoing back anything the caller did not already hold would undo that.
 */
function knowledgeScopeSubjectId(scope: IdentityKnowledgeScope): string {
  if (scope.scope === "folder") return scope.folderId;
  if (scope.scope === "entry") return scope.entryId;
  return scope.baseId;
}

/**
 * The folder chain, root-first. ⚠ CYCLE-GUARDED with a visited set: `parent_id`
 * is not constrained to be acyclic and a loop here would hang a request rather
 * than render a wrong name. A truncated chain is the fail-safe answer.
 */
function folderSegments(
  folderId: string,
  byId: Map<string, repo.KnowledgeFolderRow>
): string[] {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder: repo.KnowledgeFolderRow | undefined = byId.get(current);
    if (!folder) break;
    segments.unshift(folder.name);
    current = folder.parentId;
  }
  return segments;
}

// ─── The attach gate ────────────────────────────────────────────────────
//
// ⚠ **IT LIVES BESIDE THE RESOLVER, NOT IN `service-writes.ts`** (2026-09-08).
// That file reached the 500-line cap when the scoped write landed in it, and the
// house move at the cap is to lift a MARKED SECTION rather than shave a comment
// — the move `repository-knowledge-links.ts` and `service-knowledge-decoration.ts`
// each already made on this same seam. The gate is the RESOLVER's second
// consumer, so this is where it was always going to end up.

/**
 * ⚠ NO ATTACHING KNOWLEDGE YOU CANNOT READ. Every requested scope is resolved
 * through `resolveVisibleKnowledgeScopes` — the same predicate the READ path
 * uses — and anything that does not come back is reported MISSING (a 404, never
 * a distinguishable 403: see `IdentityKnowledgeBaseNotFoundError`).
 *
 * Without this, an identity is a laundering channel: attach a teammate's private
 * base by id, share the identity to `workspace`, and every member's spawned
 * agent gets a pointer to it.
 *
 * ⚠ **SINCE 2026-09-08 IT ALSO PROVES TENANCY AND LIVENESS ONE LEVEL DEEPER.** A
 * folder or an entry must live in the base its scope names and must not be in
 * the trash — both checked by the resolver, both refused with the SAME 404 as an
 * unreadable base. Three refusals with three shapes would be an oracle: "that
 * folder exists but is in another base" is a fact about somebody else's base.
 * The DB trigger restates the tenancy half as a backstop; this is the fence.
 */
export async function assertAttachableKnowledgeScopes(
  ctx: AgentIdentityContext,
  requested: ReadonlyArray<IdentityKnowledgeScope>
): Promise<IdentityKnowledgeScope[]> {
  const unique: IdentityKnowledgeScope[] = [];
  const keys = new Set<string>();
  for (const scope of requested) {
    const key = scopeKey(scope);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(scope);
  }
  if (unique.length === 0) return [];
  const visible = await resolveVisibleKnowledgeScopes(ctx, unique);
  const seen = new Set(visible.map(refKey));
  const missing = unique.filter((s) => !seen.has(scopeKey(s)));
  if (missing.length > 0) {
    throw new IdentityKnowledgeBaseNotFoundError(
      missing.map(knowledgeScopeSubjectId)
    );
  }
  return unique;
}

/**
 * THE ONE PLACE THE TWO WIRE SPELLINGS MEET (2026-09-08).
 *
 * `knowledgeBaseIds` (older clients, and the MCP `knowledge_bases` argument)
 * means WHOLE BASES; `knowledge` carries the scope. The schema refuses both in
 * one request (`schema.ts › knowledgeFieldsExclusive`), so this is a choice
 * between two spellings and never a merge — and `null` here means the request
 * named NEITHER, which on the update path is what leaves the junction alone.
 */
export function requestedKnowledgeScopes(input: {
  knowledgeBaseIds?: string[];
  knowledge?: IdentityKnowledgeScope[];
}): IdentityKnowledgeScope[] | null {
  if (input.knowledge !== undefined) return input.knowledge;
  if (input.knowledgeBaseIds !== undefined) {
    return input.knowledgeBaseIds.map((baseId) => ({
      baseId,
      scope: "base" as const,
    }));
  }
  return null;
}
