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
const ONTOLOGY_DESCRIPTION = `The workspace ontology — typed objects (person/team/client/policy/document) organized in clusters, with attributes, relationships, and action recipes. LOOK UP identity, context, and how work gets done here instead of inferring; AUTHOR it the same way (no web UI needed). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — clusters and their columns. Call first to route.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request.
- "resolve" — find objects by name/description match (query). Returns ids.
- "get" — one object in full: attributes (linked knowledge/skills resolved to openable handles), relationships, nested objects, action recipes. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — new ontology board. Requires: name. Optional: purpose (agents read it to route — write a good one).
- "update_cluster" — rename / repurpose. Requires: cluster. Optional: name, purpose.
- "create_column" — new column (container object) in a cluster. Requires: cluster, name. Optional: type.
- "create_object" — new object inside a column (or nested in any object). Requires: parent, name. Optional: type.
- "update_object" — rename / redescribe / retype. Requires: object. Optional: name, subtitle, type.
- "set_attribute" — upsert one attribute by label. Requires: object, label. kind="text"|"pill" need \`value\`; kind="ref" needs \`values\` (object ids/names); kind="knowledge"|"skill" need \`values\` (KB/skill slugs or ids). Default kind: text.
- "remove_attribute" — Requires: object, label.
- "set_relationship" — replace one labeled edge. Requires: object, label, targets (object ids/names).
- "remove_relationship" — Requires: object, label.
- "set_action" — upsert an action recipe by name. Requires: object, name. Optional: description, requires (attribute paths the action pulls, e.g. "client.transcripts").
- "remove_action" — Requires: object, name.
- "claim_anchor" — link the CALLING user to an object as their identity anchor. Requires: object.

Destructive deletes live in dopl_ontology_admin.`;
const ONTOLOGY_ADMIN_DESCRIPTION = `DESTRUCTIVE ontology operations — soft-deletes (hidden, not restorable via MCP yet). Confirm with the user before calling. Set \`op\` to one of:
- "delete_object" — soft-delete an object (a column's cards survive but are orphaned until re-parented). Requires: object.
- "delete_cluster" — soft-delete a cluster board. Its column objects survive, detached. Requires: cluster.`;
const OBJECT_TYPES = ["person", "team", "client", "policy", "document"];
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
        type: zod_1.z.enum(OBJECT_TYPES).optional().describe("Object type (default person)."),
        label: zod_1.z.string().optional().describe("Attribute or relationship label."),
        kind: zod_1.z
            .enum(["text", "pill", "ref", "knowledge", "skill"])
            .optional()
            .describe("set_attribute: value kind (default text)."),
        value: zod_1.z.string().optional().describe("set_attribute (text/pill): the value."),
        values: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("set_attribute (ref/knowledge/skill): ids, slugs, or exact names."),
        targets: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("set_relationship: target objects (ids or exact names)."),
        description: zod_1.z.string().optional().describe("set_action: what the action does."),
        requires: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("set_action: attribute paths the action pulls before executing."),
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
const REQUIRED = {
    resolve: ["query"],
    get: ["object"],
    create_cluster: ["name"],
    update_cluster: ["cluster"],
    create_column: ["cluster", "name"],
    create_object: ["parent", "name"],
    update_object: ["object"],
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
                objectType: args.type ?? "person",
                name: args.name,
            });
            return (0, respond_1.ok)(`Created column **${column.name}** (id: \`${column.id}\`) in ${resolved.hit.name}. Add objects with op="create_object" parent="${column.id}".`);
        }
        case "create_object": {
            const snapshot = await client.getOntology();
            const resolved = (0, ontology_render_1.resolveObjectRef)(snapshot, args.parent);
            if ("fail" in resolved)
                return resolved.fail;
            const object = await client.createOntologyObject({
                parentObjectId: resolved.hit.id,
                objectType: args.type ?? "person",
                name: args.name,
            });
            return (0, respond_1.ok)(`Created **${object.name}** (${object.type} · id: \`${object.id}\`) inside ${resolved.hit.name}.`);
        }
        case "update_object":
            return withObject(client, args.object, async (object) => {
                await client.updateOntologyObject(object.id, {
                    name: args.name,
                    subtitle: args.subtitle,
                    objectType: args.type,
                });
                return (0, respond_1.ok)(`Updated **${args.name ?? object.name}** (\`${object.id}\`).`);
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
                await client.updateOntologyObject(object.id, { attributes });
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
                    requires: args.requires ?? existing?.requires ?? [],
                };
                const methods = existing
                    ? object.methods.map((m) => (m === existing ? method : m))
                    : [...object.methods, method];
                await client.updateOntologyObject(object.id, { methods });
                return (0, respond_1.ok)(`Set action **${name}** on **${object.name}**.`);
            });
        case "remove_action":
            return withObject(client, args.object, async (object) => {
                const needle = args.name.toLowerCase();
                const methods = object.methods.filter((m) => m.name.toLowerCase() !== needle);
                if (methods.length === object.methods.length) {
                    return (0, respond_1.err)(`**${object.name}** has no action "${args.name}".`);
                }
                await client.updateOntologyObject(object.id, { methods });
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
    return fn(resolved.hit, snapshot);
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
        await client.updateOntologyObject(object.id, { attributes });
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
            await client.updateOntologyObject(object.id, { relationships: kept });
            return (0, respond_1.ok)(`Removed relationship "${label}" from **${object.name}**.`);
        }
        const resolved = resolveObjectValues(snapshot, args.targets);
        if ("fail" in resolved)
            return resolved.fail;
        const relationships = [...kept, { label, targetIds: resolved.ids }];
        await client.updateOntologyObject(object.id, { relationships });
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
        if (!hit) {
            const known = resources.map((r) => `\`${r.slug}\``).join(", ") || "none";
            return {
                fail: (0, respond_1.err)(`No ${kind === "knowledge" ? "knowledge base" : "skill"} \`${ref}\`. Available: ${known}.`),
            };
        }
        if (!ids.includes(hit.id))
            ids.push(hit.id);
    }
    return { ids };
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
    const lines = hits
        .slice(0, 20)
        .map((o) => `- **${o.name}** (${o.type} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`);
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
