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
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
/** Same rule as ontology-render.ts: a graph name is a value. */
const NO_NAME = "`(unnamed)`";
async function opMap(client) {
    const snapshot = await client.getOntology();
    if (snapshot.clusters.length === 0) {
        return (0, respond_1.ok)(`No ontology clusters yet — the graph is empty. Start one with op="create_cluster".`);
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
    lines.push(`Drill in with op="get" (object id or exact name).`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opAnchor(client) {
    const [anchor, snapshot] = await Promise.all([
        client.getOntologyAnchor(),
        client.getOntology(),
    ]);
    if (!anchor) {
        return (0, respond_1.ok)(`No object is linked to the calling user yet. op="resolve" the user's name, then op="claim_anchor" to link it.`);
    }
    return (0, respond_1.ok)((0, ontology_render_1.renderObject)(anchor, snapshot, "You are anchored to this object."));
}
async function opResolve(client, query) {
    const snapshot = await client.getOntology();
    const needle = query.toLowerCase();
    const hits = Object.values(snapshot.objects).filter((o) => o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle));
    if (hits.length === 0) {
        return (0, respond_1.ok)(`No objects match ${(0, narration_1.inlineOr)(query, "`(unreadable query)`")}. op="map" shows everything.`);
    }
    const containerOf = (id) => {
        // The "kind" is the containing OBJECT'S NAME, member-typed like any other.
        const name = Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name;
        return name ? (0, narration_1.inlineOr)(name, NO_NAME) : "column";
    };
    const lines = hits
        .slice(0, 20)
        .map((o) => {
        const subtitle = o.subtitle ? ` — ${(0, narration_1.inlineOr)(o.subtitle, "")}` : "";
        return `- ${(0, narration_1.inlineOr)(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`;
    });
    return (0, respond_1.ok)(`Matches for ${(0, narration_1.inlineOr)(query, "`(unreadable query)`")}:\n${lines.join("\n")}\n\nRead one with op="get".`);
}
async function opGet(client, ref) {
    const snapshot = await client.getOntology();
    const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, ref);
    if ("fail" in resolved)
        return resolved.fail;
    const handles = await (0, ontology_render_1.resolveResourceHandles)(client, resolved.hit);
    return (0, respond_1.ok)((0, ontology_render_1.renderObject)(resolved.hit, snapshot, undefined, handles));
}
