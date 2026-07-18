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
        const containerOf = (id) => Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name ?? "column";
        const list = matches.map((o) => `\`${o.id}\` (${containerOf(o.id)})`).join(", ");
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
    // Leftover ids are entry-level knowledge refs — hunt them in the
    // accessible bases' trees and hand back a read_file-addressable path.
    const unresolved = [...wanted].filter((id) => !handles.has(id));
    if (unresolved.length === 0)
        return handles;
    const trees = await Promise.all(bases.map((b) => client.getKbTree(b.id).catch(() => null)));
    for (const tree of trees) {
        if (!tree)
            continue;
        const folderById = new Map(tree.folders.map((f) => [f.id, f]));
        for (const entry of tree.entries) {
            if (!unresolved.includes(entry.id))
                continue;
            const segments = [entry.title];
            for (let folder = entry.folderId ? folderById.get(entry.folderId) : undefined; folder; folder = folder.parentId ? folderById.get(folder.parentId) : undefined) {
                segments.unshift(folder.name);
            }
            handles.set(entry.id, {
                name: `${tree.base.name} / ${entry.title}`,
                slug: tree.base.slug,
                kind: "kb-entry",
                path: segments.join("/"),
            });
        }
    }
    return handles;
}
function renderObject(object, snapshot, headline, handles = new Map()) {
    const nameOf = (id) => snapshot.objects[id]?.name ?? id;
    // What the object IS = the name of its container (its column, or the
    // object it's nested in); top-level containers read as "column".
    const container = Object.values(snapshot.objects).find((o) => o.childIds.includes(object.id));
    const kindLabel = container?.name || "column";
    const lines = [];
    if (headline)
        lines.push(headline, "");
    lines.push(`# ${object.name} (${kindLabel} · id: \`${object.id}\`)`);
    if (object.subtitle)
        lines.push(object.subtitle);
    if (object.updatedAt) {
        lines.push(`Version: \`${object.updatedAt}\` (pass as expected_version to a later write so a concurrent edit can't clobber yours)`);
    }
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
    // Inbound edges ("Referenced by"): other objects whose relationships point
    // AT this one. `get` otherwise shows only outbound edges, hiding who
    // depends on this object.
    const backlinks = [];
    for (const other of Object.values(snapshot.objects)) {
        if (other.id === object.id)
            continue;
        for (const rel of other.relationships) {
            if (rel.targetIds.includes(object.id)) {
                backlinks.push(`- **${other.name}** —${rel.label}→ (id: \`${other.id}\`)`);
            }
        }
    }
    if (backlinks.length > 0) {
        lines.push("", "## Referenced by", ...backlinks);
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
                lines.push(`- **${child.name}** (id: \`${id}\`)`);
        }
    }
    if (object.methods.length > 0) {
        lines.push("", "## Actions");
        for (const m of object.methods) {
            lines.push(`### ${m.name}`);
            if (m.description)
                lines.push(m.description);
            if (m.outcome) {
                lines.push(`Outcome: ${m.outcome}`);
            }
            if (m.tools) {
                lines.push(`Tools: ${m.tools}`);
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
                    : h.kind === "kb-entry"
                        ? `dopl_kb op="read_file" base="${h.slug}" path="${h.path}"`
                        : `dopl_skill op="get" slug="${h.slug}"`;
                return `**${h.name}** (${opener})`;
            })
                .join(", ") || "—");
    }
}
