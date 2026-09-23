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
 * Knowledge scope resolution: `{baseId, scope, folderId?, entryId?}` in, viewer-filtered refs out —
 * one predicate for the attach gate (drop = 404) and the read path (drop = omitted).
 * The base predicate is the ceiling; this adds tenancy (the folder/entry lives in the named base).
 * It is not the session's read ceiling: `knowledge/server/service-audience.ts` stays base-keyed.
 * `path` (display, base-led, " / ") and `toolPath` (base-relative, "/") are never interchangeable.
 */

/** Card facts are all-or-nothing: a clause longer than this is omitted, never sliced. */
const CARD_SUMMARY_MAX = DESCRIPTION_MAX;

/** Safe only because `baseFolderCount` (the true total) travels beside the capped list. */
const MAX_CARD_FOLDERS = 50;

/** At most three reads beyond the base resolution, flat in the number of scopes. */
export async function resolveVisibleKnowledgeScopes(
  ctx: AgentIdentityContext,
  scopes: ReadonlyArray<IdentityKnowledgeScope>
): Promise<IdentityKnowledgeRef[]> {
  if (scopes.length === 0) return [];
  const baseIds = [...new Set(scopes.map((s) => s.baseId))];
  const visibleBases = await resolveVisibleKnowledgeBases(ctx, baseIds);
  if (visibleBases.length === 0) return [];
  // Visibility is the set; the map only labels (a nameless base is not an invisible one).
  const visibleBaseIds = new Set(visibleBases.map((b) => b.id));
  const baseById = new Map(visibleBases.map((b) => [b.id, b]));

  // Only surviving bases: reading folders of an invisible base would be a probe.
  const visibleScopes = scopes.filter((s) => visibleBaseIds.has(s.baseId));
  const entryIds = visibleScopes
    .filter((s): s is Extract<IdentityKnowledgeScope, { scope: "entry" }> =>
      s.scope === "entry"
    )
    .map((s) => s.entryId);
  // One folder read serves both the sub-base path walk and the base card's top-level folders.
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
        // The card is base-scope only; a folder or entry scope already names its target.
        ...baseCard(baseRow, rootFolders.get(scope.baseId) ?? []),
      });
      continue;
    }
    if (scope.scope === "folder") {
      const folder = folderById.get(scope.folderId);
      // Tenancy on read too: the trigger guards writes, not rows written before it existed.
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

/** Each base's top-level folders in read order — top level only, so the card stays fixed-size. */
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
 * The card facts for one whole-base attachment: slug, summary, top-level folders (never entries).
 * Summaries over {@link CARD_SUMMARY_MAX} are omitted whole; an empty folder list is a decided zero.
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
    // The true total, not `folders.length`: the renderer drops the line when they differ.
    baseFolderCount: roots.length,
  };
}

/** The id a refusal names — only ever the one the caller passed (the 404 must not disclose more). */
function knowledgeScopeSubjectId(scope: IdentityKnowledgeScope): string {
  if (scope.scope === "folder") return scope.folderId;
  if (scope.scope === "entry") return scope.entryId;
  return scope.baseId;
}

/** The folder chain, root-first; cycle-guarded (`parent_id` is not constrained acyclic). */
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

/**
 * No attaching knowledge you cannot read — else an identity launders a private base to every member.
 * Unreadable, missing and wrong-base scopes are the same 404; the DB trigger is only the backstop.
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
 * The two wire spellings → one scope list: `knowledgeBaseIds` (MCP `knowledge_bases`) means whole
 * bases; the schema refuses both at once. `null` = neither named (the junction is left alone).
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
