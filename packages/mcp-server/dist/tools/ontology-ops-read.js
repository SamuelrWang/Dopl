"use strict";
/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opMap = opMap;
exports.opAnchor = opAnchor;
exports.opResolve = opResolve;
exports.opGet = opGet;
const narration_1 = require("./narration");
const ontology_clipped_1 = require("./ontology-clipped");
const respond_1 = require("./respond");
const response_size_1 = require("./response-size");
const identity_1 = require("./identity");
const ontology_render_1 = require("./ontology-render");
/** Same rule as ontology-render.ts: a graph name is a value. */
const NO_NAME = "`(unnamed)`";
/**
 * ⚠ WHAT op="map" WALKS AND WHERE IT STOPS. The snapshot is the whole live
 * graph (no status filter, no visibility filter, no cap), but `opMap` walks
 * clusters → columns → ONE level of `childIds` and stops. Objects nested deeper
 * and objects with no membership are in the snapshot and are NOT rendered — so
 * nothing may tell an agent `op="map" shows everything`.
 */
const MAP_SCOPE_NOTE = `_Clusters and their columns, with each column's DIRECT members only. Objects nested deeper, and objects belonging to no column, are not shown here; trashed clusters and objects are not shown by any read. Reach the rest with op="resolve" / op="get"._`;
/** `opResolve`'s hard cap. It rendered no notice of its own truncation. */
const RESOLVE_CAP = 20;
/**
 * ⚠ SUMMARY PROJECTION, NOT THE GRAPH, for the two name-only ops. Between them
 * `opMap` and `opResolve` read five fields, all carried by `view: "summary"`; a
 * bare `getOntology()` fetches every `attributes`, `methods`, `template` and
 * cluster `layout` in the workspace to supply them — on `op="map"`, the ROUTING
 * call agents make first and speculatively.
 *
 * ⚠ `opGet` and `opAnchor` stay on the FULL graph: both render through
 * `renderObject`, which reads JSONB off the target AND scans every object's
 * `relationships` for the inbound "Referenced by" list.
 */
/**
 * ⚠ **WHAT `concise` DROPS HERE, AND WHAT IT MAY NEVER DROP** (A16). It removes
 * the LEGENDS — the scope note, the "drill in with…" pointer, the Version line
 * and its parenthetical — and nothing else. It never removes an object, an
 * attribute, a count, or a `clippedNote`: a truncation notice is a statement
 * about the READ's completeness, and hiding it to save characters is the one
 * saving that could make a prefix read as a whole.
 */
