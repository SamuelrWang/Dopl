"use strict";
/**
 * `dopl_ontology` op dispatch + mutating handlers. `dispatch` is the whole
 * tool's switch: it validates required params, routes the read ops to
 * ontology-ops-read.ts, and handles every write inline (cluster/column/
 * object creation, attribute/relationship/action/template upserts,
 * claim_anchor). The value resolvers (refs → ids, knowledge/skill refs →
 * ids, entry refs) and the optimistic-concurrency `withObject` wrapper live
 * here too. The registrar (ontology.ts) wires this to the tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatch = dispatch;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
const ontology_ops_read_1 = require("./ontology-ops-read");
const identity_1 = require("./identity");
/**
 * ⚠ Write confirmations read the STORED name back (the server canonicalises it,
 * and `create_object` copies fields from a PARENT another member authored), so
 * the read-side rule applies: a name is a VALUE.
 */
const NO_NAME = "`(unnamed)`";
// ⚠ HAND-MIRRORED from the server schema (attributeValueSchema) so an
// oversized value fails with a field-named message at the tool boundary
// instead of an opaque downstream VALIDATION_FAILED.
const TEXT_VALUE_MAX = 4000;
const PILL_VALUE_MAX = 400;
const REQUIRED = {
    resolve: ["query"],
    get: ["object"],
    create_cluster: ["name"],
    update_cluster: ["cluster"],
    create_column: ["cluster", "name"],
    create_object: ["parent", "name"],
    update_object: ["object"],
    set_template_field: ["object", "label"],
    remove_template_field: ["object", "label"],
    set_attribute: ["object", "label"],
    remove_attribute: ["object", "label"],
    set_relationship: ["object", "label", "targets"],
    remove_relationship: ["object", "label"],
    set_action: ["object", "name"],
    remove_action: ["object", "name"],
    claim_anchor: ["object"],
};
async function dispatch(client, args, 
/** The session identity record — only `op="anchor"` uses it (see `opAnchor`). */
caller = identity_1.UNKNOWN_CALLER) {
    const required = REQUIRED[args.op];
    if (required) {
        const miss = (0, respond_1.missingParams)(args.op, args, required);
        if (miss)
            return miss;
    }
    switch (args.op) {
        case "map":
            return (0, ontology_ops_read_1.opMap)(client);
        case "anchor":
            return (0, ontology_ops_read_1.opAnchor)(client, caller);
        case "resolve":
            return (0, ontology_ops_read_1.opResolve)(client, args.query);
        case "get":
            return (0, ontology_ops_read_1.opGet)(client, args.object);
        case "create_cluster": {
            const cluster = await client.createOntologyCluster({
                name: args.name,
                purpose: args.purpose,
            });
            return (0, respond_1.ok)(`Created cluster ${(0, narration_1.inlineOr)(cluster.name, NO_NAME)} (slug: \`${cluster.slug}\`). Add columns with op="create_column".`);
        }
        case "update_cluster": {
            const snapshot = await client.getOntology();
            const resolved = (0, ontology_render_1.resolveClusterRef)(snapshot, args.cluster);
            if ("fail" in resolved)
                return resolved.fail;
            const cluster = await client.updateOntologyCluster(resolved.hit.id, {
                name: args.name,
                purpose: args.purpose,
            });
            return (0, respond_1.ok)(`Updated cluster ${(0, narration_1.inlineOr)(cluster.name, NO_NAME)} (slug: \`${cluster.slug}\`).`);
        }
        case "create_column": {
            const snapshot = await client.getOntology();
            const resolved = (0, ontology_render_1.resolveClusterRef)(snapshot, args.cluster);
            if ("fail" in resolved)
                return resolved.fail;
            const column = await client.createOntologyObject({
                clusterId: resolved.hit.id,
                name: args.name,
            });
            return (0, respond_1.ok)(`Created column ${(0, narration_1.inlineOr)(column.name, NO_NAME)} (id: \`${column.id}\`) in ${(0, narration_1.inlineOr)(resolved.hit.name, NO_NAME)}. Add objects with op="create_object" parent="${column.id}".`);
        }
        case "create_object": {
            const snapshot = await client.getOntology();
            const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, args.parent);
            if ("fail" in resolved)
                return resolved.fail;
            // Template fields, relationships, and actions copy from the parent.
            const object = await client.createOntologyObject({
                parentObjectId: resolved.hit.id,
                name: args.name,
            });
            const born = [];
            if (object.attributes.length) {
                born.push(`fields ${object.attributes.map((a) => (0, narration_1.inlineOr)(a.label, NO_NAME)).join(", ")}`);
            }
            if (object.relationships.length)
                born.push(`${object.relationships.length} relationship(s)`);
            if (object.methods.length)
                born.push(`${object.methods.length} action(s)`);
            const bornNote = born.length ? ` Born with ${born.join(" · ")}.` : "";
            return (0, respond_1.ok)(`Created ${(0, narration_1.inlineOr)(object.name, NO_NAME)} (id: \`${object.id}\`) inside ${(0, narration_1.inlineOr)(resolved.hit.name, NO_NAME)}.${bornNote}`);
        }
        case "update_object":
            return withObject(client, args.object, async (object) => {
                await client.updateOntologyObject(object.id, { name: args.name, subtitle: args.subtitle }, args.expected_version);
                return (0, respond_1.ok)(`Updated ${(0, narration_1.inlineOr)(args.name ?? object.name, NO_NAME)} (\`${object.id}\`).`);
            });
        case "set_template_field":
            return withObject(client, args.object, async (object) => {
                const label = args.label.trim();
                if (!label)
                    return (0, respond_1.err)("set_template_field needs a non-empty `label`.");
                const kind = args.kind ?? "text";
                const needle = label.toLowerCase();
                const current = object.template ?? [];
                const existing = current.find((f) => f.label.toLowerCase() === needle);
                const field = {
                    key: existing?.key ?? label.toLowerCase().replace(/\s+/g, "-"),
                    label,
                    kind,
                };
                const template = existing
                    ? current.map((f) => (f === existing ? field : f))
                    : [...current, field];
                await client.updateOntologyObject(object.id, { template }, args.expected_version);
                return (0, respond_1.ok)(`Set default field ${(0, narration_1.inlineOr)(label, NO_NAME)} (${kind}) on ${(0, narration_1.inlineOr)(object.name, NO_NAME)} — new objects created inside it are born with it, empty. Fields now: ${template.map((f) => (0, narration_1.inlineOr)(f.label, NO_NAME)).join(", ")}.`);
            });
        case "remove_template_field":
            return withObject(client, args.object, async (object) => {
                const needle = args.label.toLowerCase();
                const current = object.template ?? [];
                const template = current.filter((f) => f.label.toLowerCase() !== needle);
                if (template.length === current.length) {
                    return (0, respond_1.err)(`${(0, narration_1.inlineOr)(object.name, NO_NAME)} has no default field ${(0, narration_1.inlineOr)(args.label, NO_NAME)}.`);
                }
                await client.updateOntologyObject(object.id, { template }, args.expected_version);
                return (0, respond_1.ok)(`Removed default field ${(0, narration_1.inlineOr)(args.label, NO_NAME)} from ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
            });
        case "set_attribute":
            return opSetAttribute(client, args);
        case "remove_attribute":
            return withObject(client, args.object, async (object) => {
                const label = args.label.toLowerCase();
                const attributes = object.attributes.filter((a) => a.label.toLowerCase() !== label);
                if (attributes.length === object.attributes.length) {
                    return (0, respond_1.err)(`${(0, narration_1.inlineOr)(object.name, NO_NAME)} has no attribute ${(0, narration_1.inlineOr)(args.label, NO_NAME)}.`);
                }
                await client.updateOntologyObject(object.id, { attributes }, args.expected_version);
                return (0, respond_1.ok)(`Removed attribute ${(0, narration_1.inlineOr)(args.label, NO_NAME)} from ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
            });
        case "set_relationship":
        case "remove_relationship":
            return opSetRelationship(client, args);
        case "set_action":
            return withObject(client, args.object, async (object) => {
                const name = args.name.trim();
                const needle = name.toLowerCase();
                const existing = object.methods.find((m) => m.name.toLowerCase() === needle);
                const method = {
                    name,
                    description: args.description ?? existing?.description ?? "",
                    outcome: args.outcome ?? existing?.outcome ?? "",
                    tools: args.tools ?? existing?.tools ?? "",
                };
                const methods = existing
                    ? object.methods.map((m) => (m === existing ? method : m))
                    : [...object.methods, method];
                await client.updateOntologyObject(object.id, { methods }, args.expected_version);
                return (0, respond_1.ok)(`Set action ${(0, narration_1.inlineOr)(name, NO_NAME)} on ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
            });
        case "remove_action":
            return withObject(client, args.object, async (object) => {
                const needle = args.name.toLowerCase();
                const methods = object.methods.filter((m) => m.name.toLowerCase() !== needle);
                if (methods.length === object.methods.length) {
                    return (0, respond_1.err)(`${(0, narration_1.inlineOr)(object.name, NO_NAME)} has no action ${(0, narration_1.inlineOr)(args.name, NO_NAME)}.`);
                }
                await client.updateOntologyObject(object.id, { methods }, args.expected_version);
                return (0, respond_1.ok)(`Removed action ${(0, narration_1.inlineOr)(args.name, NO_NAME)} from ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
            });
        case "claim_anchor":
            return withObject(client, args.object, async (object) => {
                await client.claimOntologyAnchor(object.id);
                return (0, respond_1.ok)(`Anchored the calling user to ${(0, narration_1.inlineOr)(object.name, NO_NAME)} (\`${object.id}\`). op="anchor" now resolves to it.`);
            });
        default:
            return (0, respond_1.err)(`Unknown op ${(0, narration_1.inlineOr)(args.op, "`(unreadable)`")}.`);
    }
}
async function withObject(client, ref, fn) {
    const snapshot = await client.getOntology();
    const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, ref);
    if ("fail" in resolved)
        return resolved.fail;
    try {
        return await fn(resolved.hit, snapshot);
    }
    catch (e) {
        // Optimistic-concurrency miss (412) — the object changed between the
        // caller's op="get" and this write. Re-get/reconcile/retry guidance, not an
        // opaque throw.
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`${(0, narration_1.inlineOr)(resolved.hit.name, NO_NAME)} (\`${resolved.hit.id}\`) changed since you last read it. Re-read it with op="get", reconcile your change, then retry with the fresh Version as \`expected_version\` (or omit expected_version to overwrite blindly).`);
        }
        throw e;
    }
}
async function opSetAttribute(client, args) {
    return withObject(client, args.object, async (object, snapshot) => {
        const label = args.label.trim();
        const kind = args.kind ?? "text";
        let value;
        if (kind === "text" || kind === "pill") {
            if (args.value === undefined) {
                return (0, respond_1.err)(`set_attribute kind="${kind}" needs \`value\`.`);
            }
            const cap = kind === "pill" ? PILL_VALUE_MAX : TEXT_VALUE_MAX;
            if (args.value.length > cap) {
                return (0, respond_1.err)(`set_attribute kind="${kind}" value for ${(0, narration_1.inlineOr)(label, NO_NAME)} is ${args.value.length} characters; the max is ${cap}. Shorten it, use kind="text" for longer prose, or link a knowledge entry instead.`);
            }
            value = { kind, value: args.value };
        }
        else {
            if (!args.values?.length) {
                return (0, respond_1.err)(`set_attribute kind="${kind}" needs \`values\` (at least one).`);
            }
            const resolved = kind === "ref"
                ? resolveObjectValues(snapshot, args.values)
                : await resolveResourceValues(client, kind, args.values);
            if ("fail" in resolved)
                return resolved.fail;
            value = { kind, value: resolved.ids };
        }
        const needle = label.toLowerCase();
        const attribute = {
            key: label.toLowerCase().replace(/\s+/g, "-"),
            label,
            value,
        };
        const existing = object.attributes.findIndex((a) => a.label.toLowerCase() === needle);
        const attributes = existing >= 0
            ? object.attributes.map((a, i) => (i === existing ? attribute : a))
            : [...object.attributes, attribute];
        await client.updateOntologyObject(object.id, { attributes }, args.expected_version);
        return (0, respond_1.ok)(`Set attribute ${(0, narration_1.inlineOr)(label, NO_NAME)} on ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
    });
}
async function opSetRelationship(client, args) {
    return withObject(client, args.object, async (object, snapshot) => {
        const label = args.label.trim();
        const needle = label.toLowerCase();
        const kept = object.relationships.filter((r) => r.label.toLowerCase() !== needle);
        if (args.op === "remove_relationship") {
            if (kept.length === object.relationships.length) {
                return (0, respond_1.err)(`${(0, narration_1.inlineOr)(object.name, NO_NAME)} has no relationship ${(0, narration_1.inlineOr)(label, NO_NAME)}.`);
            }
            await client.updateOntologyObject(object.id, { relationships: kept }, args.expected_version);
            return (0, respond_1.ok)(`Removed relationship ${(0, narration_1.inlineOr)(label, NO_NAME)} from ${(0, narration_1.inlineOr)(object.name, NO_NAME)}.`);
        }
        // ⚠ An empty targets array slips past the required-param check (which
        // rejects only undefined/null/empty-string) and persists NOTHING — the
        // server drops zero-target edges.
        if (!args.targets?.length) {
            return (0, respond_1.err)(`set_relationship needs \`targets\` (at least one object). To clear ${(0, narration_1.inlineOr)(label, NO_NAME)}, use op="remove_relationship".`);
        }
        const resolved = resolveObjectValues(snapshot, args.targets);
        if ("fail" in resolved)
            return resolved.fail;
        // ⚠ A self-edge is silently dropped server-side, so it reports a false
        // success — reject explicitly.
        if (resolved.ids.includes(object.id)) {
            return (0, respond_1.err)("Cannot relate an object to itself.");
        }
        const relationships = [...kept, { label, targetIds: resolved.ids }];
        await client.updateOntologyObject(object.id, { relationships }, args.expected_version);
        const names = resolved.ids.map((id) => snapshot.objects[id] ? (0, narration_1.inlineOr)(snapshot.objects[id].name, NO_NAME) : `\`${id}\``);
        return (0, respond_1.ok)(`Set ${(0, narration_1.inlineOr)(object.name, NO_NAME)} —${(0, narration_1.inlineOr)(label, NO_NAME)}→ ${names.join(", ")}.`);
    });
}
function resolveObjectValues(snapshot, refs) {
    const ids = [];
    for (const ref of refs) {
        const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, ref);
        if ("fail" in resolved)
            return resolved;
        if (!ids.includes(resolved.hit.id))
            ids.push(resolved.hit.id);
    }
    return { ids };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function resolveResourceValues(client, kind, refs) {
    const resources = kind === "knowledge"
        ? (await client.listKbBases().catch(() => [])).map((b) => ({
            id: b.id,
            slug: b.slug,
            name: b.name,
        }))
        : (await client.listSkills().catch(() => [])).map((s) => ({
            id: s.id,
            slug: s.slug,
            name: s.name,
        }));
    const ids = [];
    for (const ref of refs) {
        const needle = ref.toLowerCase();
        const hit = resources.find((r) => r.id === ref || r.slug === needle || r.name.toLowerCase() === needle);
        if (hit) {
            if (!ids.includes(hit.id))
                ids.push(hit.id);
            continue;
        }
        if (kind === "knowledge") {
            const entry = await resolveKbEntryRef(client, resources, ref);
            if ("fail" in entry)
                return entry;
            if (entry.id) {
                if (!ids.includes(entry.id))
                    ids.push(entry.id);
                continue;
            }
        }
        const known = resources.map((r) => (0, narration_1.inlineOr)(r.slug, NO_NAME)).join(", ") || "none";
        const entryHint = kind === "knowledge"
            ? ` For a specific entry, pass \`<base>/<entry path>\` or the entry's uuid.`
            : "";
        return {
            fail: (0, respond_1.err)(`No ${kind === "knowledge" ? "knowledge base" : "skill"} ${(0, narration_1.inlineOr)(ref, NO_NAME)}. Available: ${known}.${entryHint}`),
        };
    }
    return { ids };
}
/**
 * Entry-level knowledge refs: `<base>/<entry path>` (base by id/slug/name) or a
 * bare entry uuid, hunted across the caller's accessible bases. Returns
 * `{ id: null }` on a non-match so the caller falls through to "no such base".
 */
async function resolveKbEntryRef(client, bases, ref) {
    const slash = ref.indexOf("/");
    if (slash > 0) {
        const baseRef = ref.slice(0, slash);
        const path = ref.slice(slash + 1);
        const needle = baseRef.toLowerCase();
        const base = bases.find((b) => b.id === baseRef || b.slug === needle || b.name.toLowerCase() === needle);
        if (!base || !path)
            return { id: null };
        try {
            const entry = await client.readKbFileByPath(base.id, path);
            return { id: entry.id };
        }
        catch {
            return {
                fail: (0, respond_1.err)(`No entry at ${(0, narration_1.inlineOr)(path, NO_NAME)} in knowledge base \`${base.slug}\`. Check the path with dopl_kb op="get_tree" base="${base.slug}".`),
            };
        }
    }
    if (!UUID_RE.test(ref))
        return { id: null };
    const trees = await Promise.all(bases.map((b) => client.getKbTree(b.id).catch(() => null)));
    for (const tree of trees) {
        if (tree?.entries.some((e) => e.id === ref))
            return { id: ref };
    }
    return { id: null };
}
