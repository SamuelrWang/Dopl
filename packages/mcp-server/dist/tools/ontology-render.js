"use strict";
/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.personalShelfGroups = personalShelfGroups;
exports.resolveObjectRef = resolveObjectRef;
exports.resolveOntologyRef = resolveOntologyRef;
exports.resolveResourceHandles = resolveResourceHandles;
exports.renderObject = renderObject;
const call_ref_js_1 = require("../call-ref.js");
const response_size_1 = require("./response-size");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
// ⚠ ONE TABLE FOR BOTH LANES — `container-destination.ts` owns the destination
// wording, and the knowledge lane reads its own headings from the same place.
// Two hand-typed copies is how an agent ends up holding a sharing model the
// operator does not have.
const container_destination_1 = require("./container-destination");
/*
 * ⚠ THE VALUE/BODY LINE, DRAWN TWICE. The graph is workspace-scoped and nothing
 * in `features/ontology/schema.ts` carries a charset rule (object `name`
 * max 300, `subtitle` max 1000, attribute `label` max 200, method `name`
 * max 300), so newlines and `##` are legal in all of them.
 *
 *   - NAMES and LABELS are VALUES → neutralized. Note the "kind" in a headline
 *     is not server-assigned: it is the CONTAINING OBJECT'S NAME.
 *   - PROSE the agent must act on is NOT neutralized — a `text` attribute value
 *     (4000 chars) and an action's description / outcome / tools are the
 *     routing instructions the ontology exists to carry, and clipping them to
 *     160 chars deletes the feature. {@link indented} instead: a newline can no
 *     longer put attacker text at the START of a line.
 *
 * The fallback itself is `narration.ts › NO_NAME` (2026-09-17).
 */
/**
 * Multi-line prose under the line introducing it, continuations indented two
 * spaces. ⚠ Content survives verbatim; it loses only the ability to BEGIN a line.
 */
function indented(text) {
    return text
        .split(/\r?\n/)
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join("\n");
}
/**
 * ⚠ §8 STALE-CACHE, SPELLED INLINE, AND **ONE FROZEN EMPTY RATHER THAN TWO**.
 * A payload cached against a server older than S29c carries no
 * `personalOntologyIds`, and this is what the absent key falls back to: no row is
 * filed under the personal label, which is the reading that states nothing the
 * response did not measure. The knowledge lane's twin is
 * `knowledge-ops-read.ts › EMPTY_BASE_IDS`.
 */
const EMPTY_ONTOLOGY_IDS = Object.freeze([]);
/**
 * 🔒 **THE PERSONAL SHELF, LABELLED ON THE ONTOLOGY LANE** (S29c, 2026-09-18).
 *
 * ⚠ **THE COMPLAINT THIS ANSWERS.** A BRAND-NEW home channel listed two
 * ontologies nobody had put there, with nothing saying where they came from —
 * `createHomeChannel` seeds none, and what is actually happening is that
 * `service-audience.ts › computeAudience` folds the caller's own personal shelf
 * into the read scope, exactly as the knowledge lane does. The KB lane labels
 * its half `container-destination.ts › DESTINATION_HEADINGS.personal`; the
 * ontology lane rendered the widening and never named it, which is how two rows
 * a caller owns read as two rows a caller must go and investigate.
 *
 * ⚠ **THE SPLIT KEYS ON THE ANSWER, NOT ON THE QUESTION**, the same rule
 * `opListBases` states: an ABSENT key means "not answered" and puts every
 * ontology in the unlabelled group, which is byte-identical to what this render
 * did before the field existed. It never files a row under a shelf it did not
 * measure.
 *
 * ⚠ **THE HEADING IS A FACT, SO IT SURVIVES `concise`** — which container a row
 * lives in is not a legend, and the whole point of the label is that a reader
 * is wrong without it.
 *
 * @returns the two groups in render order; the personal one carries the shared
 *          heading text, the other carries `null` (no heading at all).
 */
