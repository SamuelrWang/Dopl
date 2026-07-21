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
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
async function opMap(client) {
    const snapshot = await client.getOntology();
    if (snapshot.clusters.length === 0) {
        return (0, respond_1.ok)(`No ontology clusters yet — the graph is empty. Start one with op="create_cluster".`);
    }
    const lines = [];
    for (const c of snapshot.clusters) {
        lines.push(`## ${c.name} \`${c.slug}\`${c.purpose ? ` — ${c.purpose}` : ""}`);
        for (const columnId of c.columnIds) {
            const column = snapshot.objects[columnId];
            if (!column)
                continue;
            const members = column.childIds
                .map((id) => snapshot.objects[id]?.name)
                .filter(Boolean);
            lines.push(`- **${column.name}** (${members.length}): ${members.join(", ") || "empty"}`);
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
        return (0, respond_1.ok)(`No objects match "${query}". op="map" shows everything.`);
    }
    const containerOf = (id) => Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name;
    const lines = hits
        .slice(0, 20)
        .map((o) => {
        const kind = containerOf(o.id) ?? "column";
        return `- **${o.name}** (${kind} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`;
    });
    return (0, respond_1.ok)(`Matches for "${query}":\n${lines.join("\n")}\n\nRead one with op="get".`);
}
async function opGet(client, ref) {
    const snapshot = await client.getOntology();
    const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, ref);
    if ("fail" in resolved)
        return resolved.fail;
    const handles = await (0, ontology_render_1.resolveResourceHandles)(client, resolved.hit);
    return (0, respond_1.ok)((0, ontology_render_1.renderObject)(resolved.hit, snapshot, undefined, handles));
}
