import "server-only";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";
import * as repo from "./repository";
import type { KnowledgeFolderNode } from "./repository-pins";
import { listBases } from "./service-bases";
import { listPinnedBaseIds } from "./service-pins";

/**
 * PINNED STARTUP CONTEXT (T81) — what an agent session is handed the moment it
 * starts, without anybody pasting it again.
 *
 * `GET /api/knowledge/startup-context` is the one caller that matters: the
 * desktop reads it at launch and folds the payload into the spawn prompt. The
 * payload is EVERY entry of a pinned base plus every individually pinned entry,
 * de-duped on entry id, with a hard character cap so a launch prompt cannot be
 * made unbounded by curating one large base.
 *
 * 🔒 ⚠ THE VISIBILITY FENCE IS `listBases`, AND ITS ID SET IS THE WHOLE FENCE.
 * The base list comes out of `service-bases.ts › listBases`, i.e. already
 * through M-10 (`canSeeBase`), the teams filter and the agent AUDIENCE CEILING;
 * every read below is narrowed to exactly those ids. Nothing here re-derives a
 * visibility rule, and no repository function may ever be handed a base-id set
 * that did not come from a fenced read.
 *
 * ⚠ IT IS A READ OF CONTENT THE CALLER CAN ALREADY READ, which is why the route
 * sits at `withWorkspaceAuth`'s viewer default and is neither `sessionOnly` nor
 * `member`-floored (INVARIANTS §3). Pinning is the write; this is not.
 *
 * ⚠ BOUNDED FAN: three queries total, whatever the workspace holds — the base
 * list, ONE `.in()` over entries, ONE `.in()` over the folder skeleton the paths
 * are built from. Never a query per base.
 */

/**
 * The ceiling on the total body characters this read hands back.
 *
 * 8,000 characters ≈ 2k tokens — a few pages. The number is a PROMPT budget,
 * not a storage one: the payload is prepended to every session this workspace
 * launches, so it is paid on each start, competes with the operator's actual
 * instructions for the model's attention, and a startup context longer than the
 * task is how an agent learns to skim its own preamble. Curating more than this
 * is a legitimate thing to do — {@link StartupContext.omitted} is how the extra
 * stays reachable.
 *
 * ⚠ MEASURED ON BODIES ALONE, deliberately: titles and paths are the ADDRESSES
 * a reader needs in order to fetch what was left out, so charging the cap for
 * them would shrink the escape hatch as the payload grew.
 */
export const STARTUP_CONTEXT_CHAR_CAP = 8_000;

/**
 * Row ceiling on the entry read (INVARIANTS §9: every list read carries a
 * limit, and a clipped read SAYS SO).
 *
 * ⚠ IT IS AN ABUSE BOUND, NOT THE PAGE BOUNDARY. The character cap above is
 * what actually decides the payload, and no entry with a body can be shorter
 * than a character — so a read that returns 500 rows has already produced far
 * more pointers than items. It exists so that pinning a base with 50,000
 * entries costs a bounded read rather than a whole table scan on the launch
 * path. Reaching it sets {@link StartupContext.truncated}, because AT a ceiling
 * is indistinguishable from over it.
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

/** ⚠ AN ADDRESS, NEVER A BODY — everything a reader needs to fetch the entry
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
   * Body characters of everything PINNED, `omitted` included — what the curated
   * set costs, as against what a launch is handed.
   *
   * ⚠ **THE TWO NUMBERS DIVERGE ON PURPOSE, AND THE GAP IS THE WHOLE WARNING.**
   * `chars` is bounded by {@link STARTUP_CONTEXT_CHAR_CAP} and can never report
   * a problem, because past the cap the payload simply ships pointers; this one
   * keeps rising, so it is the number a pin can be judged against
   * (`shared/knowledge/caps.ts › KB_PIN_WARN_CHARS`). ⚠ Bounded in its own right
   * by {@link STARTUP_CONTEXT_ENTRY_LIMIT}, so it is a floor once
   * `truncated` is set for the row reason.
   */
  pinnedChars: number;
  /**
   * ⚠ LOAD-BEARING (INVARIANTS §9). A clipped read that renders like an
   * exhausted one is the bug, not the cap. `true` means "there is pinned
   * content you were not given" — either because the character cap was reached
   * (then `omitted` names it) or because the row ceiling was
   * ({@link STARTUP_CONTEXT_ENTRY_LIMIT}, in which case there is also content
   * `omitted` does not name). Consumers must say so out loud rather than
   * presenting the payload as the whole of what is pinned.
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
 * The pinned launch payload for the caller's active workspace.
 *
 * ⚠ AN ITEM IS INCLUDED WHOLE OR NOT AT ALL. The first entry whose body would
 * cross {@link STARTUP_CONTEXT_CHAR_CAP} becomes a pointer, and so does
 * everything after it — no half body, and no skipping ahead to a smaller entry,
 * which would make the payload's contents depend on the sizes of documents that
 * are not in it.
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
  // ⚠ AT the ceiling counts as clipped — see the constant's docblock.
  const clipped = rows.length >= STARTUP_CONTEXT_ENTRY_LIMIT;
  if (rows.length === 0) return { ...EMPTY, truncated: clipped };

  const entries = orderForPresentation(dedupeById(rows), baseIds);
  const folders = await repo.listFolderNodesForBases(ctx.workspaceId, [
    ...new Set(entries.map((e) => e.knowledgeBaseId)),
  ]);
  return assemble(entries, bases, folders, clipped);
}

/**
 * ⚠ DE-DUPE IS NOT DEFENSIVE PADDING — it is the contract between the two arms
 * of the read. An entry that is pinned AND lives inside a pinned base satisfies
 * both, and handing it over twice would spend the character cap twice on one
 * document. First occurrence wins, so the ordering below stays meaningful.
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
 * ⚠ THE SQL ORDERS BASES BY UUID, WHICH IS ARBITRARY; `baseIds` is the ordered
 * list `listBases` produced (oldest base first), so re-keying on it is what
 * makes the payload read the way the workspace reads. ⚠ The one consequence to
 * know: the ROW ceiling therefore clips in uuid order, not in this one — an
 * abuse bound is allowed to be arbitrary about which 500 it stops at, as long
 * as it is deterministic and says that it stopped.
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
    // ⚠ Once anything has been omitted every later entry is too, even a small
    // one: a payload whose contents depend on the sizes of the documents NOT in
    // it is one nobody can reason about.
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
 * ⚠ THE WALK IS DEPTH-BOUNDED. `knowledge_folders.parent_id` is unconstrained
 * against cycles at rest (`service-folders.ts › moveFolder` is what refuses to
 * make one), and this read runs on the launch path — a cycle must degrade to a
 * short path, never to a hang. A missing or trashed parent stops the walk for
 * the same reason: render the segments that resolve rather than invent one.
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
