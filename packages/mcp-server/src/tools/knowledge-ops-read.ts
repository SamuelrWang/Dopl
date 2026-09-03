/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr, isForeignAuthored } from "./narration";
import { ok, type ToolResponse } from "./respond";
import { isErr, resolveBaseOr } from "./knowledge-shared";
import {
  clipToMaxChars,
  isConcise,
  type ResponseFormat,
} from "./response-size";
import { fenceBody } from "./untrusted-fence";

/**
 * ⚠ WHAT IS AND ISN'T NEUTRALIZED IN A KNOWLEDGE READ. A published base is
 * workspace-visible, so every name, description, title and excerpt can be
 * another member's:
 *   - NAMES / TITLES / DESCRIPTIONS / EXCERPTS are values spliced into lines we
 *     wrote, so they go through the neutralizer. Only folder names and entry
 *     titles carry a charset rule (`NAME_RE`, features/knowledge/schema.ts);
 *     base names, descriptions and excerpts are LENGTH-bounded only, so a
 *     newline in any of them starts a line.
 *   - THE ENTRY BODY is untouched — it is the document the user wrote for the
 *     agent to act on, and stripping its markdown breaks the product. Rendered
 *     below a `---` rule, under {@link UNTRUSTED_ENTRY_BODY_HEADER} when it is
 *     ANOTHER MEMBER'S. ⚠ The gap was never rendering it as itself; it was
 *     rendering it with nothing saying whose it was.
 */
const NO_NAME = "`(unnamed)`";

/**
 * ⚠ WHOSE VIEW THIS IS, stated on the RESULT, not only in the description.
 * `listBases` is filtered twice server-side (`canSeeBase` drops another
 * member's private bases; `filterTeamVisibleBases` drops teams-mode bases with
 * no grant and FAILS CLOSED to an empty list), and an untraced filter makes a
 * four-row heading read as a workspace census.
 *
 * ⚠ Names the FILTERS, never a hidden count — counting what you were not shown
 * is a second query on every list call.
 */
const BASES_SCOPE_NOTE = `_Bases you can READ here. Another member's private bases, and any you have no grant on, are not listed, so this is not the workspace's base count. Full inventory across every visibility: dopl_members(op="access_matrix")._`;

/**
 * ⚠ **THE `shelf` ARGUMENT AND ITS `· personal` LABEL LEFT ON 2026-09-02
 * (slice B15, ruling B10).** A personal base is no longer a `home_scoped`
 * BOOLEAN inside a shared workspace — it is an ordinary row in the caller's own
 * `kind='personal'` CONTAINER — so "which shelf" stopped being a question this
 * op could ask and became the tenancy the call is already in. Labelling rows
 * that are all in one container is chrome, and F-342's rule (the unfiltered MCP
 * read is the right one) is now the only rule there is.
 */
