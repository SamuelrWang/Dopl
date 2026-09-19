/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import {
  flattenFenced,
  inlineOr,
  isForeignAuthored,
  NO_NAME,
  NO_PATH,
} from "./narration";
import { ok, type ToolResponse } from "./respond";
import { entryNotFound, resolveBaseOr } from "./knowledge-shared";
import { isErr } from "./channel-shared";
import {
  isConcise,
  windowBody,
  type ResponseFormat,
} from "./response-size";
import { fenceBody, fenceLines } from "./untrusted-fence";
import {
  outlineHeading,
  readHeadingsLine,
  renderOutline,
  sectionAmbiguous,
  sectionMiss,
  KB_SECTION_NUDGE_CHARS,
  type Outline,
} from "./knowledge-sections";
import {
  DESTINATION_HEADINGS,
  resolveHomeChannelContainer,
  resolveHomeChannelId,
} from "./container-destination";
import { escapedTitleLine, looksEntityEscaped } from "./knowledge-entity-titles";
import type { WorkspaceDirectory } from "../workspace-directory";

/** ⚠ §8 STALE-CACHE, SPELLED INLINE. ⚠ **ONE FROZEN EMPTY, NOT TWO** — a set of
 *  personal ids has the same meaning empty as absent, so `homeScopedBaseIds`
 *  takes a fallback. `channelGrants` does NOT get one: see {@link opListBases}
 *  for why absent and `{}` are different answers there. */
const EMPTY_BASE_IDS: readonly string[] = Object.freeze([]);

/** ⚠ §8 STALE-CACHE — the frozen empty for `entryHeadings`, a key a payload
 *  from an older bundle does not carry. Absent and `{}` mean the same thing
 *  here (no row states a heading list), so one fallback is correct. */
const EMPTY_HEADINGS: Readonly<Record<string, string[]>> = Object.freeze({});

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
 *
 * The fallback itself is `narration.ts › NO_NAME` (2026-09-17).
 */

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
 *
 * 🔒 **"ALL IN ONE CONTAINER" STOPPED BEING TRUE ON 2026-09-06, AND THE LABEL
 * IS BACK AS A HEADING (2026-09-18).** Gap 1 of #1077 widened
 * `src/shared/tenancy/personal-container.ts › resolveShelfScope` so an
 * UNFILTERED read returns the calling container PLUS the caller's own personal
 * one — two tenancies in one list, under one undifferentiated heading, for
 * twelve days. The container is the FIRST axis now, off the
 * `homeScopedBaseIds` sibling key this op used to discard; the twin correction
 * is `agent-ops-read.ts › opList`.
 */
