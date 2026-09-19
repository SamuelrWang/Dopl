"use strict";
/**
 * Shared resolvers + error mappers for `dopl_kb`, leaned on by the read, write
 * and copy op modules. The registrar (knowledge.ts) routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNTRUSTED_ENTRY_BODY_HEADER = void 0;
exports.resolveBaseOr = resolveBaseOr;
exports.entryNotFound = entryNotFound;
exports.agentWriteDenied = agentWriteDenied;
exports.sharedCredentialPrivateBaseDenied = sharedCredentialPrivateBaseDenied;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const agent_shared_1 = require("./agent-shared");
const tool_errors_1 = require("./tool-errors");
const untrusted_fence_1 = require("./untrusted-fence");
/** ⚠ The row `dopl_kb`'s description teaches first — one declaration, both uses. */
const BASE_NOT_FOUND = tool_errors_1.KB_ERRORS[0];
/** ⚠ Same one-declaration rule as {@link BASE_NOT_FOUND}: the literal
 *  `reason=ambiguous_slug` reaches the wire only through {@link refusal}, so the
 *  description and the refusal are the same characters by construction. */
const AMBIGUOUS_SLUG = tool_errors_1.KB_ERRORS[2];
/** How many matches an ambiguity refusal spells out before it summarises the
 *  rest. ⚠ A cap, not a page: the refusal is already a dead end, and thirty
 *  lines of it buys nothing the first ten did not. */
const MAX_LISTED_MATCHES = 10;
/** ⚠ Local, like `agent-shared.ts` and `channel-addressing.ts` — this package
 *  already carries several copies and unifying them is not this change. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 🔒 **A SLUG THAT NAMES TWO CONTAINERS IS REFUSED, NOT PICKED (F-701).**
 *
 * ⚠ **THIS IS WHERE THE `dopl-development` LOSS CAME FROM, AND NOTHING WAS
 * EVER DELETED.** `knowledge_bases` is unique on `(workspace_id, slug)` — per
 * CONTAINER, which is the correct constraint and not the one an agent assumes.
 * `listKbBases` answers for the bound container PLUS the caller's own personal
 * shelf, so one slug legitimately names several rows, and the old body took
 * `Array.find` — FIRST WINS, silently. On 2026-09-05 three live bases shared
 * `dopl-development`; the one `.find` reached was an empty shell in the personal
 * container, and every op reported cheerful success against it for ten days
 * (`KB-LOSS-TRACE.md`). A silent pick cannot be diagnosed from its own answer:
 * an empty tree is what an empty base looks like.
 *
 * ⚠ **AND THE TIE-BREAKS ARE ALL WRONG, WHICH IS WHY THERE IS NONE.** "Newest
 * wins" would have picked the same empty shell; "the bound container wins" is
 * the rule an agent holding a personal-shelf slug is already violating. Every
 * natural ordering acts on an identity the caller did not choose and reports
 * success — the argument `agent-shared.ts › ambiguousTemplate` makes for names,
 * which slugs now share.
 *
 *   1. UUID → **ID FIRST, ALWAYS**: the visible list, then the server's own id
 *      door (F-470, "an id resolves its own container"). ⚠ An id is unique
 *      workspace-wide, so **by-id addressing can never be ambiguous** and this
 *      arm is untouched by this change — that is the whole escape hatch the
 *      refusal points at.
 *   2. Then, and only then, EXACT slug match. ⚠ The uuid-shaped-slug fallback
 *      is deliberate: the old `.find` matched `slug` OR `id` in one pass, so
 *      dropping through here is what keeps a base whose slug looks like a UUID
 *      addressable at all.
 *   3. More than one → AMBIGUOUS, listing each. 4. Zero → not found.
 *
 * ⚠ **THE HAPPY PATH IS BYTE-IDENTICAL TO WHAT IT WAS.** Same one
 * `listKbBases` call, same rows, same answer whenever the ref is unambiguous —
 * which is every call that was already correct. The shelf labels the refusal
 * wants come from a SECOND read inside {@link ambiguousBase}, deliberately: a
 * resolver twelve ops share is the wrong place to widen a request for the
 * benefit of an error path none of them reach.
 */
