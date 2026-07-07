"use strict";
/**
 * `dopl_ontology` — the workspace object graph as a ROUTING layer.
 * Read-only (edited in the web UI). The intended funnel: anchor (who is
 * calling) → map (which cluster) → resolve (which objects) → get (the
 * object's attributes, relationships, and action recipes, with linked
 * knowledge/skills resolved to addressable handles).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOntologyTool = registerOntologyTool;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const ONTOLOGY_DESCRIPTION = `The workspace ontology — typed objects (people, teams, clients, policies, documents) organized in clusters, with attributes, relationships, and action recipes. Use it to LOOK UP identity, context, and how work gets done here instead of inferring. Set \`op\` to one of:
- "map" — clusters and their columns (compact). Call first to route.
- "anchor" — the object representing the CALLER (the authenticated user), with its relationships. Start here for any "my/me" request; if no anchor exists, fall back to op=resolve on the user's name.
- "resolve" — find objects by name/description match. Returns ids for op=get.
- "get" — one object in full: attributes (linked knowledge bases / skills resolved to slugs you can open with dopl_kb / dopl_skill), relationships with target names, nested objects, and its ACTIONS — each action lists exactly what to pull before executing. Requires: object (id, or exact name).
Read-only; the graph is edited in the Dopl web UI.`;
function registerOntologyTool(register, client) {
    register("dopl_ontology", ONTOLOGY_DESCRIPTION, {
        op: zod_1.z.enum(["map", "anchor", "resolve", "get"]).describe("Operation to perform."),
        query: zod_1.z.string().optional().describe("op=resolve: name/description text to match."),
        object: zod_1.z.string().optional().describe("op=get: object id (preferred) or exact name."),
    }, async (args) => {
        switch (args.op) {
            case "map":
                return opMap(client);
            case "anchor":
                return opAnchor(client);
            case "resolve": {
                const miss = (0, respond_1.missingParams)("resolve", args, ["query"]);
                if (miss)
                    return miss;
                return opResolve(client, args.query);
            }
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["object"]);
                if (miss)
                    return miss;
                return opGet(client, args.object);
            }
        }
    });
}
async function opMap(client) {
    const snapshot = await client.getOntology();
    if (snapshot.clusters.length === 0) {
        return (0, respond_1.ok)("No ontology clusters yet — the graph is empty.");
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
        return (0, respond_1.ok)("No object is linked to the calling user yet. Ask the user who they are in this ontology, then op=resolve their name — or have them link their object in the Dopl web UI.");
    }
    return (0, respond_1.ok)(renderObject(anchor, snapshot, "You are anchored to this object."));
}
async function opResolve(client, query) {
    const snapshot = await client.getOntology();
    const needle = query.toLowerCase();
    const hits = Object.values(snapshot.objects).filter((o) => o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle));
    if (hits.length === 0) {
        return (0, respond_1.ok)(`No objects match "${query}". op="map" shows everything.`);
    }
    const lines = hits
        .slice(0, 20)
        .map((o) => `- **${o.name}** (${o.type} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`);
    return (0, respond_1.ok)(`Matches for "${query}":\n${lines.join("\n")}\n\nRead one with op="get".`);
}
async function opGet(client, ref) {
    const snapshot = await client.getOntology();
    const object = snapshot.objects[ref] ??
        Object.values(snapshot.objects).find((o) => o.name.toLowerCase() === ref.toLowerCase());
    if (!object) {
        return (0, respond_1.err)(`No object \`${ref}\`. Find ids with op="resolve" or op="map".`);
    }
    const resolved = await resolveResourceHandles(client, object);
    return (0, respond_1.ok)(renderObject(object, snapshot, undefined, resolved));
}
async function resolveResourceHandles(client, object) {
    const wanted = new Set(object.attributes.flatMap((a) => a.value.kind === "knowledge" || a.value.kind === "skill" ? a.value.value : []));
    const handles = new Map();
    if (wanted.size === 0)
        return handles;
    const [bases, skills] = await Promise.all([
        client.listKbBases().catch(() => []),
        client.listSkills().catch(() => []),
    ]);
    for (const b of bases) {
        if (wanted.has(b.id))
            handles.set(b.id, { name: b.name, slug: b.slug, kind: "kb" });
    }
    for (const s of skills) {
        if (wanted.has(s.id))
            handles.set(s.id, { name: s.name, slug: s.slug, kind: "skill" });
    }
    return handles;
}
function renderObject(object, snapshot, headline, handles = new Map()) {
    const nameOf = (id) => snapshot.objects[id]?.name ?? id;
    const lines = [];
    if (headline)
        lines.push(headline, "");
    lines.push(`# ${object.name} (${object.type} · id: \`${object.id}\`)`);
    if (object.subtitle)
        lines.push(object.subtitle);
    if (object.attributes.length > 0) {
        lines.push("", "## Attributes");
        for (const attr of object.attributes) {
            lines.push(`- ${attr.label}: ${renderValue(attr.value, nameOf, handles)}`);
        }
    }
    if (object.relationships.length > 0) {
        lines.push("", "## Relationships");
        for (const rel of object.relationships) {
            lines.push(`- ${rel.label}: ${rel.targetIds.map(nameOf).join(", ")}`);
        }
    }
    if (object.childIds.length > 0) {
        lines.push("", "## Objects inside");
        for (const id of object.childIds) {
            const child = snapshot.objects[id];
            if (child)
                lines.push(`- **${child.name}** (${child.type} · id: \`${id}\`)`);
        }
    }
    if (object.methods.length > 0) {
        lines.push("", "## Actions");
        for (const m of object.methods) {
            lines.push(`### ${m.name}`);
            if (m.description)
                lines.push(m.description);
            if (m.requires.length > 0) {
                lines.push(`Pulls: ${m.requires.map((r) => `\`${r}\``).join(" · ")}`);
            }
        }
    }
    return lines.join("\n");
}
function renderValue(value, nameOf, handles) {
    switch (value.kind) {
        case "text":
        case "pill":
            return value.value || "—";
        case "ref":
            return value.value.map(nameOf).join(", ") || "—";
        case "knowledge":
        case "skill":
            return (value.value
                .map((id) => {
                const h = handles.get(id);
                if (!h)
                    return id;
                const opener = h.kind === "kb"
                    ? `dopl_kb op="get_tree" base="${h.slug}"`
                    : `dopl_skill op="get" slug="${h.slug}"`;
                return `**${h.name}** (${opener})`;
            })
                .join(", ") || "—");
    }
}
