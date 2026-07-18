"use strict";
/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph
 * as a ROUTING layer, fully agent-authorable (like dopl_kb for bases).
 * Read funnel: anchor → map → resolve → get. Write ops edit one thing
 * at a time (attribute / relationship / action upserts) so agents never
 * have to round-trip whole objects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOntologyTool = registerOntologyTool;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
const ONTOLOGY_DESCRIPTION = `The workspace ontology — objects organized in clusters of columns, with attributes, relationships, and actions. An object IS whatever its column is named (a "Sales Rep" column holds sales reps). LOOK UP identity, context, and how work gets done here instead of inferring; AUTHOR it the same way (no web UI needed). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — clusters and their columns. Call first to route.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request.
- "resolve" — find objects by name/description match (query). Returns ids.
- "get" — one object in full: attributes (linked knowledge/skills resolved to openable handles), OUTBOUND relationships plus an inbound "Referenced by" backlink list, nested objects, action recipes. Also returns a Version token — pass it back as \`expected_version\` on a later write so a concurrent edit can't silently clobber yours. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — new ontology board. Requires: name. Optional: purpose (agents read it to route — write a good one).
- "update_cluster" — rename / repurpose. Requires: cluster. Optional: name, purpose.
- "create_column" — new column (container object) in a cluster; its name says what its objects ARE (e.g. "Sales Rep"). Requires: cluster, name.
- "create_object" — new object inside a column (or nested in any object). Inherits from the parent: its template as empty fields, and a copy of its relationships and actions. Requires: parent, name.
- "update_object" — rename / redescribe. Requires: object. Optional: name, subtitle.
- "set_template_field" — upsert one DEFAULT field on a column (or any container): new objects created inside it are born with these fields, empty. Requires: object, label. Optional: kind (default text).
- "remove_template_field" — Requires: object, label.
- "set_attribute" — upsert one attribute by label. Requires: object, label. kind="text"|"pill" need \`value\`; kind="ref" needs \`values\` (object ids/names); kind="knowledge"|"skill" need \`values\` — KB/skill slugs or ids, and for kind="knowledge" also specific ENTRIES as \`<base>/<entry path>\` (e.g. "ai-ops-leads/Track 1 leads") or an entry uuid. Default kind: text.
- "remove_attribute" — Requires: object, label.
- "set_relationship" — replace one labeled edge. Requires: object, label, targets (object ids/names — at least one, and never the object itself). To clear an edge use "remove_relationship".
- "remove_relationship" — Requires: object, label.
- "set_action" — upsert an action by name: something the OBJECT can do day to day, performed by an agent on its behalf (e.g. "Send email", "Search LinkedIn"). Requires: object, name. Optional: description (how/when to do it), outcome (what the result should be, e.g. "Follow-up email sent and logged"), tools (what to use, e.g. "Gmail").
- "remove_action" — Requires: object, name.
- "claim_anchor" — link the CALLING user to an object as their identity anchor. Requires: object.

Object-mutating ops (update_object, set/remove_attribute, set/remove_template_field, set/remove_action, set/remove_relationship) accept an optional \`expected_version\` (the Version from a prior op="get"). When supplied, the write is rejected if the object changed since — re-get, reconcile, and retry. Destructive deletes live in dopl_ontology_admin.`;
const ONTOLOGY_ADMIN_DESCRIPTION = `DESTRUCTIVE ontology operations — soft-deletes (hidden, not restorable via MCP yet). Confirm with the user before calling. Set \`op\` to one of:
- "delete_object" — soft-delete an object (a column's cards survive but are orphaned until re-parented). Requires: object.
- "delete_cluster" — soft-delete a cluster board. Its column objects survive, detached. Requires: cluster.`;
function registerOntologyTool(register, client) {
    register("dopl_ontology", ONTOLOGY_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "map",
            "anchor",
            "resolve",
            "get",
            "create_cluster",
            "update_cluster",
            "create_column",
            "create_object",
            "update_object",
            "set_template_field",
            "remove_template_field",
            "set_attribute",
            "remove_attribute",
            "set_relationship",
            "remove_relationship",
            "set_action",
            "remove_action",
            "claim_anchor",
        ])
            .describe("Operation to perform."),
        query: zod_1.z.string().optional().describe("resolve: name/description text to match."),
        object: zod_1.z.string().optional().describe("Object id (preferred) or exact name."),
        cluster: zod_1.z.string().optional().describe("Cluster slug, id, or exact name."),
        parent: zod_1.z
            .string()
            .optional()
            .describe("create_object: the column/object to nest under (id or exact name)."),
        name: zod_1.z.string().optional().describe("A name (cluster/column/object/action)."),
        purpose: zod_1.z.string().optional().describe("create_cluster/update_cluster: routing one-liner."),
        subtitle: zod_1.z.string().optional().describe("update_object: short description agents browse."),
        label: zod_1.z.string().optional().describe("Attribute, relationship, or template-field label."),
        kind: zod_1.z
            .enum(["text", "pill", "ref", "knowledge", "skill"])
            .optional()
            .describe("set_attribute / set_template_field: value kind (default text)."),
        value: zod_1.z.string().optional().describe("set_attribute (text/pill): the value."),
        values: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("set_attribute (ref/knowledge/skill): ids, slugs, or exact names. kind=knowledge also accepts entry refs: `<base>/<entry path>` or an entry uuid."),
        targets: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("set_relationship: target objects (ids or exact names)."),
        description: zod_1.z.string().optional().describe("set_action: what the action does."),
        outcome: zod_1.z
            .string()
            .optional()
            .describe("set_action: what the outcome of the action should be."),
        tools: zod_1.z
            .string()
            .optional()
            .describe("set_action: tools the agent should use to perform it."),
        expected_version: zod_1.z
            .string()
            .optional()
            .describe("Optional optimistic-concurrency token for object-mutating ops: the object's Version from a prior op=\"get\". If the object changed since, the write is rejected so you can re-get, reconcile, and retry. Omit to overwrite blindly (last-writer-wins)."),
    }, (args) => dispatch(client, args));
    register("dopl_ontology_admin", ONTOLOGY_ADMIN_DESCRIPTION, {
        op: zod_1.z.enum(["delete_object", "delete_cluster"]).describe("Destructive operation."),
        object: zod_1.z.string().optional().describe("delete_object: id or exact name."),
        cluster: zod_1.z.string().optional().describe("delete_cluster: slug, id, or exact name."),
    }, async (args) => {
        const snapshot = await client.getOntology();
        if (args.op === "delete_object") {
            const miss = (0, respond_1.missingParams)("delete_object", args, ["object"]);
            if (miss)
                return miss;
            const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, args.object);
            if ("fail" in resolved)
                return resolved.fail;
            await client.deleteOntologyObject(resolved.hit.id);
            return (0, respond_1.ok)(`Deleted object **${resolved.hit.name}** (\`${resolved.hit.id}\`).`);
        }
        const miss = (0, respond_1.missingParams)("delete_cluster", args, ["cluster"]);
        if (miss)
            return miss;
        const resolved = (0, ontology_render_1.resolveClusterRef)(snapshot, args.cluster);
        if ("fail" in resolved)
            return resolved.fail;
        await client.deleteOntologyCluster(resolved.hit.id);
        return (0, respond_1.ok)(`Deleted cluster **${resolved.hit.name}** (\`${resolved.hit.slug}\`).`);
    });
}
// Attribute-value size caps, mirrored from the server schema
// (attributeValueSchema) so an oversized value fails with a clear,
// field-named message at the tool boundary instead of an opaque
// downstream VALIDATION_FAILED.
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
async function dispatch(client, args) {
    const required = REQUIRED[args.op];
    if (required) {
        const miss = (0, respond_1.missingParams)(args.op, args, required);
        if (miss)
            return miss;
    }
    switch (args.op) {
        case "map":
            return opMap(client);
        case "anchor":
            return opAnchor(client);
        case "resolve":
            return opResolve(client, args.query);
        case "get":
            return opGet(client, args.object);
        case "create_cluster": {
            const cluster = await client.createOntologyCluster({
                name: args.name,
                purpose: args.purpose,
            });
            return (0, respond_1.ok)(`Created cluster **${cluster.name}** (slug: \`${cluster.slug}\`). Add columns with op="create_column".`);
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
            return (0, respond_1.ok)(`Updated cluster **${cluster.name}** (slug: \`${cluster.slug}\`).`);
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
            return (0, respond_1.ok)(`Created column **${column.name}** (id: \`${column.id}\`) in ${resolved.hit.name}. Add objects with op="create_object" parent="${column.id}".`);
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
                born.push(`fields ${object.attributes.map((a) => a.label).join(", ")}`);
            }
            if (object.relationships.length)
                born.push(`${object.relationships.length} relationship(s)`);
            if (object.methods.length)
                born.push(`${object.methods.length} action(s)`);
            const bornNote = born.length ? ` Born with ${born.join(" · ")}.` : "";
            return (0, respond_1.ok)(`Created **${object.name}** (id: \`${object.id}\`) inside ${resolved.hit.name}.${bornNote}`);
        }
        case "update_object":
            return withObject(client, args.object, async (object) => {
                await client.updateOntologyObject(object.id, { name: args.name, subtitle: args.subtitle }, args.expected_version);
                return (0, respond_1.ok)(`Updated **${args.name ?? object.name}** (\`${object.id}\`).`);
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
                return (0, respond_1.ok)(`Set default field **${label}** (${kind}) on **${object.name}** — new objects created inside it are born with it, empty. Fields now: ${template.map((f) => f.label).join(", ")}.`);
            });
        case "remove_template_field":
            return withObject(client, args.object, async (object) => {
                const needle = args.label.toLowerCase();
                const current = object.template ?? [];
                const template = current.filter((f) => f.label.toLowerCase() !== needle);
                if (template.length === current.length) {
                    return (0, respond_1.err)(`**${object.name}** has no default field "${args.label}".`);
                }
                await client.updateOntologyObject(object.id, { template }, args.expected_version);
                return (0, respond_1.ok)(`Removed default field "${args.label}" from **${object.name}**.`);
            });
        case "set_attribute":
            return opSetAttribute(client, args);
        case "remove_attribute":
            return withObject(client, args.object, async (object) => {
                const label = args.label.toLowerCase();
                const attributes = object.attributes.filter((a) => a.label.toLowerCase() !== label);
                if (attributes.length === object.attributes.length) {
                    return (0, respond_1.err)(`**${object.name}** has no attribute "${args.label}".`);
                }
                await client.updateOntologyObject(object.id, { attributes }, args.expected_version);
                return (0, respond_1.ok)(`Removed attribute "${args.label}" from **${object.name}**.`);
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
                return (0, respond_1.ok)(`Set action **${name}** on **${object.name}**.`);
            });
        case "remove_action":
            return withObject(client, args.object, async (object) => {
                const needle = args.name.toLowerCase();
                const methods = object.methods.filter((m) => m.name.toLowerCase() !== needle);
                if (methods.length === object.methods.length) {
                    return (0, respond_1.err)(`**${object.name}** has no action "${args.name}".`);
                }
                await client.updateOntologyObject(object.id, { methods }, args.expected_version);
                return (0, respond_1.ok)(`Removed action "${args.name}" from **${object.name}**.`);
            });
        case "claim_anchor":
            return withObject(client, args.object, async (object) => {
                await client.claimOntologyAnchor(object.id);
                return (0, respond_1.ok)(`Anchored the calling user to **${object.name}** (\`${object.id}\`). op="anchor" now resolves to it.`);
            });
        default:
            return (0, respond_1.err)(`Unknown op "${args.op}".`);
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
        // Optimistic-concurrency miss (412): the object changed between the
        // caller's op="get" and this write. Turn it into re-get/reconcile/retry
        // guidance (mirrors dopl_kb write_file), not an opaque throw.
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`**${resolved.hit.name}** (\`${resolved.hit.id}\`) changed since you last read it. Re-read it with op="get", reconcile your change, then retry with the fresh Version as \`expected_version\` (or omit expected_version to overwrite blindly).`);
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
                return (0, respond_1.err)(`set_attribute kind="${kind}" value for "${label}" is ${args.value.length} characters; the max is ${cap}. Shorten it, use kind="text" for longer prose, or link a knowledge entry instead.`);
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
        return (0, respond_1.ok)(`Set attribute "${label}" on **${object.name}**.`);
    });
}
async function opSetRelationship(client, args) {
    return withObject(client, args.object, async (object, snapshot) => {
        const label = args.label.trim();
        const needle = label.toLowerCase();
        const kept = object.relationships.filter((r) => r.label.toLowerCase() !== needle);
        if (args.op === "remove_relationship") {
            if (kept.length === object.relationships.length) {
                return (0, respond_1.err)(`**${object.name}** has no relationship "${label}".`);
            }
            await client.updateOntologyObject(object.id, { relationships: kept }, args.expected_version);
            return (0, respond_1.ok)(`Removed relationship "${label}" from **${object.name}**.`);
        }
        // F-19: an empty targets array slips past the required-param check (which
        // only rejects undefined/null/empty-string) but persists nothing — the
        // server drops zero-target edges. Reject it with the same shape as
        // set_attribute kind="ref".
        if (!args.targets?.length) {
            return (0, respond_1.err)(`set_relationship needs \`targets\` (at least one object). To clear "${label}", use op="remove_relationship".`);
        }
        const resolved = resolveObjectValues(snapshot, args.targets);
        if ("fail" in resolved)
            return resolved.fail;
        // F-20: a self-edge is silently dropped server-side, so it would report a
        // false success. Reject explicitly rather than persist nothing.
        if (resolved.ids.includes(object.id)) {
            return (0, respond_1.err)("Cannot relate an object to itself.");
        }
        const relationships = [...kept, { label, targetIds: resolved.ids }];
        await client.updateOntologyObject(object.id, { relationships }, args.expected_version);
        const names = resolved.ids.map((id) => snapshot.objects[id]?.name ?? id);
        return (0, respond_1.ok)(`Set **${object.name}** —${label}→ ${names.join(", ")}.`);
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
        const known = resources.map((r) => `\`${r.slug}\``).join(", ") || "none";
        const entryHint = kind === "knowledge"
            ? ` For a specific entry, pass \`<base>/<entry path>\` or the entry's uuid.`
            : "";
        return {
            fail: (0, respond_1.err)(`No ${kind === "knowledge" ? "knowledge base" : "skill"} \`${ref}\`. Available: ${known}.${entryHint}`),
        };
    }
    return { ids };
}
/**
 * Entry-level knowledge refs: `<base>/<entry path>` (base by id/slug/name)
 * or a bare entry uuid, hunted across the caller's accessible bases.
 * Returns `{ id: null }` when the ref simply doesn't match an entry, so
 * the caller can fall through to its "no such base" error.
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
                fail: (0, respond_1.err)(`No entry at \`${path}\` in knowledge base \`${base.slug}\`. Check the path with dopl_kb op="get_tree" base="${base.slug}".`),
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