function personalShelfGroups(ontologies, personalOntologyIds) {
    const shelf = new Set(personalOntologyIds ?? EMPTY_ONTOLOGY_IDS);
    if (shelf.size === 0)
        return [[null, ontologies]];
    const personal = ontologies.filter((c) => shelf.has(c.id));
    const here = ontologies.filter((c) => !shelf.has(c.id));
    if (personal.length === 0)
        return [[null, here]];
    return [
        [null, here],
        [container_destination_1.DESTINATION_HEADINGS.personal, personal],
    ];
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
            return name ? (0, narration_1.inlineOr)(name, narration_1.NO_NAME) : "object";
        };
        const list = matches.map((o) => `\`${o.id}\` (${containerOf(o.id)})`).join(", ");
        return {
            fail: (0, respond_1.err)(`Multiple objects named ${(0, narration_1.inlineOr)(ref, narration_1.NO_NAME)} — use an id: ${list}`),
        };
    }
    return {
        fail: (0, respond_1.err)(`No object ${(0, narration_1.inlineOr)(ref, narration_1.NO_NAME)}. Find ids with ${(0, call_ref_js_1.callRef)("ontology.resolve", {}, { form: "op" })} or ${(0, call_ref_js_1.callRef)("ontology.map", {}, { form: "op" })}.`),
    };
}
function resolveOntologyRef(snapshot, ref) {
    const needle = ref.toLowerCase();
    const hit = snapshot.ontologies.find((c) => c.id === ref || c.slug === ref || c.name.toLowerCase() === needle);
    if (hit)
        return { hit };
    const known = snapshot.ontologies.map((c) => (0, narration_1.inlineOr)(c.slug, narration_1.NO_NAME)).join(", ") || "none";
    return {
        fail: (0, respond_1.err)(`No ontology ${(0, narration_1.inlineOr)(ref, narration_1.NO_NAME)}. Known ontologies: ${known}.`),
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
    // Leftover ids are entry-level knowledge refs — hunt them in the accessible
    // bases' trees and return a read_file-addressable path.
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
function renderObject(object, snapshot, headline, handles = new Map(), 
/** A16: `concise` drops the two LEGENDS below and nothing else. */
format) {
    const nameOf = (id) => snapshot.objects[id] ? (0, narration_1.inlineOr)(snapshot.objects[id].name, narration_1.NO_NAME) : `\`${id}\``;
    // ⚠ What the object IS = its container's NAME (column, or the object it is
    // nested in) — member-typed like any other. Only the "object" fallback is ours.
    const container = Object.values(snapshot.objects).find((o) => o.childIds.includes(object.id));
    const kindLabel = container?.name ? (0, narration_1.inlineOr)(container.name, narration_1.NO_NAME) : "object";
    const lines = [];
    if (headline)
        lines.push(headline, "");
    lines.push(`# ${(0, narration_1.inlineOr)(object.name, narration_1.NO_NAME)} (${kindLabel} · id: \`${object.id}\`)`);
    if (object.subtitle)
        lines.push((0, narration_1.inlineOr)(object.subtitle, ""));
    // ⚠ A TIMESTAMP AND ITS LEGEND — `response-size.ts`'s own list of what
    // `concise` drops opens with "timestamps". A caller that is about to WRITE
    // asks for `detailed`, which is the default.
    if (object.updatedAt && !(0, response_size_1.isConcise)(format)) {
        lines.push(`Version: \`${object.updatedAt}\` (pass as expected_version to a later write so a concurrent edit can't clobber yours)`);
    }
    if (object.attributes.length > 0) {
        lines.push("", "## Attributes");
        for (const attr of object.attributes) {
            lines.push(indented(`- ${(0, narration_1.inlineOr)(attr.label, narration_1.NO_NAME)}: ${renderValue(attr.value, nameOf, handles)}`));
        }
    }
    if (object.relationships.length > 0) {
        lines.push("", "## Relationships");
        for (const rel of object.relationships) {
            lines.push(`- ${(0, narration_1.inlineOr)(rel.label, narration_1.NO_NAME)}: ${rel.targetIds.map(nameOf).join(", ")}`);
        }
    }
    // Inbound edges ("Referenced by") — without them `get` shows only outbound
    // edges and hides who depends on this object.
    const backlinks = [];
    for (const other of Object.values(snapshot.objects)) {
        if (other.id === object.id)
            continue;
        for (const rel of other.relationships) {
            if (rel.targetIds.includes(object.id)) {
                backlinks.push(`- ${(0, narration_1.inlineOr)(other.name, narration_1.NO_NAME)} —${(0, narration_1.inlineOr)(rel.label, narration_1.NO_NAME)}→ (id: \`${other.id}\`)`);
            }
        }
    }
    if (backlinks.length > 0) {
        lines.push("", "## Referenced by", ...backlinks);
    }
    if ((object.template ?? []).length > 0) {
        lines.push("", "## Default fields (template)", ...((0, response_size_1.isConcise)(format)
            ? []
            : ["_New objects created inside this one are born with these fields, empty:_"]));
        for (const f of object.template) {
            lines.push(`- ${(0, narration_1.inlineOr)(f.label, narration_1.NO_NAME)} (${f.kind})`);
        }
    }
    if (object.childIds.length > 0) {
        lines.push("", "## Objects inside");
        for (const id of object.childIds) {
            const child = snapshot.objects[id];
            if (child)
                lines.push(`- ${(0, narration_1.inlineOr)(child.name, narration_1.NO_NAME)} (id: \`${id}\`)`);
        }
    }
    if (object.methods.length > 0) {
        lines.push("", "## Actions");
        for (const m of object.methods) {
            // ⚠ Action NAME is a heading (neutralize); the three prose fields under
            // it are what the agent must carry out, so they keep their text and lose
            // only the ability to start a line.
            lines.push(`### ${(0, narration_1.inlineOr)(m.name, narration_1.NO_NAME)}`);
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
        // ⚠ A pill is a short label by construction (max 400) → value. A text
        // attribute is 4000 chars of the user's prose → stays whole, and the caller
        // ({@link renderObject}) indents it.
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
                    ? (0, call_ref_js_1.callRef)("kb.get_tree", { base: `"${h.slug}"` }, { form: "named" })
                    : h.kind === "kb-entry"
                        ? (0, call_ref_js_1.callRef)("kb.read_file", { base: `"${h.slug}"`, path: `"${h.path}"` }, { form: "named" })
                        : (0, call_ref_js_1.callRef)("skill.get", { slug: `"${h.slug}"` }, { form: "named" });
                return `${(0, narration_1.inlineOr)(h.name, narration_1.NO_NAME)} (${opener})`;
            })
                .join(", ") || "—");
    }
}