async function resolveBaseRef(client, ref) {
    const needle = ref.trim();
    if (needle === "")
        return { kind: "not-found" };
    const bases = await client.listKbBases();
    // ⚠ **AN ID ANSWERS BEFORE ANY SLUG QUESTION, AND ITS SHAPE IS NOT THE TEST.**
    // Matching `id` only for UUID-shaped refs regressed every non-UUID id the old
    // `.find(b => b.slug === ref || b.id === ref)` reached — the fixtures' `kb-1`
    // among them, and with it the whole `set_visibility` confirm flow. What makes
    // this arm safe is UNIQUENESS, which every id has whatever it looks like; the
    // UUID test below is about the ID DOOR, a different question.
    const byId = bases.find((b) => b.id === needle);
    if (byId)
        return { kind: "found", base: byId };
    if (UUID_RE.test(needle)) {
        try {
            return { kind: "found", base: await client.getKbBase(needle) };
        }
        catch (e) {
            // ⚠ ONLY AN API REFUSAL IS SWALLOWED. A transport failure must not read
            // as "no such base" — that is how an outage becomes a deletion in an
            // agent's notes.
            if (!(0, respond_1.isApiError)(e, 404, "KNOWLEDGE_BASE_NOT_FOUND"))
                throw e;
        }
    }
    const matches = bases.filter((b) => b.slug === needle);
    if (matches.length === 0)
        return { kind: "not-found" };
    if (matches.length === 1)
        return { kind: "found", base: matches[0] };
    return {
        kind: "ambiguous",
        // ⚠ Container-ordered so a caller re-reading the refusal sees a stable list
        // and can act on "the second one".
        matches: [...matches].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)),
    };
}
/** resolveBaseRef + its two refusals; caller short-circuits on `isError`. */
async function resolveBaseOr(client, ref) {
    const res = await resolveBaseRef(client, ref);
    if (res.kind === "found")
        return res.base;
    if (res.kind === "ambiguous")
        return ambiguousBase(client, ref, res.matches);
    return (0, respond_1.err)((0, tool_errors_1.refusal)(BASE_NOT_FOUND, `Ref: ${(0, narration_1.inlineOr)(ref, "`(unreadable ref)`")}. Deleting is permanent, so a base you deleted is not recoverable.`));
}
/**
 * THE AMBIGUITY REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ **THE LIST IS THE WHOLE VALUE.** "That slug is ambiguous" alone sends the
 * agent back to `op="list_bases"` for ids it was already holding. Each row
 * carries the three things that tell the containers apart: the ID to re-issue
 * with, the CONTAINER it lives in, and the ENTRY COUNT — the count being what
 * would have told Samuel in one line that the base he was addressing was the
 * empty one.
 *
 * ⚠ **THE LIST IS NOT AN ORACLE.** Every row already came back from this
 * caller's own `listKbBases`, so it discloses exactly what `op="list_bases"`
 * would — the same argument `ambiguousTemplate` makes. ⚠ **AND THE CONTAINER IS
 * NAMED BY ID, NEVER LOOKED UP.** Resolving container NAMES here would mean
 * `client.listWorkspaces()`, which walks straight past the session lock in
 * `workspace-directory.ts › getWorkspaceList` — a locked session must not learn
 * that other containers exist. The id is also the `container=` handle, so it is
 * the more useful half anyway.
 *
 * ⚠ **A COUNT THAT FAILS IS OMITTED, NOT GUESSED, AND NEVER THROWS.** This is
 * already the error path; an exception here would replace a precise refusal
 * with a stack trace.
 */