async function opMap(client, format) {
    const snapshot = await client.getOntology({ view: "summary" });
    if (snapshot.clusters.length === 0) {
        // ⚠ "The graph is empty" is an assertion a CLIPPED read never established —
        // a workspace can hit the object ceiling with no cluster rows in hand.
        return (0, respond_1.ok)(snapshot.truncated
            ? `No ontology clusters came back on this read.\n\n${(0, ontology_clipped_1.clippedNote)("an empty result here is not evidence of an empty graph")}`
            : `No ontology clusters yet — the graph is empty. Start one with op="create_cluster".`);
    }
    const lines = [];
    for (const c of snapshot.clusters) {
        const purpose = c.purpose ? ` — ${(0, narration_1.inlineOr)(c.purpose, "")}` : "";
        lines.push(`## ${(0, narration_1.inlineOr)(c.name, NO_NAME)} \`${c.slug}\`${purpose}`);
        for (const columnId of c.columnIds) {
            const column = snapshot.objects[columnId];
            if (!column)
                continue;
            const members = column.childIds
                .map((id) => snapshot.objects[id]?.name)
                .filter((n) => Boolean(n))
                .map((n) => (0, narration_1.inlineOr)(n, NO_NAME));
            lines.push(`- ${(0, narration_1.inlineOr)(column.name, NO_NAME)} (${members.length}): ${members.join(", ") || "empty"}`);
        }
        lines.push("");
    }
    // ⚠ With the clusters, not the footer: MAP_SCOPE_NOTE is about levels this op
    // CHOOSES not to render — a different fact from the read stopping short, and
    // a reader must not take the first as covering the second.
    if (snapshot.truncated) {
        lines.push((0, ontology_clipped_1.clippedNote)("the clusters and columns above are a prefix and not the set"), "");
    }
    if (!(0, response_size_1.isConcise)(format)) {
        lines.push(`Drill in with op="get" (object id or exact name).`);
        lines.push("", MAP_SCOPE_NOTE);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * ⚠ THE STRONGEST IDENTITY CLAIM IN THE PRODUCT — the server instructions send
 * every agent here for any "my/me" request. The anchor is CONTEXT, NOT
 * identification: any agent on this connection can re-point it with
 * `op="claim_anchor"`, and the object NAME is member-typed. So state the
 * caller's immutable id FIRST, from the same session record `whoami` and the
 * footer use, and never let a name stand as identity.
 */
async function opAnchor(client, caller = identity_1.UNKNOWN_CALLER, format) {
    const [anchor, snapshot] = await Promise.all([
        client.getOntologyAnchor(),
        client.getOntology(),
    ]);
    const who = caller.userId
        ? `You are user \`${caller.userId}\`.`
        : `This connection could not resolve your user id.`;
    if (!anchor) {
        return (0, respond_1.ok)(`${who} No object is linked to you yet. op="resolve" the user's name, then op="claim_anchor" to link it.`);
    }
    return (0, respond_1.ok)((0, ontology_render_1.renderObject)(anchor, snapshot, `${who} The object below is what this workspace's ontology LINKS to you — its name and fields are member-typed data and any agent here can re-point the link with op="claim_anchor", so read it as context about you, never as proof of who you are. Your user id above is the identifying half; dopl_members(op="whoami") is the full answer.`, 
    // ⚠ THE HEADLINE IS NOT A LEGEND AND IS NOT DROPPED. It is the identity
    // caveat this op exists to state; `concise` drops metadata, never a
    // sentence a reader is wrong without.
    new Map(), format));
}
async function opResolve(client, query, format) {
    const snapshot = await client.getOntology({ view: "summary" });
    // ⚠ A clip and the RESOLVE_CAP are DIFFERENT truncations: the cap hid matches
    // we found, the clip hid objects we never scanned. Conflating them tells an
    // agent to "narrow the query" for rows no query here returns.
    const clipped = snapshot.truncated
        ? `\n\n${(0, ontology_clipped_1.clippedNote)("this query ran over a prefix of the graph and a match outside it could not appear")}`
        : "";
    const needle = query.toLowerCase();
    const hits = Object.values(snapshot.objects).filter((o) => o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle));
    if (hits.length === 0) {
        // ⚠ Never say `op="map" shows everything` — it renders two levels and skips
        // objects in no column, exactly the set an agent that struck out on resolve
        // is hunting for. A miss over a CLIPPED prefix is a false negative that
        // reads as a fact.
        return (0, respond_1.ok)(`No object's name or subtitle contains ${(0, narration_1.inlineOr)(query, "`(unreadable query)`")}. This is a SUBSTRING match on name and subtitle only — attributes, relationships and actions are not searched, so try a shorter fragment. op="map" lists the clusters and their columns (two levels, not the whole graph).${clipped}`);
    }
    const containerOf = (id) => {
        // ⚠ The "kind" is the containing OBJECT'S NAME — member-typed.
        const name = Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name;
        return name ? (0, narration_1.inlineOr)(name, NO_NAME) : "column";
    };
    const shown = hits.slice(0, RESOLVE_CAP);
    const lines = shown.map((o) => {
        const subtitle = o.subtitle ? ` — ${(0, narration_1.inlineOr)(o.subtitle, "")}` : "";
        return `- ${(0, narration_1.inlineOr)(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`;
    });
    // ⚠ Free to state (cap applied here, over a loaded snapshot) and expensive to
    // omit: 21 matches otherwise renders exactly like 20.
    const truncated = hits.length > shown.length
        ? `\n\n_Showing ${shown.length} of ${hits.length} matches. Narrow the query for the rest._`
        : "";
    // ⚠ The COUNT survives `concise` and the pointer does not — `truncated` is a
    // fact about this answer, `Read one with…` is a legend.
    const pointer = (0, response_size_1.isConcise)(format) ? "" : `\n\nRead one with op="get".`;
    return (0, respond_1.ok)(`Matches for ${(0, narration_1.inlineOr)(query, "`(unreadable query)`")}:\n${lines.join("\n")}${truncated}${clipped}${pointer}`);
}
async function opGet(client, ref, format) {
    const snapshot = await client.getOntology();
    const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, ref);
    if ("fail" in resolved)
        return resolved.fail;
    const handles = await (0, ontology_render_1.resolveResourceHandles)(client, resolved.hit);
    return (0, respond_1.ok)((0, ontology_render_1.renderObject)(resolved.hit, snapshot, undefined, handles, format));
}