export async function opListBases(client: DoplClient): Promise<ToolResponse> {
  const bases = (await client.listKbBasesPayload()).bases;
  if (bases.length === 0)
    return ok(
      `No knowledge bases visible to you here. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`,
    );
  const lines = ["## Knowledge bases\n"];
  for (const b of bases) {
    // ⚠ Immutable id beside the slug — the slug changes on rename.
    const vis = b.visibility === "private" ? "private" : "public";
    const desc = b.description ? `\n  ${inlineOr(b.description, "")}` : "";
    lines.push(
      `- ${inlineOr(b.name, NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`,
    );
  }
  lines.push("", BASES_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

const TREE_ENTRY_CAP = 400;
const TREE_ENTRY_MAX = 1000;

export async function opGetTree(
  client: DoplClient,
  ref: string,
  entryLimit?: number,
  entryCursor?: string
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  // Entries are paged at the API (folders always ship in full), so the wire
  // payload matches what gets rendered.
  const limit = Math.min(Math.max(1, Math.floor(entryLimit ?? TREE_ENTRY_CAP)), TREE_ENTRY_MAX);
  const tree = await client.getKbTree(base.id, {
    entryLimit: limit,
    entryCursor,
  });
  const entryTotal = tree.entryTotal ?? tree.entries.length;
  const vis = tree.base.visibility === "private" ? "private" : "public";
  const lines = [
    `## ${inlineOr(tree.base.name, NO_NAME)} \`${tree.base.slug}\``,
    `id: \`${tree.base.id}\` · ${vis} · agent-write ${tree.base.agentWriteEnabled ? "on" : "off"}`,
    ...(tree.base.description ? [inlineOr(tree.base.description, "")] : []),
    `Folders: ${tree.folders.length} · Entries: ${entryTotal}${tree.entries.length < entryTotal ? ` (showing ${tree.entries.length})` : ""}`,
    "",
  ];
  const childFolders = new Map<string | null, typeof tree.folders>();
  for (const f of tree.folders) {
    const arr = childFolders.get(f.parentId) ?? [];
    arr.push(f);
    childFolders.set(f.parentId, arr);
  }
  for (const arr of childFolders.values())
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const childEntries = new Map<string | null, typeof tree.entries>();
  for (const e of tree.entries) {
    const arr = childEntries.get(e.folderId) ?? [];
    arr.push(e);
    childEntries.set(e.folderId, arr);
  }
  for (const arr of childEntries.values())
    arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  function dump(parentId: string | null, prefix: string): void {
    for (const f of childFolders.get(parentId) ?? []) {
      lines.push(`${prefix}📁 ${inlineOr(f.name, NO_NAME)}/${descSuffix(f.description)}`);
      dump(f.id, prefix + "  ");
    }
    for (const e of childEntries.get(parentId) ?? []) {
      lines.push(`${prefix}📄 ${inlineOr(e.title, NO_NAME)}${descSuffix(e.excerpt)}`);
    }
  }
  dump(null, "");
  if (tree.nextEntryCursor) {
    lines.push(
      "",
      `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`
    );
  } else {
    // ⚠ The paging notice fires only when there IS a next page, so the complete
    // case must state its own scope rather than leave it implied.
    lines.push(
      "",
      `_Folders complete; entries complete for this base._`
    );
  }
  return ok(lines.join("\n"));
}

/**
 * ` — description` suffix for tree / directory rows. Folder `description` and
 * entry `excerpt` are the user-curated, agent-facing summaries (≤300 chars) —
 * surfacing them here lets agents pick the right file from a listing instead of
 * read_file-ing everything.
 *
 * ⚠ Defers to the shared neutralizer — a hand-rolled flatten-and-truncate
 * misses U+0085 (NEL is not in JavaScript's `\s` class) and touches neither
 * backticks nor `**`. Separator renders only when something survives.
 */
function descSuffix(text: string | null | undefined): string {
  if (!text) return "";
  const rendered = inlineOr(text, "");
  return rendered ? ` — ${rendered}` : "";
}

export async function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const listing = await client.listKbDirByPath(base.id, path ?? "");
  const lines: string[] = [];
  const where = listing.folder ? inlineOr(listing.folder.name, NO_NAME) : "(root)";
  lines.push(`## ${inlineOr(base.name, NO_NAME)} → ${where}`);
  if (listing.folder?.description) lines.push(inlineOr(listing.folder.description, ""));
  if (listing.folders.length === 0 && listing.entries.length === 0) {
    lines.push("Empty.");
  } else {
    for (const f of listing.folders)
      lines.push(`📁 ${inlineOr(f.name, NO_NAME)}/${descSuffix(f.description)}`);
    for (const e of listing.entries)
      lines.push(`📄 ${inlineOr(e.title, NO_NAME)}${descSuffix(e.excerpt)}`);
  }
  return ok(lines.join("\n"));
}

export async function opReadFile(
  client: DoplClient,
  ref: string,
  path: string,
  // ⚠ Only the FRAMING reads this — readability is the server's decision and
  // it already ran.
  callerUserId: string | null = null,
  format?: ResponseFormat,
  maxChars?: number,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const entry = await client.readKbFileByPath(base.id, path);
  const { body, notice } = clipToMaxChars(entry.body, maxChars);
  const terse = isConcise(format);
  const lines = [
    // ⚠ `concise` KEEPS THE VERSION TOKEN AND DROPS THE REST OF THE METADATA.
    // That split is not arbitrary: `write_file` REFUSES without an
    // `expected_version`, so dropping it would make the smaller read unable to
    // feed the write it exists to precede — a knob that quietly costs a round
    // trip is a knob nobody uses twice.
    `# ${inlineOr(entry.title, NO_NAME)}`,
    ...(terse
      ? [`Version: \`${entry.updatedAt}\` (pass as expected_version to write_file)`]
      : [
          `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType}`,
          `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
        ]),
    ...(notice ? ["", notice] : []),
    "",
    "---",
    "",
    // ⚠ FENCED, and only for a document this caller did not write. The fence's
    // own header goes first — a caveat read after the injected line has already
    // been read is not a caveat — and the close tag carries a per-response
    // random suffix so the body cannot end its own fence (`untrusted-fence.ts`).
    ...(isForeignAuthored(entry, callerUserId)
      ? fenceBody(body, "knowledge entry by another member")
      : [body]),
  ];
  return ok(lines.join("\n"));
}

export async function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse> {
  // ⚠ `base` accepts a slug OR a UUID, but the search endpoint narrows by SLUG
  // only — resolve first; a UUID forwarded to `baseSlug` 404s with
  // KNOWLEDGE_BASE_NOT_FOUND.
  let baseSlug: string | undefined;
  if (base) {
    const resolved = await resolveBaseOr(client, base);
    if (isErr(resolved)) return resolved;
    baseSlug = resolved.slug;
  }
  const hits = await client.searchKb(query, { baseSlug, limit });
  const shownQuery = inlineOr(query, "`(unreadable query)`");
  if (hits.length === 0) {
    return ok(`No matches for ${shownQuery}. ${SEARCH_SCOPE_NOTE}`);
  }
  const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for ${shownQuery}\n`];
  for (const h of hits) {
    // ⚠ Do not turn highlight tags into `**` — that is our own markdown wrapped
    // around an excerpt of a member-authored body on an unframed line.
    const cleanSnippet = inlineOr(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`");
    lines.push(
      `- ${inlineOr(h.title, NO_NAME)} _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`
    );
  }
  lines.push("", SEARCH_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

/**
 * ⚠ A SHORT RESULT LIST IS NOT AN ANSWER. Three invisible reductions apply: the
 * ranking RPC caps its CANDIDATE set per leg before fusing, drops chunks past a
 * semantic-distance cutoff, and `search.ts` removes hits in unreadable bases
 * AFTER ranking. So `limit` is an upper bound the result routinely falls short
 * of for reasons unrelated to how much matched, and "2 matches" read as "there
 * are two" is a recall-capped, visibility-filtered sample read as a census.
 *
 * ⚠ States the SHAPE, not a number — the true count needs another query.
 */
const SEARCH_SCOPE_NOTE = `_A ranked SAMPLE of the bases you can read, not an exhaustive scan: candidates are capped before ranking, distant matches are dropped, and hits in bases you cannot read are removed after ranking. Fewer hits than \`limit\` does not mean there are no others, and zero hits is not proof of absence — try op="get_tree" or different wording._`;