export async function opListBases(
  client: DoplClient,
  /** ⚠ OPTIONAL — see `container-destination.ts ›
   *  resolveHomeChannelContainer`: absent means "not known", so no `channelId`
   *  is sent and the grant split is not attempted. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  // 🔒 **THE CHANNEL IS ASKED FOR, SO THE GRANTS COME BACK** (2026-09-18). In a
  // home channel "shared" is a `channel_resource_grants` row and NOT the
  // visibility column, so a list that never named the channel could not tell
  // destination 2 from the legacy rows sitting beside it — and rendered both as
  // "private". `channelGrants` is present only when `channelId` was sent, which
  // is why an ABSENT key and an empty one must not be collapsed.
  const container = await resolveHomeChannelContainer(client, directory);
  const channelId = container
    ? ((await resolveHomeChannelId(client, container)) ?? undefined)
    : undefined;
  const payload = await client.listKbBasesPayload({ channelId });
  const bases = payload.bases;
  if (bases.length === 0)
    return ok(
      `No knowledge bases visible to you here. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`,
    );
  // ⚠ §8 STALE-CACHE, SPELLED INLINE. A payload from a bundle that predates
  // either sibling key carries no such key, and BOTH read as "not asked" rather
  // than as "none": an absent `homeScopedBaseIds` files no row under the
  // personal heading, and an absent `channelGrants` skips the channel split
  // entirely. Neither can crash and neither states a shelf or a grant it did not
  // measure.
  const personalIds = new Set(payload.homeScopedBaseIds ?? EMPTY_BASE_IDS);
  // 🔒 **THE SPLIT KEYS ON THE ANSWER, NOT ON THE QUESTION.** Asking with a
  // `channelId` and grouping on that would file EVERY row under LEGACY whenever
  // the key came back absent — stating a grant fact this response never carried,
  // which is the exact inversion the paragraph above forbids. `undefined` here
  // means NOT ANSWERED and the channel split is skipped; `{}` means answered,
  // none granted, and the split is correct.
  const grants = payload.channelGrants;
  const personal = bases.filter((b) => personalIds.has(b.id));
  const here = bases.filter((b) => !personalIds.has(b.id));

  // 🔒 **CONTAINER FIRST, THEN THE GRANT** (Samuel's ruling 2026-09-18): the two
  // destinations are two CONTAINERS, and inside a home channel the only question
  // left is whether the row is shared into it.
  // ⚠ THE HEADINGS ARE `container-destination.ts › DESTINATION_HEADINGS`, the
  // same table the template lane reads its own wording from — two surfaces
  // naming one destination differently is how an agent learns a sharing model
  // the operator does not have.
  const groups: Array<readonly [string | null, typeof bases]> =
    grants === undefined
      ? [[null, here]]
      : [
          [
            DESTINATION_HEADINGS.shared,
            here.filter((b) => grants[b.id] !== undefined),
          ],
          [
            DESTINATION_HEADINGS.legacy,
            here.filter((b) => grants[b.id] === undefined),
          ],
        ];
  const lines = ["## Knowledge bases\n"];
  for (const [heading, rows] of [
    ...groups,
    [DESTINATION_HEADINGS.personal, personal] as const,
  ]) {
    if (rows.length === 0) continue;
    if (heading !== null) lines.push(`### ${heading}`);
    for (const b of rows) {
      // ⚠ Immutable id beside the slug — the slug changes on rename.
      const vis = b.visibility === "private" ? "private" : "public";
      const desc = b.description ? `\n  ${inlineOr(b.description, "")}` : "";
      lines.push(
        `- ${inlineOr(b.name, NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`,
      );
    }
    lines.push("");
  }
  lines.push(BASES_SCOPE_NOTE);
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
  // 🔒 **`headings: true` IS THE AGENT SURFACE'S STANDING ASK** (Wave 4 a1).
  // The flag costs the body column server-side, which is why the app's tree
  // pane does not send it and this op always does — see `service-folders.ts ›
  // getBaseTree`.
  const tree = await client.getKbTree(base.id, {
    entryLimit: limit,
    entryCursor,
    headings: true,
  });
  const entryTotal = tree.entryTotal ?? tree.entries.length;
  const vis = tree.base.visibility === "private" ? "private" : "public";
  // ⚠ §8 STALE-CACHE, SPELLED INLINE. A payload from a bundle that predates
  // `entryHeadings` carries no such key; `EMPTY_HEADINGS` makes that read as
  // "not measured" — every row simply renders without a heading list — rather
  // than crashing or claiming an entry has none.
  const headings = tree.entryHeadings ?? EMPTY_HEADINGS;
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
  // 🔒 **THE ROWS GO IN THEIR OWN FENCE, THE NARRATION STAYS OUT OF IT**
  // (2026-09-18). Every row below is author-written metadata rendered as
  // ITSELF — full 300-char excerpt, backticks intact — which is only safe
  // because the block is delimited by a tag the author could not know. The
  // header, the paging notice and the scope line above and below it are this
  // server's and stay outside, so the boundary is informative.
  const rows: string[] = [];
  // ⚠ COLLECTED WHILE DUMPING, NOT IN A SECOND PASS — a tree render is the one
  // place every label in the base goes past, and walking it twice to count
  // `&amp;` would cost the whole listing again.
  const escaped: string[] = [];
  function dump(parentId: string | null, prefix: string): void {
    for (const f of childFolders.get(parentId) ?? []) {
      if (looksEntityEscaped(f.name)) escaped.push(f.name);
      rows.push(`${prefix}📁 ${inlineOr(f.name, NO_NAME)}/${descSuffix(f.description)}`);
      dump(f.id, prefix + "  ");
    }
    for (const e of childEntries.get(parentId) ?? []) {
      if (looksEntityEscaped(e.title)) escaped.push(e.title);
      rows.push(
        `${prefix}📄 ${inlineOr(e.title, NO_NAME)}${descSuffix(e.excerpt)}${headingSuffix(headings[e.id])}`,
      );
    }
  }
  dump(null, "");
  lines.push(...fenceLines(rows, "knowledge tree, member-written names and summaries"));
  // ⚠ ONE LINE FOR THE WHOLE TREE, not one per row: the fix is the same call
  // every time, and repeating it per entry would bury the listing it annotates.
  // 🔒 **AND IT SITS OUTSIDE THE FENCE, WHICH IS WHY IT IS AFTER THE PUSH** —
  // it is this server's narration about the rows, not one of them. It quotes a
  // member-written title, so `escapedTitleLine` neutralizes what it splices.
  if (escaped.length > 0) lines.push("", escapedTitleLine(escaped[0], escaped.length));
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
 * 🔒 **THE EXCERPT'S OWN BUDGET, AND IT IS THE FIELD'S CAP RATHER THAN THE
 * NARRATION CAP** (2026-09-18, Wave 4 a3/b2 + S36). `excerpt` and a folder
 * `description` are bounded at 300 by `DESCRIPTION_MAX` at the schema, so
 * rendering 300 of them cannot be a dump: the author already paid for every
 * character, for this exact purpose.
 *
 * ⚠ **`narration.ts › INLINE_TEXT_MAX` (160) WAS NOT RAISED AND MUST NOT BE.**
 * It guards every NAME, LABEL and ERROR ECHO on the whole surface, none of
 * which is curated and all of which are spliced into lines this server wrote.
 * What changed is the CLASS of this one value, not the bound on that one.
 */
const EXCERPT_MAX = 300;

/**
 * ` — description` suffix for tree / directory rows. Folder `description` and
 * entry `excerpt` are the user-curated, agent-facing summaries (≤300 chars) —
 * surfacing them here lets agents pick the right file from a listing instead of
 * read_file-ing everything.
 *
 * 🔒 **BODY-CLASS, NOT VALUE-CLASS, SINCE 2026-09-18 — AND THE FENCE IS WHAT
 * PAYS FOR IT.** This used to run `inlineOr`, which clipped at 160 mid-clause
 * and stripped backticks; Wave 4 measured both as routing failures (an excerpt
 * that died before naming its heading, and a rule — *"quote the heading name in
 * backticks"* — that the renderer made unfollowable). The caller renders every
 * row this produces inside ONE `untrusted-fence.ts` fence, which is the
 * structural claim that makes verbatim markdown safe here; a caller that does
 * not fence must not use this function.
 */
function descSuffix(text: string | null | undefined): string {
  if (!text) return "";
  const rendered = flattenFenced(text, EXCERPT_MAX);
  return rendered ? ` — ${rendered}` : "";
}

/** ⚠ A ROW, NOT AN OUTLINE — see `service-sections.ts › headingNames`. Capped
 *  because a listing renders hundreds of these; the Wave 4 bases measured 5-6
 *  headings and well under this. */
const ROW_HEADINGS_MAX = 150;

/**
 * 🔒 **THE HEADING LIST ON A LISTING ROW** (Wave 4 a1 — its top ask in 3 of 4
 * runs). It is what makes the `outline` rung skippable BY DESIGN rather than by
 * luck: three of four runs spent calls guessing heading names, and one spent
 * three `outline` calls whose only purpose was learning names it should have
 * been handed.
 *
 * ⚠ Heading text is author-written, so this renders only inside the same fence
 * the excerpt does.
 */
function headingSuffix(names: readonly string[] | undefined): string {
  if (!names || names.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const raw of names) {
    const one = flattenFenced(raw, 60);
    if (!one) continue;
    if (used + one.length + 3 > ROW_HEADINGS_MAX) {
      parts.push(`+${names.length - parts.length} more`);
      break;
    }
    used += one.length + 3;
    parts.push(one);
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
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
    // ⚠ SAME FENCE, SAME REASON as `opGetTree`'s — `descSuffix` renders
    // author-written markdown verbatim and owes its caller a delimiter.
    const rows: string[] = [];
    for (const f of listing.folders)
      rows.push(`📁 ${inlineOr(f.name, NO_NAME)}/${descSuffix(f.description)}`);
    for (const e of listing.entries)
      rows.push(`📄 ${inlineOr(e.title, NO_NAME)}${descSuffix(e.excerpt)}`);
    lines.push(...fenceLines(rows, "knowledge listing, member-written names and summaries"));
  }
  return ok(lines.join("\n"));
}

/**
 * THE OUTLINE OP — every heading in one entry, with what each costs to read.
 *
 * ⚠ **IT IS A READ THAT DELIBERATELY DOES NOT RETURN THE DOCUMENT.** The body
 * is emptied server-side, so an agent deciding WHETHER to read an entry pays a
 * few dozen characters instead of a few thousand. That is the whole trade, and
 * it is why the routing line names this before `read_file`.
 */
export async function opOutline(
  client: DoplClient,
  ref: string,
  path: string,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  // ⚠ **THE 404 IS A REFUSAL, NOT A THROW (S41, 2026-09-18)** — the mapper and
  // the argument for "it may have moved" are in `knowledge-shared.ts ›
  // entryNotFound`. Anything else rethrows: a catch that swallowed an outage
  // would report it as a missing document.
  let read;
  try {
    read = await client.readKbFilePart(base.id, path, { outline: true });
  } catch (e) {
    const missing = entryNotFound(e, path, ref);
    if (missing) return missing;
    throw e;
  }
  const outline = read.outline;
  if (!outline || outline.sections.length === 0) {
    // ⚠ NOT AN ERROR, AND IT MUST NOT READ AS ONE. An entry with no headings is
    // the ordinary state of a short note; what the caller needs is the SIZE, so
    // it can decide whether reading the whole thing is cheap.
    return ok(
      [
        `## ${inlineOr(read.entry.title, NO_NAME)} — no headings`,
        `Path: \`${path}\` · ${outline?.totalChars ?? 0} chars whole.`,
        "",
        `Nothing to address by section — read it with op="read_file". Entries over ${KB_SECTION_NUDGE_CHARS} chars should carry \`##\` headings, one topic each.`,
      ].join("\n"),
    );
  }
  return ok(
    [
      outlineHeading(read.entry.title, outline),
      `Path: \`${path}\` · Version: \`${read.entry.updatedAt}\``,
      "",
      ...renderOutline(outline),
    ].join("\n"),
  );
}

/**
 * ⚠ **THREE WAYS TO SPEND LESS ON ONE DOCUMENT, AND THEY COMPOSE IN ONE ORDER.**
 * `section` picks WHAT (server-side — the rest never crosses the wire), then
 * `offset` and `max_chars` pick how much of that to render. A `section` that
 * does not resolve returns the OUTLINE rather than the document, so the retry
 * costs no round trip.
 */
export async function opReadFile(
  client: DoplClient,
  ref: string,
  path: string,
  // ⚠ Only the FRAMING reads this — readability is the server's decision and
  // it already ran.
  callerUserId: string | null = null,
  format?: ResponseFormat,
  maxChars?: number,
  section?: string,
  offset?: number,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let outline: Outline | undefined;
  let sectionLine: string | null = null;
  let entry;
  // ⚠ **BOTH LANES SIT INSIDE ONE TRY (S41, 2026-09-18).** A missing path 404s
  // identically whether or not `section` was passed, so mapping one of them
  // would make the refusal depend on an argument that says nothing about
  // whether the entry is there. `knowledge-shared.ts › entryNotFound` writes it.
  let part;
  try {
    if (section === undefined) {
      // 🔒 **THE HEADINGS COME BACK WITH THE DOCUMENT** (Wave 4 a1). Same body
      // as before, plus the addresses this reader can use next time — which is
      // the difference between an agent that pages a 3k entry by section and
      // one that spends an `outline` call to learn the names it should already
      // have. ⚠ **AND IT IS `readKbFilePart`, NOT `readKbFileByPath`, SINCE
      // 2026-09-19** — the headings ride the part reader's own `outline` key,
      // and routing the unsectioned lane through it is what lets ONE catch
      // below map the 404 for both (S41's rule, unchanged).
      part = await client.readKbFilePart(base.id, path, { headings: true });
      entry = part.entry;
      outline = part.outline;
    } else {
      part = await client.readKbFilePart(base.id, path, { section });
      entry = part.entry;
    }
  } catch (e) {
    const missing = entryNotFound(e, path, ref);
    if (missing) return missing;
    throw e;
  }
  // ⚠ `section !== undefined` IS A NARROWING, NOT A SECOND CONDITION: `part` is
  // only ever set on the sectioned lane, and the compiler cannot see that across
  // the try above.
  if (part !== undefined && section !== undefined) {
    const read = part;
    outline = read.outline;
    const found = read.section;
    if (found && found.ok === false) {
      const lines =
        found.reason === "SECTION_AMBIGUOUS"
          ? sectionAmbiguous(section, found.matches)
          : sectionMiss(section, outline, entry.title);
      // ⚠ `ok`, NOT `err`: the READ succeeded and the heading did not resolve.
      // An `isError` here would make a client that retries on error retry a
      // call that can only answer the same way.
      return ok(lines.join("\n"));
    }
    if (found && found.ok) {
      // ⚠ NO OUTER BACKTICKS: `inlineOr` already renders a VALUE as code, and
      // wrapping its output again produced ``` ``Errors`` ``` — a heading an
      // agent cannot copy back into `section=`.
      sectionLine = `Section: ${"#".repeat(Math.min(3, found.level))} ${inlineOr(found.heading, NO_NAME)} · ${found.chars} of ${outline?.totalChars ?? found.chars} chars (starts at offset ${found.start}).`;
    }
  }
  const { body, notice } = windowBody(entry.body, offset, maxChars);
  const terse = isConcise(format);
  const lines = [
    // ⚠ `concise` KEEPS THE VERSION TOKEN AND DROPS THE REST OF THE METADATA.
    // That split is not arbitrary: `write_file` REFUSES without an
    // `expected_version`, so dropping it would make the smaller read unable to
    // feed the write it exists to precede — a knob that quietly costs a round
    // trip is a knob nobody uses twice.
    `# ${inlineOr(entry.title, NO_NAME)}`,
    // ⚠ DIRECTLY UNDER THE TITLE IT IS ABOUT, and it survives `concise` — the
    // smaller read is the one an agent takes before a write, which is exactly
    // the call that can fix this. It is not an error: the read succeeded and
    // the title is what storage holds.
    ...(looksEntityEscaped(entry.title) ? [escapedTitleLine(entry.title)] : []),
    ...(terse
      ? [`Version: \`${entry.updatedAt}\` (pass as expected_version to write_file)`]
      : [
          `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType}`,
          `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
        ]),
    ...(sectionLine ? [sectionLine] : []),
    // ⚠ ON EVERY READ, `concise` INCLUDED, and that is the one metadata line
    // `concise` may not drop: it is what a later call costs, not what this one
    // was. Same argument as the Version token two lines up.
    ...[readHeadingsLine(outline, entry.body.length)].filter(
      (l): l is string => l !== null,
    ),
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
