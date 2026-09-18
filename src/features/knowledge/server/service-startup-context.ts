import "server-only";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";
import * as repo from "./repository";
import type { KnowledgeFolderNode } from "./repository-pins";
import { listBases } from "./service-bases";
import { listPinnedBaseIds } from "./service-pins";

/**
 * Pinned startup context (T81) — what an agent session is handed the moment it
 * starts. `GET /api/knowledge/startup-context` is the caller that matters: the
 * desktop reads it at launch and folds the payload into the spawn prompt. Every
 * entry of a pinned base plus every individually pinned entry, de-duped on entry
 * id, under a hard character cap.
 *
 * The visibility fence is `service-bases.ts › listBases` — M-10
 * (`canSeeBase`), the teams filter and the agent AUDIENCE CEILING — and every
 * read below is narrowed to exactly those ids. No repository function may be
 * handed a base-id set that did not come from a fenced read.
 *
 * It reads content the caller can already read, which is why the route sits at
 * `withWorkspaceAuth`'s viewer default (INVARIANTS §3). Bounded fan: three
 * queries total, never a query per base.
 */

/**
 * The ceiling on total body characters this read hands back. 8,000 ≈ 2k tokens:
 * a PROMPT budget, not a storage one — it is paid on every session start and
 * competes with the operator's own instructions. {@link StartupContext.omitted}
 * is how curated content over the cap stays reachable.
 *
 * Measured on BODIES alone: titles and paths are the addresses a reader needs
 * to fetch what was left out, so charging the cap for them would shrink the
 * escape hatch as the payload grew.
 */
export const STARTUP_CONTEXT_CHAR_CAP = 8_000;

/**
 * Row ceiling on the entry read (INVARIANTS §9: every list read carries a
 * limit, and a clipped read SAYS SO).
 *
 * An abuse bound, not the page boundary — the character cap above decides the
 * payload. It exists so pinning a base with 50,000 entries costs a bounded read
 * rather than a table scan on the launch path. Reaching it sets
 * {@link StartupContext.truncated}: AT a ceiling is indistinguishable from over it.
 */
export const STARTUP_CONTEXT_ENTRY_LIMIT = 500;

/** One pinned document, rendered whole. */
export interface StartupContextItem {
  baseId: string;
  baseName: string;
  baseSlug: string;
  entryId: string;
  path: string;
  title: string;
  body: string;
}

/** An address, never a body — everything a reader needs to fetch the entry
 *  (`dopl_kb(op="read_file", base, path)`) and nothing of its content. */
export interface StartupContextPointer {
  baseId: string;
  baseSlug: string;
  entryId: string;
  path: string;
  title: string;
}

export interface StartupContext {
  items: StartupContextItem[];
  /** Pinned content that did NOT fit under the cap — an address, never a body. */
  omitted: StartupContextPointer[];
  /** Body characters actually included, i.e. the sum over `items`. */
  chars: number;
  /**
   * Body characters of everything PINNED, `omitted` included. `chars` is bounded
   * by {@link STARTUP_CONTEXT_CHAR_CAP} and can never report a problem; this one
   * keeps rising, so it is the number a pin is judged against
   * (`shared/knowledge/caps.ts › KB_PIN_WARN_CHARS`). Itself bounded by
   * {@link STARTUP_CONTEXT_ENTRY_LIMIT}, so it is a floor once `truncated` is set.
   */
  pinnedChars: number;
  /**
   * LOAD-BEARING (INVARIANTS §9): a clipped read that renders like an
   * exhausted one is the bug, not the cap. `true` means there is pinned content
   * you were not given — the character cap (then `omitted` names it) or the row
   * ceiling ({@link STARTUP_CONTEXT_ENTRY_LIMIT}, which `omitted` does not name).
   * Consumers must say so rather than present the payload as the whole.
   */
  truncated: boolean;
}

const EMPTY: StartupContext = {
  items: [],
  omitted: [],
  chars: 0,
  pinnedChars: 0,
  truncated: false,
};

/**
 * The pinned launch payload for the caller's active workspace. An item is
 * included whole or not at all: the first entry whose body would cross
 * {@link STARTUP_CONTEXT_CHAR_CAP} becomes a pointer, and so does everything
 * after it — no skipping ahead to a smaller entry.
 */
