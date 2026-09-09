import "server-only";
import type {
  AgentTemplateContext,
  TemplateKnowledgeRef,
  TemplateKnowledgeScope,
} from "../types";
import { refKey, scopeKey } from "../lib/knowledge-scopes";
import { TemplateKnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import { resolveVisibleKnowledgeBases } from "./service-shared";

/**
 * SCOPE RESOLUTION — a set of `{baseId, scope, folderId?, entryId?}` in, a set
 * of viewer-filtered {@link TemplateKnowledgeRef} out (2026-09-08).
 *
 * ⚠ **ONE PREDICATE, TWO CONSUMERS**, exactly as `service-shared.ts ›
 * resolveVisibleKnowledgeBases` is for whole bases: the ATTACH GATE, where a
 * dropped scope is a 404, and the READ PATH, where it is simply omitted. An
 * attach that permitted what a read would hide is how a template becomes a
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

/** Query count: at most THREE beyond the base resolution, and flat in the number
 *  of scopes — bases, then every live folder of the bases involved, then the
 *  named entries. */
export async function resolveVisibleKnowledgeScopes(
  ctx: AgentTemplateContext,
  scopes: ReadonlyArray<TemplateKnowledgeScope>
): Promise<TemplateKnowledgeRef[]> {
  if (scopes.length === 0) return [];
  const baseIds = [...new Set(scopes.map((s) => s.baseId))];
  const visibleBases = await resolveVisibleKnowledgeBases(ctx, baseIds);
  if (visibleBases.length === 0) return [];
  // ⚠ **A SET FOR THE PREDICATE, A MAP FOR THE LABEL, AND THEY ARE NOT THE SAME
  // QUESTION.** Reading visibility off `map.get(id) === undefined` conflates "you
  // may not see this base" with "this base has no name" — and the second is a
  // display defect, never a reason to drop an attachment the operator made.
  const visibleBaseIds = new Set(visibleBases.map((b) => b.id));
  const baseName = new Map(visibleBases.map((b) => [b.id, b.name ?? ""]));

  // ⚠ ONLY THE BASES THAT SURVIVED. Reading folders of a base the caller cannot
  // see would be a probe whose result we would then have to remember to discard.
  const subBaseScopes = scopes.filter(
    (s) => s.scope !== "base" && visibleBaseIds.has(s.baseId)
  );
  const needsTree = subBaseScopes.length > 0;
  const [folders, entries] = await Promise.all([
    needsTree
      ? repo.listLiveFoldersForBases(
          ctx.workspaceId,
          [...new Set(subBaseScopes.map((s) => s.baseId))]
        )
      : Promise.resolve([]),
    needsTree
      ? repo.listLiveEntryRows(
          ctx.workspaceId,
          subBaseScopes
            .filter((s): s is Extract<TemplateKnowledgeScope, { scope: "entry" }> =>
              s.scope === "entry"
            )
            .map((s) => s.entryId)
        )
      : Promise.resolve([]),
  ]);
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const out: TemplateKnowledgeRef[] = [];
  for (const scope of scopes) {
    if (!visibleBaseIds.has(scope.baseId)) continue;
    const base = baseName.get(scope.baseId) ?? "";
    if (scope.scope === "base") {
      out.push({ baseId: scope.baseId, baseName: base, scope: "base", path: base });
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
        path: displayPath(base, segments),
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
      path: displayPath(base, segments),
      toolPath: segments.join("/"),
    });
  }
  return out;
}

/**
 * The id a REFUSAL names, per shape. ⚠ It is the id the CALLER PASSED, never a
 * neighbouring one: `TemplateKnowledgeBaseNotFoundError` is 404-shaped precisely
 * so "you may not attach this" and "no such thing" are indistinguishable, and
 * echoing back anything the caller did not already hold would undo that.
 */
export function knowledgeScopeSubjectId(scope: TemplateKnowledgeScope): string {
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

/**
 * `Base / Folder / Entry`. ⚠ **DISPLAY ONLY, AND SPACED ON PURPOSE.** The
 * knowledge tools' own path separator is a bare `/` with no spaces
 * (`knowledge/server/path.ts › parsePath`), and this string is NOT that path —
 * it leads with the BASE NAME, which is not a segment of any base-relative path.
 * `TemplateKnowledgeRef.toolPath` is the addressable one; anything that splices
 * THIS into a `dopl_kb` call is a bug.
 */
function displayPath(baseName: string, segments: string[]): string {
  return [baseName, ...segments].join(" / ");
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
 * a distinguishable 403: see `TemplateKnowledgeBaseNotFoundError`).
 *
 * Without this, a template is a laundering channel: attach a teammate's private
 * base by id, share the template to `workspace`, and every member's spawned
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
  ctx: AgentTemplateContext,
  requested: ReadonlyArray<TemplateKnowledgeScope>
): Promise<TemplateKnowledgeScope[]> {
  const unique: TemplateKnowledgeScope[] = [];
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
    throw new TemplateKnowledgeBaseNotFoundError(
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
  knowledge?: TemplateKnowledgeScope[];
}): TemplateKnowledgeScope[] | null {
  if (input.knowledge !== undefined) return input.knowledge;
  if (input.knowledgeBaseIds !== undefined) {
    return input.knowledgeBaseIds.map((baseId) => ({
      baseId,
      scope: "base" as const,
    }));
  }
  return null;
}
