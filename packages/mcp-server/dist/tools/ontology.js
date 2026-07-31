"use strict";
/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph
 * as a ROUTING layer, fully agent-authorable (like dopl_kb for bases).
 * Read funnel: anchor → map → resolve → get. Write ops edit one thing
 * at a time (attribute / relationship / action upserts) so agents never
 * have to round-trip whole objects.
 *
 * This file is the thin registrar: it owns the two tool schemas + wires
 * them to the handlers in sibling modules —
 *   - `ontology-render.ts`     — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`   — map/anchor/resolve/get
 *   - `ontology-ops-write.ts`  — the op dispatch switch + every mutating handler
 * The admin tool (cascade soft-deletes) stays inline here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOntologyTool = registerOntologyTool;
const zod_1 = require("zod");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
const ontology_ops_write_1 = require("./ontology-ops-write");
const ONTOLOGY_DESCRIPTION = `The workspace ontology — objects organized in clusters of columns, with attributes, relationships, and actions. An object IS whatever its column is named (a "Sales Rep" column holds sales reps). LOOK UP identity, context, and how work gets done here instead of inferring; AUTHOR it the same way (no web UI needed). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — clusters and their columns. Call first to route.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request.
- "resolve" — find objects by name/description match (query). Returns ids.
- "get" — one object in full: attributes (linked knowledge/skills resolved to openable handles), OUTBOUND relationships plus an inbound "Referenced by" backlink list, nested objects, action recipes. Also returns a Version token — pass it back as \`expected_version\` on a later write so a concurrent edit can't silently clobber yours. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — new ontology board. Requires: name. Optional: purpose (agents read it to route — write a good one).
- "update_cluster" — rename / repurpose. Requires: cluster. Optional: name, purpose.
- "restore_cluster" — recover a cluster that dopl_ontology_admin(op="delete_cluster") cascade-soft-deleted, bringing its objects back too (only the ones that delete cascaded — anything trashed separately stays trashed). Requires: cluster (the trashed cluster's id — reads don't list trashed clusters, so use the id from the delete confirmation). If a live cluster reused the slug, the restored one gets a fresh slug.
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
const ONTOLOGY_ADMIN_DESCRIPTION = `DESTRUCTIVE ontology operations — soft-deletes (hidden from reads, but recoverable, not permanent). CONFIRM with the user before calling. Set \`op\` to one of:
- "delete_object" — soft-delete an object (a column's cards survive but are orphaned until re-parented). Requires: object.
- "delete_cluster" — CASCADE soft-delete: trashes the cluster AND every object it owns (its columns + all nested cards) under one timestamp, so the whole board disappears from map/resolve/get. Nothing is hard-deleted — it stays RECOVERABLE with \`dopl_ontology(op="restore_cluster")\`, which brings the cluster and exactly those cascaded objects back. Requires: cluster.`;
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
            "restore_cluster",
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
        name: zod_1.z.string().max(200).optional().describe("A name (cluster/column/object/action)."),
        purpose: zod_1.z.string().max(2000).optional().describe("create_cluster/update_cluster: routing one-liner."),
        subtitle: zod_1.z.string().optional().describe("update_object: short description agents browse."),
        label: zod_1.z.string().max(200).optional().describe("Attribute, relationship, or template-field label."),
        kind: zod_1.z
            .enum(["text", "pill", "ref", "knowledge", "skill"])
            .optional()
            .describe("set_attribute / set_template_field: value kind (default text)."),
        value: zod_1.z.string().max(4000).optional().describe("set_attribute (text/pill): the value."),
        values: zod_1.z
            .array(zod_1.z.string())
            .max(100)
            .optional()
            .describe("set_attribute (ref/knowledge/skill): ids, slugs, or exact names. kind=knowledge also accepts entry refs: `<base>/<entry path>` or an entry uuid."),
        targets: zod_1.z
            .array(zod_1.z.string())
            .max(100)
            .optional()
            .describe("set_relationship: target objects (ids or exact names)."),
        description: zod_1.z.string().max(4000).optional().describe("set_action: what the action does."),
        outcome: zod_1.z
            .string()
            .max(4000)
            .optional()
            .describe("set_action: what the outcome of the action should be."),
        tools: zod_1.z
            .string()
            .max(2000)
            .optional()
            .describe("set_action: tools the agent should use to perform it."),
        expected_version: zod_1.z
            .string()
            .optional()
            .describe("Optional optimistic-concurrency token for object-mutating ops: the object's Version from a prior op=\"get\". If the object changed since, the write is rejected so you can re-get, reconcile, and retry. Omit to overwrite blindly (last-writer-wins)."),
    }, (args) => (0, ontology_ops_write_1.dispatch)(client, args));
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
            return (0, respond_1.ok)(`Deleted object ${(0, narration_1.inlineOr)(resolved.hit.name, "`(unnamed)`")} (\`${resolved.hit.id}\`).`);
        }
        const miss = (0, respond_1.missingParams)("delete_cluster", args, ["cluster"]);
        if (miss)
            return miss;
        const resolved = (0, ontology_render_1.resolveClusterRef)(snapshot, args.cluster);
        if ("fail" in resolved)
            return resolved.fail;
        const count = countClusterObjects(snapshot, resolved.hit);
        await client.deleteOntologyCluster(resolved.hit.id);
        return (0, respond_1.ok)(`Cascade soft-deleted cluster ${(0, narration_1.inlineOr)(resolved.hit.name, "`(unnamed)`")} (\`${resolved.hit.slug}\`, id: \`${resolved.hit.id}\`) and its ${count} object${count === 1 ? "" : "s"}. Recoverable — restore with dopl_ontology(op="restore_cluster", cluster="${resolved.hit.id}").`);
    });
}
/**
 * Size of a cluster's cascade set: its columns plus every nested descendant
 * (the objects delete_cluster soft-deletes with it). Visited-set guards
 * against cycles from objects shared across parents.
 */
function countClusterObjects(snapshot, cluster) {
    const collected = new Set();
    const stack = [...cluster.columnIds];
    while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined || collected.has(id))
            continue;
        collected.add(id);
        const obj = snapshot.objects[id];
        if (obj)
            stack.push(...obj.childIds);
    }
    return collected.size;
}
