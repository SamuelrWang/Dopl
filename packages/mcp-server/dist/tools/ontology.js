"use strict";
/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph as a
 * ROUTING layer. Read funnel: anchor → map → resolve → get. Writes edit ONE
 * thing at a time so agents never round-trip whole objects.
 *
 * Thin registrar: two tool schemas wired to
 *   - `ontology-render.ts`    — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`  — map/anchor/resolve/get
 *   - `ontology-ops-write.ts` — op dispatch + every mutating handler
 * The admin tool (refused cascade deletes) stays inline here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOntologyTool = registerOntologyTool;
const zod_1 = require("zod");
const delete_policy_js_1 = require("../delete-policy.js");
const narration_1 = require("./narration");
const identity_1 = require("./identity");
const respond_1 = require("./respond");
const ontology_render_1 = require("./ontology-render");
const ontology_ops_write_1 = require("./ontology-ops-write");
const ONTOLOGY_DESCRIPTION = `The workspace ontology — objects organized in clusters of columns, with attributes, relationships, and actions. An object IS whatever its column is named (a "Sales Rep" column holds sales reps). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — the clusters and their COLUMNS, each column's direct members named. TWO LEVELS ONLY: objects nested deeper, and objects in no column at all, never appear, and trashed rows appear in no read. It routes, it does not inventory. Call first.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request; at most one is returned.
- "resolve" — objects whose NAME or SUBTITLE contains the query (substring, case-insensitive), capped at 20 matches, and the result says when it truncated. Requires: query.
- "get" — one object: attributes, outbound relationships plus inbound backlinks, nested objects, actions, and a Version token. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — Requires: name. Optional: purpose (agents read it to route).
- "update_cluster" — Requires: cluster. Optional: name, purpose.
- "create_column" — a container whose name says what its objects ARE. Requires: cluster, name.
- "create_object" — inherits the parent's template as empty fields, plus its relationships and actions. Requires: parent, name.
- "update_object" — Requires: object. Optional: name, subtitle.
- "set_template_field" — a DEFAULT field on a container; objects created inside are born with it, empty. Requires: object, label.
- "remove_template_field" — Requires: object, label.
- "set_attribute" — Requires: object, label. kind "text"/"pill" need \`value\`; "ref"/"knowledge"/"skill" need \`values\`.
- "remove_attribute" — Requires: object, label.
- "set_relationship" — replace one labeled edge. Requires: object, label, targets (never the object itself).
- "remove_relationship" — Requires: object, label.
- "set_action" — something the OBJECT does day to day, performed by an agent on its behalf. Requires: object, name. Optional: description, outcome, tools.
- "remove_action" — Requires: object, name.
- "claim_anchor" — link the CALLING user to an object as their anchor. Requires: object.

Object-mutating ops take an optional \`expected_version\`; deletes live in dopl_ontology_admin.`;
const ONTOLOGY_ADMIN_DESCRIPTION = (0, delete_policy_js_1.deleteAdminDescription)([
    { op: "delete_object", effect: "would have deleted one object" },
    { op: "delete_cluster", effect: "would have deleted a cluster and, in cascade, every object it owns" },
], `Reach for instead: \`dopl_ontology\` op="update_object" to rewrite an object, op="remove_attribute" / op="remove_relationship" to strip fields FROM one (those edit an object; they do not delete it). If a board or a card genuinely has to go, ask the user to delete it in the Dopl app.`);
function registerOntologyTool(register, client, 
/** The session identity record — `op="anchor"` states it before the object. */
caller = identity_1.UNKNOWN_CALLER) {
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
            .describe("Object-mutating ops: the object's Version from a prior op=\"get\", which rejects the write if the object changed since; omit to overwrite blindly (last-writer-wins)."),
    }, (args) => (0, ontology_ops_write_1.dispatch)(client, args, caller));
    register("dopl_ontology_admin", ONTOLOGY_ADMIN_DESCRIPTION, {
        op: zod_1.z.enum(["delete_object", "delete_cluster"]).describe("Destructive operation."),
        object: zod_1.z.string().optional().describe("delete_object: id or exact name."),
        cluster: zod_1.z.string().optional().describe("delete_cluster: slug, id, or exact name."),
    }, async (args) => {
        // ⚠ SUMMARY PROJECTION, NOT THE GRAPH: this resolves a ref and counts a
        // cascade over `columnIds`/`childIds` — containment only, no JSONB.
        // (Unreachable: the delete refusal fires before any client call, so the
        // point is that the resolvers stay honest about what they read.)
        const snapshot = await client.getOntology({ view: "summary" });
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
        // ⚠ A clipped read UNDER-counts the cascade — rows past the ceiling are
        // still deleted, just never in hand to count. A flat number is worse than
        // no number.
        const floor = snapshot.truncated
            ? ` The ontology read was CLIPPED by a server row ceiling, so that count is a floor, not the cascade.`
            : "";
        await client.deleteOntologyCluster(resolved.hit.id);
        return (0, respond_1.ok)(`Deleted cluster ${(0, narration_1.inlineOr)(resolved.hit.name, "`(unnamed)`")} (\`${resolved.hit.slug}\`, id: \`${resolved.hit.id}\`) and, in cascade, its ${count} object${count === 1 ? "" : "s"}.${floor} Permanent — there is nothing to restore it from.`);
    });
}
/**
 * Size of a cluster's cascade set: columns plus every nested descendant. ⚠
 * Visited-set guards against cycles from objects shared across parents.
 *
 * ⚠ Typed to the containment fields it walks, so it accepts EITHER projection —
 * full snapshot and `view: "summary"` both carry `columnIds` and `childIds`.
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
