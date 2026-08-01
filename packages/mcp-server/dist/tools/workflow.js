"use strict";
/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a graph of steps (workflow_steps) connected by branch-
 * conditioned edges (workflow_step_edges). It owns the knowledge bases +
 * skills its steps reference and is the unit agents follow step-by-step.
 * Entry steps are those with no incoming edge. Clusters group workflows.
 *
 * This file is the thin registrar: it owns the two tool schemas + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `workflow-render.ts`     — graph types + render helpers (plural/reads/actions/not-found)
 *   - `workflow-ops-read.ts`   — list/get/step/list_trash
 *   - `workflow-ops-write.ts`  — create/update/set_graph + node/edge ops + set_cluster + restore
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowTools = registerWorkflowTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const workflow_ops_read_1 = require("./workflow-ops-read");
const workflow_ops_write_1 = require("./workflow-ops-write");
const WORKFLOW_DESCRIPTION = `Read and AUTHOR Dopl workflows (a graph of steps connected by branch-conditioned edges; the agent-followable unit). Set \`op\` to one of:
- "list" — the workflows YOU CAN READ in this workspace. Cheap metadata call; run it proactively to resolve a slug another op needs. Team-scoped workflows you hold no grant on are dropped silently (they are not "missing" — they are not yours), and soft-deleted ones live in op="list_trash", so this count is your view and not the workspace's.
- "get" — retrieve a workflow's metadata, its topologically-ordered steps (each step's id, READ knowledge, ACTION skills, user input, agent output, next), the branch conditions on its edges, and attached knowledge bases + skills. Steps and edges are COMPLETE. The ATTACHMENTS are not: each attached base's entry index is capped server-side and again when rendered, and attached bases/skills you cannot read are dropped — so treat the entry lists as an index, and use dopl_kb(op="get_tree") for a base's real contents. Attached skill bodies are truncated and labelled as such. Step ids returned here are what update_node/remove_node/connect take.
- "step" — read ONE step's full detail as you walk the workflow (\`step\` = a step id or ref): its reads/actions/user-input/agent-output/next + its outgoing edges (with branch conditions) and incoming-edge count. The paced-disclosure surface — fetch a step when you reach it.
- "create" — create a new workflow by name.
- "update" — rename (\`name\`) and/or set \`description\`.
- "set_graph" — DECLARATIVE authoring (preferred): pass \`graph\` = { nodes, edges } and the server makes the workflow match exactly (create/update/delete to fit). Each node has a stable \`ref\`; edges connect node \`ref\`s and may carry a branch \`condition\`. Re-send to edit. Knowledge/skill ids in reads/actions auto-attach. Every edge endpoint must be a declared node ref, self-edges are rejected, and a step pair may appear once — a repeated pair with a DIFFERENT condition is a 400 (an identical repeat is deduped).
- "add_node" — add one step (\`node\`, incl. \`ref\`); optional \`connect_from\` (a step id or ref) wires an edge into it. Omit \`connect_from\` to add an entry step. Returns the new step id.
- "update_node" — patch a step's fields (\`node_id\` = step id or ref, plus \`node\`).
- "remove_node" — delete a step (\`node_id\` = step id or ref); its edges go with it.
- "connect" / "disconnect" — add/remove an edge (\`from\`,\`to\` = step id or ref). connect takes an optional branch \`condition\`.
- "set_cluster" — group this workflow under a cluster (\`cluster\` = slug or id from dopl_cluster(op='list')); omit \`cluster\` to ungroup.
- "list_trash" — the soft-deleted workflows YOU CAN SEE (the recovery surface). Each shows name, slug, and when it was deleted. A trashed TEAMS-SCOPED workflow is visible here only to its creator and to admins/owners: the effective-access index it would be resolved through excludes deleted rows, so a grantee cannot see or restore it. Run this before "restore_workflow" to find the slug/id.
- "restore_workflow" — restore a soft-deleted workflow (recovery, not deletion; brings its steps + edges back). Use after op="list_trash"; \`slug\` accepts the trashed workflow's slug or id. If a live workflow already reused the slug, the restored one gets a fresh suffixed slug.

Typical authoring flow: create → set_graph (or add_node + connect) → get to verify. Step reads = [{kbId} | {kbId,entryId}]; actions = [{skillId}]. kbId/skillId accept the SLUG or the id straight from dopl_kb(op='list_bases') / dopl_skill(op='list'); entryId is an entry uuid. KBs/skills must be public. There is no "header" — entry steps are simply the ones with no incoming edge.`;
const WORKFLOW_ADMIN_DESCRIPTION = `DESTRUCTIVE workflow operations. The op here is a soft-delete — the workflow becomes invisible in active listings but stays restorable from trash (\`dopl_workflow\` op="list_trash" + op="restore_workflow"). Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_workflow" — soft-delete a workflow. Its steps + edges are trashed with it (they come back on restore); attached knowledge bases + skills are detached (not deleted). Recover with \`dopl_workflow(op='restore_workflow')\`.`;
const zNode = zod_1.z.object({
    ref: zod_1.z.string().max(200).optional().describe("stable handle for this step (required for set_graph + add_node)"),
    title: zod_1.z.string().max(200).optional(),
    description: zod_1.z.string().max(4000).optional(),
    reads: zod_1.z
        .array(zod_1.z.object({ kbId: zod_1.z.string(), entryId: zod_1.z.string().optional() }))
        .max(100)
        .optional()
        .describe("knowledge to READ: [{kbId} | {kbId, entryId}]"),
    actions: zod_1.z
        .array(zod_1.z.object({ skillId: zod_1.z.string() }))
        .max(100)
        .optional()
        .describe("skills to APPLY: [{skillId}]"),
    userInput: zod_1.z.string().max(4000).optional(),
    agentOutput: zod_1.z.string().max(4000).optional(),
    nextInstructions: zod_1.z.string().max(4000).optional(),
});
const zGraph = zod_1.z.object({
    nodes: zod_1.z.array(zNode).max(500),
    edges: zod_1.z
        .array(zod_1.z.object({
        from: zod_1.z.string(),
        to: zod_1.z.string(),
        condition: zod_1.z.string().max(2000).optional().describe("branch guard (free text); omit for an unconditional edge"),
    }))
        .max(2000),
});
function registerWorkflowTools(register, client) {
    register("dopl_workflow", WORKFLOW_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "get",
            "step",
            "create",
            "update",
            "set_graph",
            "add_node",
            "update_node",
            "remove_node",
            "connect",
            "disconnect",
            "set_cluster",
            "list_trash",
            "restore_workflow",
        ])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("Workflow slug OR stable id (the uuid from op=list — survives renames, prefer it for held references). Required for every op except list/create/list_trash. For restore_workflow it is the trashed workflow's slug or id (from op=list_trash)."),
        step: zod_1.z
            .string()
            .optional()
            .describe("op=step: the step id or ref to read (from op=get)."),
        name: zod_1.z
            .string()
            .optional()
            .describe("op=create: workflow name. op=update: new name."),
        description: zod_1.z
            .string()
            .max(300, "description is capped at 300 chars")
            .optional()
            .describe("op=update: workflow description (max 300 chars)."),
        graph: zGraph.optional().describe("op=set_graph: the full { nodes, edges } the workflow should match."),
        node: zNode.optional().describe("op=add_node/update_node: the step's fields."),
        connect_from: zod_1.z
            .string()
            .optional()
            .describe("op=add_node: a step id or ref to wire an edge into the new step from. Omit to add an entry step (no incoming edge)."),
        node_id: zod_1.z.string().optional().describe("op=update_node/remove_node: target step id or ref (from op=get)."),
        from: zod_1.z.string().optional().describe("op=connect/disconnect: source step id or ref."),
        to: zod_1.z.string().optional().describe("op=connect/disconnect: target step id or ref."),
        condition: zod_1.z
            .string()
            .optional()
            .describe("op=connect: optional branch guard on the edge (free text; e.g. 'user approved')."),
        cluster: zod_1.z
            .string()
            .optional()
            .describe("op=set_cluster: cluster slug or id (from dopl_cluster(op='list')) to group this workflow under. Omit/empty to ungroup it."),
        detail: zod_1.z
            .enum(["summary", "full"])
            .optional()
            .describe("op=get: 'summary' returns the workflow's title/description + step titles + attachment names WITHOUT entry indexes or skill bodies (cheap orientation); 'full' (default) includes everything."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return (0, workflow_ops_read_1.opList)(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_read_1.opGet)(client, args.slug, args.detail);
            }
            case "step": {
                const miss = (0, respond_1.missingParams)("step", args, ["slug", "step"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_read_1.opStep)(client, args.slug, args.step);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opCreate)(client, args.name);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                if (args.name === undefined && args.description === undefined) {
                    return (0, respond_1.err)("update needs `name` and/or `description`.");
                }
                return (0, workflow_ops_write_1.opUpdate)(client, args.slug, args.name, args.description);
            }
            case "set_graph": {
                const miss = (0, respond_1.missingParams)("set_graph", args, ["slug", "graph"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opSetGraph)(client, args.slug, args.graph);
            }
            case "add_node": {
                const miss = (0, respond_1.missingParams)("add_node", args, ["slug", "node"]);
                if (miss)
                    return miss;
                const node = args.node;
                if (!node.ref)
                    return (0, respond_1.err)("add_node needs `node.ref` (a stable handle).");
                return (0, workflow_ops_write_1.opAddNode)(client, args.slug, node, args.connect_from);
            }
            case "update_node": {
                const miss = (0, respond_1.missingParams)("update_node", args, ["slug", "node_id", "node"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opUpdateNode)(client, args.slug, args.node_id, args.node);
            }
            case "remove_node": {
                const miss = (0, respond_1.missingParams)("remove_node", args, ["slug", "node_id"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opRemoveNode)(client, args.slug, args.node_id);
            }
            case "connect": {
                const miss = (0, respond_1.missingParams)("connect", args, ["slug", "from", "to"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opConnect)(client, args.slug, args.from, args.to, args.condition);
            }
            case "disconnect": {
                const miss = (0, respond_1.missingParams)("disconnect", args, ["slug", "from", "to"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opDisconnect)(client, args.slug, args.from, args.to);
            }
            case "set_cluster": {
                const miss = (0, respond_1.missingParams)("set_cluster", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opSetCluster)(client, args.slug, args.cluster);
            }
            case "list_trash":
                return (0, workflow_ops_read_1.opListTrash)(client);
            case "restore_workflow": {
                const miss = (0, respond_1.missingParams)("restore_workflow", args, ["slug"]);
                if (miss)
                    return miss;
                return (0, workflow_ops_write_1.opRestoreWorkflow)(client, args.slug);
            }
        }
    });
    register("dopl_workflow_admin", WORKFLOW_ADMIN_DESCRIPTION, {
        op: zod_1.z.enum(["delete_workflow"]).describe("Destructive operation."),
        slug: zod_1.z.string().optional().describe("op=delete_workflow: workflow slug."),
    }, async (args) => {
        switch (args.op) {
            case "delete_workflow": {
                const miss = (0, respond_1.missingParams)("delete_workflow", args, ["slug"]);
                if (miss)
                    return miss;
                try {
                    await client.deleteWorkflow(args.slug);
                }
                catch (e) {
                    // Backend 404s when the slug matched no workflow; report
                    // "nothing deleted" instead of a raw throw / false success.
                    if ((0, respond_1.isNotFound)(e)) {
                        return (0, respond_1.err)(`No workflow \`${args.slug}\` in this workspace — nothing deleted. Run dopl_workflow(op="list") to see valid slugs/ids.`);
                    }
                    throw e;
                }
                return (0, respond_1.ok)(`Soft-deleted workflow \`${args.slug}\`. Its steps + edges are trashed with it and attached knowledge bases + skills remain. Restore with \`dopl_workflow(op='restore_workflow')\` (find it via \`dopl_workflow(op='list_trash')\`).`);
            }
        }
    });
}
