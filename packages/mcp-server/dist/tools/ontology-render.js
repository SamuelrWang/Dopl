"use strict";
/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveObjectRef = resolveObjectRef;
exports.resolveClusterRef = resolveClusterRef;
exports.resolveResourceHandles = resolveResourceHandles;
exports.renderObject = renderObject;
const respond_1 = require("./respond");
function resolveObjectRef(snapshot, ref) {
    const byId = snapshot.objects[ref];
    if (byId)
        return { hit: byId };
    const needle = ref.toLowerCase();
    const matches = Object.values(snapshot.objects).filter((o) => o.name.toLowerCase() === needle);
    if (matches.length === 1)
        return { hit: matches[0] };
    if (matches.length > 1) {
        const list = matches.map((o) => `\`${o.id}\` (${o.type})`).join(", ");
        return { fail: (0, respond_1.err)(`Multiple objects named "${ref}" — use an id: ${list}`) };
    }
    return {
        fail: (0, respond_1.err)(`No object \`${ref}\`. Find ids with op="resolve" or op="map".`),
    };
}
function resolveClusterRef(snapshot, ref) {
    const needle = ref.toLowerCase();
    const hit = snapshot.clusters.find((c) => c.id === ref || c.slug === ref || c.name.toLowerCase() === needle);
    if (hit)
        return { hit };
    const known = snapshot.clusters.map((c) => `\`${c.slug}\``).join(", ") || "none";
    return { fail: (0, respond_1.err)(`No cluster \`${ref}\`. Known clusters: ${known}.`) };
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
    if ((object.template ?? []).length > 0) {
        lines.push("", "## Default fields (template)", "_New objects created inside this one are born with these fields, empty:_");
        for (const f of object.template) {
            lines.push(`- ${f.label} (${f.kind})`);
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