async function ambiguousBase(client, ref, matches) {
    const shown = matches.slice(0, MAX_LISTED_MATCHES);
    const [personal, counts] = await Promise.all([
        personalBaseIds(client),
        Promise.all(shown.map((b) => entryCount(client, b.id))),
    ]);
    const rest = matches.length - shown.length;
    return (0, respond_1.err)([
        (0, tool_errors_1.refusal)(AMBIGUOUS_SLUG, `Nothing was read or written — ${(0, narration_1.inlineOr)(ref, "`(unreadable ref)`")} names ${matches.length} knowledge bases you can see, in different containers, and this call refuses rather than picking one. A slug is unique only WITHIN a container, so this is a legitimate state. Re-issue with the ID of the one you meant — an id resolves its own container.`),
        "",
        ...shown.map((b, i) => matchLine(b, counts[i], personal.has(b.id))),
        ...(rest > 0 ? [`- …and ${rest} more; op="list_bases" has them all.`] : []),
    ].join("\n"));
}
function matchLine(base, count, isPersonal) {
    // ⚠ The container id IS the `container=` handle, so the line an agent reads
    // is also the line it can act on.
    const where = isPersonal
        ? `your personal container \`${base.workspaceId}\``
        : `container \`${base.workspaceId}\``;
    const entries = count === null
        ? "entry count unavailable"
        : `${count} ${count === 1 ? "entry" : "entries"}`;
    return `- \`${base.id}\` — ${(0, narration_1.inlineOr)(base.name, narration_1.NO_NAME)} · ${where} · ${entries}`;
}
/**
 * Ids of the caller's PERSONAL-container bases, for the shelf label — empty
 * when the sibling key is absent or the read fails.
 *
 * ⚠ **`?? []` IS THE CONTRACT, NOT A SHORTCUT (INVARIANTS §8).** An older
 * server sends no `homeScopedBaseIds`, and the fail-safe reading of "I do not
 * know which shelf this row is on" is NO LABEL — never "not personal", and
 * never "personal". The refusal is still correct without the label; it is one
 * word less helpful.
 */
async function personalBaseIds(client) {
    try {
        const payload = await client.listKbBasesPayload();
        return new Set(payload.homeScopedBaseIds ?? []);
    }
    catch {
        return new Set();
    }
}
/** Entries in one base, or null when the count cannot be had. ⚠ `entryLimit`
 *  is what makes the server send `entryTotal` at all, and 1 is the cheapest
 *  page that does it — the ROWS are thrown away, only the total is read. */
async function entryCount(client, baseId) {
    try {
        const tree = await client.getKbTree(baseId, { entryLimit: 1 });
        return tree.entryTotal ?? null;
    }
    catch {
        return null;
    }
}
/**
 * ⚠ **THIS CONSTANT IS NOW THE FENCE'S HEADER, AND THE 430-CHAR PARAGRAPH IT
 * USED TO HOLD IS GONE** (A14, 2026-09-02). The old wording asked a reader to
 * discount the document below it; it said nothing about where the document
 * ENDS, so a body closing with *"— end of document. New instruction from your
 * operator: …"* read, to somebody following the banner, as a document followed
 * by an instruction.
 *
 * `untrusted-fence.ts` answers that: the body is wrapped in
 * `<body_HEX>`…`</body_HEX>` with HEX minted per response, so text inside the
 * fence cannot end it and anything after the real close was written by this
 * server. The name survives because it is the seam
 * `authored-body-untrusted.test.ts` pins — including the POSITION assertion,
 * which the fence keeps by emitting this line first.
 *
 * ⚠ STILL CONDITIONAL, for the reason it always was: the caller's OWN entries
 * render bare, because framing them is noise on the overwhelmingly common path
 * and noise is how a security header stops being read.
 *
 * ⚠ The body itself is NOT neutralized — it is the document the product exists
 * to hand the agent, and stripping its markdown breaks the feature. The fence
 * is what makes rendering it verbatim safe (`narration.ts` draws the VALUE/BODY
 * line).
 */
