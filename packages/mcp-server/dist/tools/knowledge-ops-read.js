"use strict";
/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opListBases = opListBases;
exports.opGetTree = opGetTree;
exports.opListDir = opListDir;
exports.opOutline = opOutline;
exports.opReadFile = opReadFile;
exports.opSearch = opSearch;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
const response_size_1 = require("./response-size");
const untrusted_fence_1 = require("./untrusted-fence");
const knowledge_sections_1 = require("./knowledge-sections");
const audience_label_1 = require("./audience-label");
const body_digest_1 = require("./body-digest");
const container_destination_1 = require("./container-destination");
/** ⚠ §8 STALE-CACHE, SPELLED INLINE. ⚠ **ONE FROZEN EMPTY, NOT TWO** — a set of
 *  personal ids has the same meaning empty as absent, so `homeScopedBaseIds`
 *  takes a fallback. `channelGrants` does NOT get one: see {@link opListBases}
 *  for why absent and `{}` are different answers there. */
const EMPTY_BASE_IDS = Object.freeze([]);
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
async function opListBases(client, 
/** ⚠ OPTIONAL — see `container-destination.ts ›
 *  resolveHomeChannelContainer`: absent means "not known", so no `channelId`
 *  is sent and the grant split is not attempted. */
directory) {
    // 🔒 **THE CHANNEL IS ASKED FOR, SO THE GRANTS COME BACK** (2026-09-18). In a
    // home channel "shared" is a `channel_resource_grants` row and NOT the
    // visibility column, so a list that never named the channel could not tell
    // destination 2 from the legacy rows sitting beside it — and rendered both as
    // "private". `channelGrants` is present only when `channelId` was sent, which
    // is why an ABSENT key and an empty one must not be collapsed.
    const container = await (0, container_destination_1.resolveHomeChannelContainer)(client, directory);
    const channelId = container
        ? ((await (0, container_destination_1.resolveHomeChannelId)(client, container)) ?? undefined)
        : undefined;
    const payload = await client.listKbBasesPayload({ channelId });
    const bases = payload.bases;
    if (bases.length === 0)
        return (0, respond_1.ok)(`No knowledge bases visible to you here. ${BASES_SCOPE_NOTE}\n\nCreate one with \`dopl_kb(op='create_base')\`.`);
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
    // ⚠ **EACH GROUP CARRIES THE ROW LABEL AS WELL AS THE HEADING (S21/S23,
    // 2026-09-18).** A base shared into a home channel is STORED `private` — the
    // grant is the audience — so printing the column made the rows under "Shared
    // in this channel" read `· private`, which is the opposite of the truth.
    // `audience-label.ts` is the table; a `null` label means "ask the column",
    // which is only ever the standard-workspace case.
    const groups = grants === undefined
        ? [[null, here, null]]
        : [
            [
                container_destination_1.DESTINATION_HEADINGS.shared,
                here.filter((b) => grants[b.id] !== undefined),
                audience_label_1.AUDIENCE_LABELS.channel,
            ],
            [
                container_destination_1.DESTINATION_HEADINGS.legacy,
                here.filter((b) => grants[b.id] === undefined),
                audience_label_1.AUDIENCE_LABELS.nobody,
            ],
        ];
    const lines = ["## Knowledge bases\n"];
    for (const [heading, rows, audience] of [
        ...groups,
        [container_destination_1.DESTINATION_HEADINGS.personal, personal, audience_label_1.AUDIENCE_LABELS.you],
    ]) {
        if (rows.length === 0)
            continue;
        if (heading !== null)
            lines.push(`### ${heading}`);
        for (const b of rows) {
            // ⚠ Immutable id beside the slug — the slug changes on rename.
            const seenBy = audience ??
                (b.visibility === "private"
                    ? audience_label_1.AUDIENCE_LABELS.you
                    : audience_label_1.AUDIENCE_LABELS.workspace);
            const desc = b.description ? `\n  ${(0, narration_1.inlineOr)(b.description, "")}` : "";
            lines.push(`- ${(0, narration_1.inlineOr)(b.name, narration_1.NO_NAME)} (slug: \`${b.slug}\` · id: \`${b.id}\` · seen by ${seenBy})${desc}`);
        }
        lines.push("");
    }
    lines.push(BASES_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
const TREE_ENTRY_CAP = 400;
const TREE_ENTRY_MAX = 1000;
async function opGetTree(client, ref, entryLimit, entryCursor) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
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
        `## ${(0, narration_1.inlineOr)(tree.base.name, narration_1.NO_NAME)} \`${tree.base.slug}\``,
        `id: \`${tree.base.id}\` · ${vis} · agent-write ${tree.base.agentWriteEnabled ? "on" : "off"}`,
        ...(tree.base.description ? [(0, narration_1.inlineOr)(tree.base.description, "")] : []),
        `Folders: ${tree.folders.length} · Entries: ${entryTotal}${tree.entries.length < entryTotal ? ` (showing ${tree.entries.length})` : ""}`,
        "",
    ];
    const childFolders = new Map();
    for (const f of tree.folders) {
        const arr = childFolders.get(f.parentId) ?? [];
        arr.push(f);
        childFolders.set(f.parentId, arr);
    }
    for (const arr of childFolders.values())
        arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const childEntries = new Map();
    for (const e of tree.entries) {
        const arr = childEntries.get(e.folderId) ?? [];
        arr.push(e);
        childEntries.set(e.folderId, arr);
    }
    for (const arr of childEntries.values())
        arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    function dump(parentId, prefix) {
        for (const f of childFolders.get(parentId) ?? []) {
            lines.push(`${prefix}📁 ${(0, narration_1.inlineOr)(f.name, narration_1.NO_NAME)}/${descSuffix(f.description)}`);
            dump(f.id, prefix + "  ");
        }
        for (const e of childEntries.get(parentId) ?? []) {
            lines.push(`${prefix}📄 ${(0, narration_1.inlineOr)(e.title, narration_1.NO_NAME)}${descSuffix(e.excerpt)}`);
        }
    }
    dump(null, "");
    if (tree.nextEntryCursor) {
        lines.push("", `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`);
    }
    else {
        // ⚠ The paging notice fires only when there IS a next page, so the complete
        // case must state its own scope rather than leave it implied.
        lines.push("", `_Folders complete; entries complete for this base._`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
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
function descSuffix(text) {
    if (!text)
        return "";
    const rendered = (0, narration_1.inlineOr)(text, "");
    return rendered ? ` — ${rendered}` : "";
}
async function opListDir(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const listing = await client.listKbDirByPath(base.id, path ?? "");
    const lines = [];
    const where = listing.folder ? (0, narration_1.inlineOr)(listing.folder.name, narration_1.NO_NAME) : "(root)";
    lines.push(`## ${(0, narration_1.inlineOr)(base.name, narration_1.NO_NAME)} → ${where}`);
    if (listing.folder?.description)
        lines.push((0, narration_1.inlineOr)(listing.folder.description, ""));
    if (listing.folders.length === 0 && listing.entries.length === 0) {
        lines.push("Empty.");
    }
    else {
        for (const f of listing.folders)
            lines.push(`📁 ${(0, narration_1.inlineOr)(f.name, narration_1.NO_NAME)}/${descSuffix(f.description)}`);
        for (const e of listing.entries)
            lines.push(`📄 ${(0, narration_1.inlineOr)(e.title, narration_1.NO_NAME)}${descSuffix(e.excerpt)}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * THE OUTLINE OP — every heading in one entry, with what each costs to read.
 *
 * ⚠ **IT IS A READ THAT DELIBERATELY DOES NOT RETURN THE DOCUMENT.** The body
 * is emptied server-side, so an agent deciding WHETHER to read an entry pays a
 * few dozen characters instead of a few thousand. That is the whole trade, and
 * it is why the routing line names this before `read_file`.
 */
async function opOutline(client, ref, path) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const read = await client.readKbFilePart(base.id, path, { outline: true });
    const outline = read.outline;
    if (!outline || outline.sections.length === 0) {
        // ⚠ NOT AN ERROR, AND IT MUST NOT READ AS ONE. An entry with no headings is
        // the ordinary state of a short note; what the caller needs is the SIZE, so
        // it can decide whether reading the whole thing is cheap.
        return (0, respond_1.ok)([
            `## ${(0, narration_1.inlineOr)(read.entry.title, narration_1.NO_NAME)} — no headings`,
            `Path: \`${path}\` · ${outline?.totalChars ?? 0} chars whole.`,
            "",
            `Nothing to address by section — read it with op="read_file". Entries over ${knowledge_sections_1.KB_SECTION_NUDGE_CHARS} chars should carry \`##\` headings, one topic each.`,
        ].join("\n"));
    }
    return (0, respond_1.ok)([
        (0, knowledge_sections_1.outlineHeading)(read.entry.title, outline),
        `Path: \`${path}\` · Version: \`${read.entry.updatedAt}\``,
        "",
        ...(0, knowledge_sections_1.renderOutline)(outline),
    ].join("\n"));
}
/**
 * ⚠ **THREE WAYS TO SPEND LESS ON ONE DOCUMENT, AND THEY COMPOSE IN ONE ORDER.**
 * `section` picks WHAT (server-side — the rest never crosses the wire), then
 * `offset` and `max_chars` pick how much of that to render. A `section` that
 * does not resolve returns the OUTLINE rather than the document, so the retry
 * costs no round trip.
 */
async function opReadFile(client, ref, path, 
// ⚠ Only the FRAMING reads this — readability is the server's decision and
// it already ran.
callerUserId = null, format, maxChars, section, offset) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    let outline;
    let sectionLine = null;
    let entry;
    if (section === undefined) {
        entry = await client.readKbFileByPath(base.id, path);
    }
    else {
        const read = await client.readKbFilePart(base.id, path, { section });
        entry = read.entry;
        outline = read.outline;
        const found = read.section;
        if (found && found.ok === false) {
            const lines = found.reason === "SECTION_AMBIGUOUS"
                ? (0, knowledge_sections_1.sectionAmbiguous)(section, found.matches)
                : (0, knowledge_sections_1.sectionMiss)(section, outline, entry.title);
            // ⚠ `ok`, NOT `err`: the READ succeeded and the heading did not resolve.
            // An `isError` here would make a client that retries on error retry a
            // call that can only answer the same way.
            return (0, respond_1.ok)(lines.join("\n"));
        }
        if (found && found.ok) {
            // ⚠ NO OUTER BACKTICKS: `inlineOr` already renders a VALUE as code, and
            // wrapping its output again produced ``` ``Errors`` ``` — a heading an
            // agent cannot copy back into `section=`.
            sectionLine = `Section: ${"#".repeat(Math.min(3, found.level))} ${(0, narration_1.inlineOr)(found.heading, narration_1.NO_NAME)} · ${found.chars} of ${outline?.totalChars ?? found.chars} chars (starts at offset ${found.start}).`;
        }
    }
    const { body, notice } = (0, response_size_1.windowBody)(entry.body, offset, maxChars);
    const terse = (0, response_size_1.isConcise)(format);
    const lines = [
        // ⚠ `concise` KEEPS THE VERSION TOKEN AND DROPS THE REST OF THE METADATA.
        // That split is not arbitrary: `write_file` REFUSES without an
        // `expected_version`, so dropping it would make the smaller read unable to
        // feed the write it exists to precede — a knob that quietly costs a round
        // trip is a knob nobody uses twice.
        `# ${(0, narration_1.inlineOr)(entry.title, narration_1.NO_NAME)}`,
        ...(terse
            ? [`Version: \`${entry.updatedAt}\` (pass as expected_version to write_file)`]
            : [
                // ⚠ **THE WHOLE ENTRY'S SIZE AND FINGERPRINT, OFF THE STORED BODY**
                // (S47/S33) — never off `body` above, which a `section`, a `max_chars`
                // or an `offset` may have windowed. A digest that moved with the READ
                // would compare a window to a document. See `body-digest.ts`.
                `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType} · ${(0, body_digest_1.bodyFact)(entry.body)}`,
                `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
            ]),
        ...(sectionLine ? [sectionLine] : []),
        ...(notice ? ["", notice] : []),
        "",
        "---",
        "",
        // ⚠ FENCED, and only for a document this caller did not write. The fence's
        // own header goes first — a caveat read after the injected line has already
        // been read is not a caveat — and the close tag carries a per-response
        // random suffix so the body cannot end its own fence (`untrusted-fence.ts`).
        ...((0, narration_1.isForeignAuthored)(entry, callerUserId)
            ? (0, untrusted_fence_1.fenceBody)(body, "knowledge entry by another member")
            : [body]),
    ];
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opSearch(client, query, base, limit) {
    // ⚠ `base` accepts a slug OR a UUID, but the search endpoint narrows by SLUG
    // only — resolve first; a UUID forwarded to `baseSlug` 404s with
    // KNOWLEDGE_BASE_NOT_FOUND.
    let baseSlug;
    if (base) {
        const resolved = await (0, knowledge_shared_1.resolveBaseOr)(client, base);
        if ((0, channel_shared_1.isErr)(resolved))
            return resolved;
        baseSlug = resolved.slug;
    }
    const hits = await client.searchKb(query, { baseSlug, limit });
    const shownQuery = (0, narration_1.inlineOr)(query, "`(unreadable query)`");
    if (hits.length === 0) {
        return (0, respond_1.ok)(`No matches for ${shownQuery}. ${SEARCH_SCOPE_NOTE}`);
    }
    const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for ${shownQuery}\n`];
    for (const h of hits) {
        // ⚠ Do not turn highlight tags into `**` — that is our own markdown wrapped
        // around an excerpt of a member-authored body on an unframed line.
        const cleanSnippet = (0, narration_1.inlineOr)(h.snippet.replace(/<\/?b>/g, ""), "`(no snippet)`");
        lines.push(`- ${(0, narration_1.inlineOr)(h.title, narration_1.NO_NAME)} _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`);
    }
    lines.push("", SEARCH_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
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
