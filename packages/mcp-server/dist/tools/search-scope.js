"use strict";
/**
 * One scope's search — four MCP-native reads plus the app's own search (DMP-004) — shared by `dopl_search`'s single-scope path and every
 * `scope="everywhere"` leg (P8-10). Only the renderers differ; what is read, matched, capped and
 * reported as partial is decided here once.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONTOLOGY_CLIPPED_NOTE = exports.APP_READ_LABEL = exports.APP_GROUP_ORDER = exports.SEARCH_READ_COUNT = void 0;
exports.termMatcher = termMatcher;
exports.searchScope = searchScope;
exports.snippet = snippet;
exports.entryAddress = entryAddress;
exports.more = more;
const agent_shared_js_1 = require("./agent-shared.js");
const narration_js_1 = require("./narration.js");
const ontology_clipped_js_1 = require("./ontology-clipped.js");
const partial_read_js_1 = require("./partial-read.js");
/** The `partialRead` denominator — READS, not groups: the fifth read (the app's search) answers six. */
exports.SEARCH_READ_COUNT = 5;
/** The app-search groups this tool renders, in the popup's order. Knowledge, skills and identities
 *  come from the four MCP-native reads (entries match on BODIES there, titles only in the app). */
exports.APP_GROUP_ORDER = ["channels", "messages", "threads", "artifacts", "members", "chats"];
exports.APP_READ_LABEL = "Channels, messages, threads, artifacts, members and chats";
const EMPTY_APP = { q: "", scope: "container", tookMs: 0, groups: [] };
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
const EMPTY_IDENTITIES = { identities: [] };
const EMPTY_IDS = Object.freeze([]);
/**
 * Tokenize + punctuation-fold the query so "duplicate name" matches "duplicate-name", word order is
 * free and every term must appear. A whitespace- or punctuation-only query matches nothing.
 * Governs skills / objects / identities only — knowledge uses the backend hybrid search.
 */
function termMatcher(query) {
    const fold = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const terms = fold(query).split(" ").filter(Boolean);
    return (...fields) => {
        if (terms.length === 0)
            return false;
        const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
        return terms.every((t) => hay.includes(t));
    };
}
const cap = (all, limit) => ({
    hits: all.slice(0, limit),
    matched: all.length,
});
/**
 * Search the scope the client is currently addressed to. Fail-soft per group: a failed read
 * renders like an empty one, so `notice` must name it.
 */
async function searchScope(client, opts) {
    const { query, limit, matches } = opts;
    const reads = (0, partial_read_js_1.partialRead)();
    const [entryHits, skills, ontology, identityPayload, appSearch] = await Promise.all([
        reads.soft("Knowledge entries", client.searchKb(query, { limit }), []),
        reads.soft("Skills", client.listSkills(), []),
        // Summary projection: the graph's JSONB columns are ~8× the bytes and none are read here.
        reads.soft("Ontology objects", client.getOntology({ view: "summary" }), EMPTY_ONTOLOGY),
        // No `shelf` filter: a find surface searches both shelves.
        reads.soft("Agent identities", client.listAgentIdentitiesPayload(), EMPTY_IDENTITIES),
        // ONE implementation: the popup's own server search, fenced by the caller's memberships and lock.
        opts.containerId
            ? reads.soft(exports.APP_READ_LABEL, 
            // Deferred, so even a synchronous throw is a named partial read, not a failed search.
            Promise.resolve().then(() => client.searchContainer(query, opts.containerId)), EMPTY_APP)
            : Promise.resolve(EMPTY_APP),
    ]);
    const byKind = new Map((appSearch.groups ?? []).map((g) => [g.kind, g]));
    const objects = Object.values(ontology.objects);
    // Absent key (older server) groups nothing as personal.
    const personalIds = new Set(identityPayload.homeScopedIdentityIds ?? EMPTY_IDS);
    return {
        entries: entryHits.slice(0, limit),
        skills: cap(skills.filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse)), limit),
        objects: cap(objects.filter((o) => matches(o.name, o.subtitle)), limit),
        // Name + description only, never `instructions`: another member's prompt must not decide
        // which identity a stranger's agent surfaces.
        identities: cap(identityPayload.identities.filter((ident) => matches(ident.name, ident.description)), limit),
        app: exports.APP_GROUP_ORDER.flatMap((k) => {
            const g = byKind.get(k);
            return g ? [{ ...g, items: g.items.slice(0, limit) }] : [];
        }),
        appSearched: opts.containerId !== null,
        ontologyTruncated: ontology.truncated === true,
        containerOf: (id) => {
            const name = objects.find((c) => c.childIds.includes(id))?.name;
            return name ? (0, narration_js_1.inlineOr)(name, narration_js_1.NO_NAME) : "object";
        },
        audienceOf: (ident) => (0, agent_shared_js_1.identityAudience)(ident, {
            personal: personalIds.has(ident.id),
            inHomeChannel: opts.inHomeChannel,
        }),
        notice: reads.notice(opts.containerId ? exports.SEARCH_READ_COUNT : exports.SEARCH_READ_COUNT - 1, "reads"),
    };
}
/** Beside the ontology group when its read was clipped; a capped group is `more()`'s, not this. */
exports.ONTOLOGY_CLIPPED_NOTE = (0, ontology_clipped_js_1.clippedNote)("the ontology group searched a prefix of the graph and a match outside it could not appear");
/** A knowledge-entry snippet as a VALUE: highlight tags dropped (never turned into markdown), neutralized. */
function snippet(raw) {
    return (0, narration_js_1.inlineOr)(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}
/** The address `dopl_kb(op="read_file")` takes; `baseSlug`/`path` are absent on an older server (§8). */
function entryAddress(h) {
    const where = h.path
        ? `${h.baseSlug ? `base \`${h.baseSlug}\` · ` : ""}path ${(0, narration_js_1.inlineOr)(h.path, "`(unreadable path)`")} · `
        : "";
    return `${where}entry id: \`${h.entryId}\``;
}
/** "Showing N of M" for a capped group, or nothing. */
function more(group, noun) {
    return group.matched > group.hits.length
        ? [
            `_Showing ${group.hits.length} of ${group.matched} matching ${noun}. Raise \`limit\` or narrow the query._`,
        ]
        : [];
}