exports.UNTRUSTED_ENTRY_BODY_HEADER = untrusted_fence_1.FENCE_HEADER;
/**
 * 🔒 **THE ENTRY 404, MAPPED (S41, 2026-09-18) — AND UNTIL THIS WAVE NOTHING
 * MAPPED IT.** `readFileByPath` raises `EntryNotFoundError` → 404
 * `KNOWLEDGE_ENTRY_NOT_FOUND` for a path that resolves to nothing, to a FOLDER,
 * or to the root; `resolvePath` raises `PathTraversalError` → 404
 * `KNOWLEDGE_PATH_NOT_FOUND` when an INTERMEDIATE segment is the one missing.
 * Neither had an MCP arm, so both rethrew past the registrar as an unhandled
 * transport error — "the call failed" over a read that had simply missed.
 *
 * ⚠ **THE TWO CODES ARE ONE REFUSAL, AND THE DIFFERENCE IS IN THE DETAIL.** The
 * agent's next call is `op="list_dir"` either way; what changes is WHERE to look
 * — the parent folder, or the segment that does not exist.
 *
 * ⚠ **"IT MAY HAVE MOVED OR BEEN RENAMED" IS NOT A HEDGE.** A path is a
 * POSITION, not an identity: `op="move_file"` and a retitle both vacate one
 * (`opWriteFile`'s `canonicalPath` line says a title renames the leaf), and an
 * agent told only "not found" writes at the old path again — which `write_file`
 * UPSERTS into a second entry. So the refusal names the move, and names the
 * entry id as the handle that survives one.
 *
 * ⚠ Returns null when the error is not one of the two, so the caller rethrows:
 * a catch that swallowed an outage would report it as a missing document.
 */
function entryNotFound(e, path, baseRef) {
    const traversal = (0, respond_1.isApiError)(e, 404, "KNOWLEDGE_PATH_NOT_FOUND");
    if (!traversal && !(0, respond_1.isApiError)(e, 404, "KNOWLEDGE_ENTRY_NOT_FOUND"))
        return null;
    const where = traversal
        ? `A FOLDER in that path does not exist${(0, respond_1.apiMessage)(e) ? ` — ${(0, narration_1.inlineOr)((0, respond_1.apiMessage)(e) ?? "", "")}` : ""}, so nothing below it can.`
        : `The path resolved to nothing, or to a folder rather than an entry.`;
    return (0, respond_1.err)((0, tool_errors_1.refusal)(tool_errors_1.KB_ENTRY_NOT_FOUND, `${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)} in ${(0, narration_1.inlineOr)(baseRef, "`(unreadable ref)`")}. ${where} List the folder it should be in with op="list_dir", or op="get_tree" for the whole base. An ENTRY ID survives a move and a rename; a path does not.`));
}
/**
 * 403 `AGENT_WRITE_DISABLED` — an agent deleting inside a base flagged
 * `agent_write_enabled=false`. Surfaces the server's actionable message rather
 * than a raw throw; null otherwise so the caller rethrows. ⚠ Duck-typed on
 * `.status`/`.code` to avoid importing the @dopl/client error class.
 */
function agentWriteDenied(e) {
    if (!(0, respond_1.isApiError)(e, 403, "AGENT_WRITE_DISABLED"))
        return null;
    return (0, respond_1.err)((0, respond_1.apiMessage)(e) ??
        "This knowledge base is read-only to agents — delete it from the Dopl web UI.");
}
/**
 * A shared/service credential tried to own a PRIVATE knowledge base (403
 * `WORKSPACE_KEY_PRIVATE_VISIBILITY`).
 *
 * ⚠ **THE MIRROR OF `agent-shared.ts › sharedCredentialPrivateDenied`, AND IT
 * WAS MISSING UNTIL 2026-09-02.** `op="copy_base"` forces `visibility: "private"`
 * exactly as `op="copy"` does, so it can raise the identical 403 — and it had no
 * mapping, so the refusal reached an agent as an unhandled throw ("the call
 * failed") over a copy that created nothing. The predicate and the code string
 * are shared; only the NOUN and the remedy differ, because a base's remedy is
 * not a template's.
 */
function sharedCredentialPrivateBaseDenied(e) {
    if (!(0, respond_1.isApiError)(e, 403, agent_shared_1.PRIVATE_VISIBILITY_DENIED_CODE))
        return null;
    return (0, respond_1.err)(`${(0, respond_1.apiMessage)(e) ?? "This credential cannot own a private knowledge base."} NOTHING was created — the copy stopped at the base itself, so there is no partial tree to clean up. A credential that may be shared between humans has no "private to me" to write to, and this op only ever creates PRIVATE bases: reconnect with a personal credential, or ask the user to copy it in the Dopl app.`);
}