export async function getStartupContext(
  ctx: KnowledgeContext
): Promise<StartupContext> {
  const bases = await listBases(ctx);
  if (bases.length === 0) return EMPTY;
  const pinnedBaseIds = await listPinnedBaseIds(ctx, bases);
  const baseIds = bases.map((b) => b.id);
  const rows = await repo.listPinnedEntriesForBases(
    ctx.workspaceId,
    baseIds,
    pinnedBaseIds,
    STARTUP_CONTEXT_ENTRY_LIMIT
  );
  // AT the ceiling counts as clipped — see the constant's docblock.
  const clipped = rows.length >= STARTUP_CONTEXT_ENTRY_LIMIT;
  if (rows.length === 0) return { ...EMPTY, truncated: clipped };

  const entries = orderForPresentation(dedupeById(rows), baseIds);
  const folders = await repo.listFolderNodesForBases(ctx.workspaceId, [
    ...new Set(entries.map((e) => e.knowledgeBaseId)),
  ]);
  return assemble(entries, bases, folders, clipped);
}

/**
 * The contract between the two arms of the read: an entry that is pinned AND
 * lives inside a pinned base satisfies both, and handing it over twice would
 * spend the character cap twice on one document. First occurrence wins.
 */
function dedupeById(rows: KnowledgeEntry[]): KnowledgeEntry[] {
  const seen = new Set<string>();
  return rows.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/**
 * Base order first, then the order the rows already carry (their base's TREE
 * order — `repository-pins.ts › listPinnedEntriesForBases` sorts by position,
 * created_at, id, exactly as `listEntriesForBase` does).
 *
 * The SQL orders bases by uuid, which is arbitrary; `baseIds` is the ordered list
 * `listBases` produced. Consequence: the ROW ceiling clips in uuid order, not in
 * this one.
 */
function orderForPresentation(
  entries: KnowledgeEntry[],
  baseIds: string[]
): KnowledgeEntry[] {
  const rank = new Map(baseIds.map((id, i) => [id, i]));
  return [...entries].sort(
    (a, b) =>
      (rank.get(a.knowledgeBaseId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.knowledgeBaseId) ?? Number.MAX_SAFE_INTEGER)
  );
}

/** The cap walk: fill `items` until one body would cross, then pointers. */
function assemble(
  entries: KnowledgeEntry[],
  bases: KnowledgeBase[],
  folders: KnowledgeFolderNode[],
  clipped: boolean
): StartupContext {
  const baseById = new Map(bases.map((b) => [b.id, b]));
  const pathOf = pathBuilder(folders);
  const items: StartupContextItem[] = [];
  const omitted: StartupContextPointer[] = [];
  let chars = 0;
  let pinnedChars = 0;
  for (const entry of entries) {
    const base = baseById.get(entry.knowledgeBaseId);
    // Unreachable while `baseIds` fences the read; dropped rather than rendered
    // under an invented base name if the fence ever moves.
    if (!base) continue;
    pinnedChars += entry.body.length;
    const path = pathOf(entry);
    const head = {
      baseId: base.id,
      baseSlug: base.slug,
      entryId: entry.id,
      path,
      title: entry.title,
    };
    // once anything has been omitted every later entry is too, even a small one:
    // a payload whose contents depend on the sizes of documents NOT in it is one
    // nobody can reason about.
    if (omitted.length > 0 || chars + entry.body.length > STARTUP_CONTEXT_CHAR_CAP) {
      omitted.push(head);
      continue;
    }
    chars += entry.body.length;
    items.push({ ...head, baseName: base.name, body: entry.body });
  }
  return {
    items,
    omitted,
    chars,
    pinnedChars,
    truncated: clipped || omitted.length > 0,
  };
}

/**
 * `folder/sub/Entry Title` — the address `dopl_kb(op="read_file")` and
 * `readFileByPath` take. Root entries are their title alone.
 *
 * The walk is DEPTH-BOUNDED: `knowledge_folders.parent_id` is unconstrained
 * against cycles at rest (`service-folders.ts › moveFolder` refuses to make one)
 * and this runs on the launch path — a cycle must degrade to a short path, never
 * a hang. A missing or trashed parent stops the walk for the same reason.
 */
function pathBuilder(
  folders: KnowledgeFolderNode[]
): (entry: KnowledgeEntry) => string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return (entry) => {
    const segments: string[] = [];
    let cursor = entry.folderId;
    for (let depth = 0; cursor !== null && depth <= byId.size; depth += 1) {
      const folder = byId.get(cursor);
      if (!folder) break;
      segments.unshift(folder.name);
      cursor = folder.parentId;
    }
    return [...segments, entry.title].join("/");
  };
}
