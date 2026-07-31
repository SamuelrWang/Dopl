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
const narration_1 = require("./narration");
const respond_1 = require("./respond");
/**
 * THE ONTOLOGY IS THE ONE DOMAIN WHERE THE VALUE/BODY LINE HAD TO BE DRAWN
 * TWICE, so it is written down here.
 *
 * The graph is workspace-scoped: any member creates clusters, columns, objects,
 * attributes, relationships and actions, and every member reads them. Nothing
 * in `features/ontology/schema.ts` carries a charset rule — object `name` is
 * `max(300)`, `subtitle` `max(1000)`, an attribute `label` `max(200)`, a
 * method `name` `max(300)` — so newlines and `##` are legal in all of them.
 *
 *   - NAMES and LABELS are values. `# ${object.name}` and `### ${m.name}` were
 *     real markdown headings built from member-typed strings, and the "kind"
 *     in the headline is not a kind the server assigned — it is the CONTAINING
 *     OBJECT'S NAME, equally member-typed. All neutralized.
 *
 *   - PROSE the agent is meant to act on is NOT neutralized: a `text`
 *     attribute value (up to 4000 chars), and an action's description /
 *     outcome / tools. Those are the routing instructions the ontology exists
 *     to carry — clipping them to 160 characters would delete the feature.
 *     They are {@link indented} instead, which is the cheaper half of the
 *     channel body treatment: a newline inside them can no longer put an
 *     attacker's text at the START of a line, so it cannot open a heading, a
 *     list item, or a quote block.
 */
const NO_NAME = "`(unnamed)`";
/**
 * Multi-line prose rendered UNDER the line that introduces it, every
 * continuation line indented two spaces. Content survives verbatim; what it
 * loses is the ability to begin a line of the result.
 */
function indented(text) {
    return text
        .split(/\r?\n/)
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join("\n");
}
function resolveObjectRef(snapshot, ref) {
    const byId = snapshot.objects[ref];
    if (byId)
        return { hit: byId };
    const needle = ref.toLowerCase();
    const matches = Object.values(snapshot.objects).filter((o) => o.name.toLowerCase() === needle);
    if (matches.length === 1)
        return { hit: matches[0] };
    if (matches.length > 1) {
        const containerOf = (id) => {
            const name = Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name;
            return name ? (0, narration_1.inlineOr)(name, NO_NAME) : "column";
        };
        const list = matches.map((o) => `\`${o.id}\` (${containerOf(o.id)})`).join(", ");
        return {
            fail: (0, respond_1.err)(`Multiple objects named ${(0, narration_1.inlineOr)(ref, NO_NAME)} — use an id: ${list}`),
        };
    }
    return {
        fail: (0, respond_1.err)(`No object ${(0, narration_1.inlineOr)(ref, NO_NAME)}. Find ids with op="resolve" or op="map".`),
    };
}
function resolveClusterRef(snapshot, ref) {
    const needle = ref.toLowerCase();
    const hit = snapshot.clusters.find((c) => c.id === ref || c.slug === ref || c.name.toLowerCase() === needle);
    if (hit)
        return { hit };
    const known = snapshot.clusters.map((c) => (0, narration_1.inlineOr)(c.slug, NO_NAME)).join(", ") || "none";
    return {
        fail: (0, respond_1.err)(`No cluster ${(0, narration_1.inlineOr)(ref, NO_NAME)}. Known clusters: ${known}.`),
    };
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
    const nameOf = (id) => snapshot.objects[id] ? (0, narration_1.inlineOr)(snapshot.objects[id].name, NO_NAME) : `\`${id}\``;
    // What the object IS = the name of its container (its column, or the
    // object it's nested in); top-level containers read as "column". That name
    // is member-typed like any other — only the "column" fallback is ours.
    const container = Object.values(snapshot.objects).find((o) => o.childIds.includes(object.id));
    const kindLabel = container?.name ? (0, narration_1.inlineOr)(container.name, NO_NAME) : "column";
    const lines = [];
    if (headline)
        lines.push(headline, "");
    lines.push(`# ${(0, narration_1.inlineOr)(object.name, NO_NAME)} (${kindLabel} · id: \`${object.id}\`)`);
    if (object.subtitle)
        lines.push((0, narration_1.inlineOr)(object.subtitle, ""));
    if (object.updatedAt) {
        lines.push(`Version: \`${object.updatedAt}\` (pass as expected_version to a later write so a concurrent edit can't clobber yours)`);
    }
    if (object.attributes.length > 0) {
        lines.push("", "## Attributes");
        for (const attr of object.attributes) {
            lines.push(indented(`- ${(0, narration_1.inlineOr)(attr.label, NO_NAME)}: ${renderValue(attr.value, nameOf, handles)}`));
        }
    }
    if (object.relationships.length > 0) {
        lines.push("", "## Relationships");
        for (const rel of object.relationships) {
            lines.push(`- ${(0, narration_1.inlineOr)(rel.label, NO_NAME)}: ${rel.targetIds.map(nameOf).join(", ")}`);
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
                backlinks.push(`- ${(0, narration_1.inlineOr)(other.name, NO_NAME)} —${(0, narration_1.inlineOr)(rel.label, NO_NAME)}→ (id: \`${other.id}\`)`);
            }
        }
    }
    if (backlinks.length > 0) {
        lines.push("", "## Referenced by", ...backlinks);
    }
    if ((object.template ?? []).length > 0) {
        lines.push("", "## Default fields (template)", "_New objects created inside this one are born with these fields, empty:_");
        for (const f of object.template) {
            lines.push(`- ${(0, narration_1.inlineOr)(f.label, NO_NAME)} (${f.kind})`);
        }
    }
    if (object.childIds.length > 0) {
        lines.push("", "## Objects inside");
        for (const id of object.childIds) {
            const child = snapshot.objects[id];
            if (child)
                lines.push(`- ${(0, narration_1.inlineOr)(child.name, NO_NAME)} (id: \`${id}\`)`);
        }
    }
    if (object.methods.length > 0) {
        lines.push("", "## Actions");
        for (const m of object.methods) {
            // The action NAME was a `### ` heading; the three prose fields under it
            // are what the agent is supposed to carry out, so they keep their text
            // and lose only their ability to start a line.
            lines.push(`### ${(0, narration_1.inlineOr)(m.name, NO_NAME)}`);
            if (m.description)
                lines.push(indented(m.description));
            if (m.outcome) {
                lines.push(indented(`Outcome: ${m.outcome}`));
            }
            if (m.tools) {
                lines.push(indented(`Tools: ${m.tools}`));
            }
        }
    }
    return lines.join("\n");
}
function renderValue(value, nameOf, handles) {
    switch (value.kind) {
        // A pill is a chip — a short label by construction (max 400), so it is a
        // value. A text attribute runs to 4000 characters of the user's own prose:
        // it stays whole, and the caller ({@link renderObject}) indents it.
        case "pill":
            return (0, narration_1.inlineOr)(value.value, "—");
        case "text":
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
                return `${(0, narration_1.inlineOr)(h.name, NO_NAME)} (${opener})`;
            })
                .join(", ") || "—");
    }
}
