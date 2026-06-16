"use strict";
/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a header panel plus the node graph wired to it by connectors
 * on the canvas. It owns the knowledge bases + skills its nodes reference and
 * is the unit agents follow step-by-step. Clusters group workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowTools = registerWorkflowTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const WORKFLOW_DESCRIPTION = `Read and AUTHOR Dopl workflows (a header + its connected node graph; the agent-followable unit). Changes appear live on an open canvas. Set \`op\` to one of:
- "list" — discover all workflows. Cheap metadata call; run it proactively to resolve a slug another op needs.
- "get" — retrieve a workflow's metadata, its topologically-ordered steps (each node's id, READ knowledge, ACTION skills, user input, agent output, next), and attached knowledge bases + skills. Node ids returned here are what update_node/remove_node/connect take.
- "create" — create a new workflow by name; spawns its header panel on the canvas and returns header_panel_id.
- "update" — rename (\`name\`) and/or set \`description\`.
- "set_graph" — DECLARATIVE authoring (preferred): pass \`graph\` = { nodes, edges } and the server makes the workflow match exactly (create/update/delete to fit). Each node has a stable \`ref\`; edges connect node \`ref\`s (or the literal "header"). Re-send to edit. Knowledge/skill ids in reads/actions auto-attach.
- "add_node" — add one node (\`node\`, incl. \`ref\`); \`connect_from\` ("header" or a node id, default "header") wires it in. Returns the new node id.
- "update_node" — patch a node's fields (\`node_id\` + \`node\`).
- "remove_node" — delete a node (\`node_id\`); its edges go with it.
- "connect" / "disconnect" — add/remove an edge (\`from\`,\`to\` = node id or "header").

Typical authoring flow: create → set_graph (or add_node + connect) → get to verify. Node reads = [{kbId} | {kbId,entryId}]; actions = [{skillId}]. kbId/skillId accept the SLUG or the id straight from dopl_kb(op='list_bases') / dopl_skill(op='list'); entryId is an entry uuid. KBs/skills must be public.`;
const WORKFLOW_ADMIN_DESCRIPTION = `DESTRUCTIVE workflow operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_workflow" — permanently delete a workflow. Its nodes stay on the canvas; attached knowledge bases + skills are detached (not deleted).`;
const zNode = zod_1.z.object({
    ref: zod_1.z.string().optional().describe("stable handle for this node (required for set_graph + add_node)"),
    title: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    reads: zod_1.z
        .array(zod_1.z.object({ kbId: zod_1.z.string(), entryId: zod_1.z.string().optional() }))
        .optional()
        .describe("knowledge to READ: [{kbId} | {kbId, entryId}]"),
    actions: zod_1.z
        .array(zod_1.z.object({ skillId: zod_1.z.string() }))
        .optional()
        .describe("skills to APPLY: [{skillId}]"),
    userInput: zod_1.z.string().optional(),
    agentOutput: zod_1.z.string().optional(),
    nextInstructions: zod_1.z.string().optional(),
});
const zGraph = zod_1.z.object({
    nodes: zod_1.z.array(zNode),
    edges: zod_1.z.array(zod_1.z.object({ from: zod_1.z.string(), to: zod_1.z.string() })),
});
function registerWorkflowTools(register, client) {
    register("dopl_workflow", WORKFLOW_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "get",
            "create",
            "update",
            "set_graph",
            "add_node",
            "update_node",
            "remove_node",
            "connect",
            "disconnect",
        ])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("Workflow slug (from op=list) — required for every op except list/create."),
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
        node: zNode.optional().describe("op=add_node/update_node: the node's fields."),
        connect_from: zod_1.z
            .string()
            .optional()
            .describe("op=add_node: 'header' or a node id to connect the new node from (default 'header')."),
        node_id: zod_1.z.string().optional().describe("op=update_node/remove_node: target node id (from op=get)."),
        from: zod_1.z.string().optional().describe("op=connect/disconnect: source node id or 'header'."),
        to: zod_1.z.string().optional().describe("op=connect/disconnect: target node id or 'header'."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return opList(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return opGet(client, args.slug);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name"]);
                if (miss)
                    return miss;
                return opCreate(client, args.name);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                if (args.name === undefined && args.description === undefined) {
                    return (0, respond_1.err)("update needs `name` and/or `description`.");
                }
                return opUpdate(client, args.slug, args.name, args.description);
            }
            case "set_graph": {
                const miss = (0, respond_1.missingParams)("set_graph", args, ["slug", "graph"]);
                if (miss)
                    return miss;
                return opSetGraph(client, args.slug, args.graph);
            }
            case "add_node": {
                const miss = (0, respond_1.missingParams)("add_node", args, ["slug", "node"]);
                if (miss)
                    return miss;
                const node = args.node;
                if (!node.ref)
                    return (0, respond_1.err)("add_node needs `node.ref` (a stable handle).");
                return opAddNode(client, args.slug, node, args.connect_from);
            }
            case "update_node": {
                const miss = (0, respond_1.missingParams)("update_node", args, ["slug", "node_id", "node"]);
                if (miss)
                    return miss;
                return opUpdateNode(client, args.slug, args.node_id, args.node);
            }
            case "remove_node": {
                const miss = (0, respond_1.missingParams)("remove_node", args, ["slug", "node_id"]);
                if (miss)
                    return miss;
                return opRemoveNode(client, args.slug, args.node_id);
            }
            case "connect": {
                const miss = (0, respond_1.missingParams)("connect", args, ["slug", "from", "to"]);
                if (miss)
                    return miss;
                return opConnect(client, args.slug, args.from, args.to);
            }
            case "disconnect": {
                const miss = (0, respond_1.missingParams)("disconnect", args, ["slug", "from", "to"]);
                if (miss)
                    return miss;
                return opDisconnect(client, args.slug, args.from, args.to);
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
                await client.deleteWorkflow(args.slug);
                return (0, respond_1.ok)(`Deleted workflow \`${args.slug}\`. Nodes stay on the canvas; attached knowledge bases + skills remain.`);
            }
        }
    });
}
// ── ops ──────────────────────────────────────────────────────────────
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
async function opList(client) {
    const { workflows } = await client.listWorkflows();
    if (workflows.length === 0)
        return (0, respond_1.ok)("No workflows found.");
    const lines = workflows.map((w) => {
        const kbs = w.knowledge_base_count ?? 0;
        const skills = w.skill_count ?? 0;
        const summary = kbs === 0 && skills === 0
            ? "empty"
            : [
                kbs > 0 ? plural(kbs, "knowledge base") : null,
                skills > 0 ? plural(skills, "skill") : null,
            ]
                .filter(Boolean)
                .join(" · ");
        return `- **${w.name}** (slug: \`${w.slug}\`) — ${summary}`;
    });
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug) {
    const wf = await client.getWorkflow(slug);
    const lines = [];
    lines.push(`# Workflow: ${wf.name}`);
    lines.push(`Slug: \`${wf.slug}\``);
    if (wf.description)
        lines.push(wf.description);
    lines.push("");
    const steps = wf.graph?.nodes ?? [];
    if (steps.length > 0) {
        const graphEdges = wf.graph?.edges ?? [];
        // ── Hierarchy: stages + per-step dependencies ────────────────────
        // Stage = longest-path depth from the entry steps (nodes arrive
        // topologically sorted, so one forward relaxation pass suffices;
        // a cycle degrades gracefully to flat stages). Steps sharing a
        // stage have no dependency between them → parallel branches.
        const stage = new Map(steps.map((n) => [n.id, 0]));
        for (const n of steps) {
            for (const e of graphEdges) {
                if (e.from !== n.id)
                    continue;
                stage.set(e.to, Math.max(stage.get(e.to) ?? 0, (stage.get(n.id) ?? 0) + 1));
            }
        }
        const stepNo = new Map(steps.map((n, i) => [n.id, i + 1]));
        const label = (id) => `Step ${stepNo.get(id)} (\`${id}\`)`;
        const prevOf = (id) => graphEdges.filter((e) => e.to === id).map((e) => e.from);
        const nextOf = (id) => graphEdges.filter((e) => e.from === id).map((e) => e.to);
        const stageCount = Math.max(...[...stage.values()]) + 1;
        lines.push(`## Steps (${steps.length}) — execution order`);
        lines.push(`Topologically ordered into ${plural(stageCount, "stage")}. Stages run IN SEQUENCE; steps in the SAME stage have no dependency between them and are parallel branches — do them in any order (or concurrently) before moving to the next stage. Each step's "Depends on" / "Leads to" lines give the exact edges. Per step: READ (knowledge), ACTIONS (skills), expected user input, the output to produce, and when to advance.`);
        lines.push("");
        for (let i = 0; i < steps.length; i++) {
            const n = steps[i];
            lines.push(`### Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\` — stage ${(stage.get(n.id) ?? 0) + 1} of ${stageCount}`);
            if (n.description)
                lines.push(n.description);
            const prev = prevOf(n.id);
            const next = nextOf(n.id);
            lines.push(prev.length === 0
                ? `- Depends on: nothing — entry step`
                : `- Depends on: ${prev.map(label).join(", ")}${prev.length > 1 ? " (all must be done first)" : ""}`);
            lines.push(next.length === 0
                ? `- Leads to: nothing — terminal step`
                : `- Leads to: ${next.map(label).join(", ")}${next.length > 1 ? " (fans out into parallel branches)" : ""}`);
            if (n.reads.length > 0) {
                lines.push(`- Read: ${n.reads
                    .map((r) => r.kind === "file"
                    ? `${r.name} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
                    : `${r.name} (knowledge base, kb_id: ${r.kbId})`)
                    .join("; ")}`);
            }
            if (n.actions.length > 0) {
                lines.push(`- Action: ${n.actions
                    .map((a) => `${a.name} (skill, skill_id: ${a.skillId})`)
                    .join("; ")}`);
            }
            if (n.userInput)
                lines.push(`- User input: ${n.userInput}`);
            if (n.agentOutput)
                lines.push(`- Agent output: ${n.agentOutput}`);
            if (n.nextInstructions)
                lines.push(`- Next: ${n.nextInstructions}`);
            lines.push("");
        }
        const edges = wf.graph?.edges ?? [];
        if (edges.length > 0) {
            lines.push(`Connections: ${edges.map((e) => `\`${e.from}\` → \`${e.to}\``).join(", ")}`);
            lines.push("");
        }
    }
    else {
        lines.push("_No nodes wired into this workflow yet._");
        lines.push("");
    }
    if (wf.knowledge_bases.length > 0) {
        lines.push(`## Knowledge Bases\n`);
        for (const kb of wf.knowledge_bases) {
            lines.push(`### ${kb.name}`);
            lines.push(`slug: \`${kb.slug}\` · id: \`${kb.knowledge_base_id}\``);
            if (kb.description)
                lines.push(kb.description);
            if (kb.entries_index.length > 0) {
                lines.push(`\nEntries (${kb.entries_index.length}):`);
                for (const e of kb.entries_index.slice(0, 50)) {
                    const path = e.folder_path ? `${e.folder_path}/${e.title}` : e.title;
                    lines.push(`- ${path}  \`(entry_id: ${e.entry_id})\``);
                }
            }
            lines.push("");
        }
    }
    if (wf.skills.length > 0) {
        lines.push(`## Skills\n`);
        for (const sk of wf.skills) {
            lines.push(`### ${sk.name}`);
            lines.push(`slug: \`${sk.slug}\` · id: \`${sk.skill_id}\` · status: ${sk.status}`);
            if (sk.description)
                lines.push(sk.description);
            if (sk.when_to_use)
                lines.push(`\n**When to use:** ${sk.when_to_use}`);
            if (sk.body)
                lines.push(`\nProcedure (truncated):\n${sk.body}`);
            lines.push("");
        }
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreate(client, name) {
    const wf = await client.createWorkflow(name);
    return (0, respond_1.ok)(`Created workflow **${wf.name}** (slug: \`${wf.slug}\`)${wf.header_panel_id ? `, header panel \`${wf.header_panel_id}\`` : ""}. Now author its graph with op="set_graph" (or add_node + connect), then op="get" to verify.`);
}
async function opUpdate(client, slug, name, description) {
    const wf = await client.updateWorkflow(slug, { name, description });
    return (0, respond_1.ok)(`Updated workflow **${wf.name}** (slug: \`${wf.slug}\`).`);
}
async function opSetGraph(client, slug, graph) {
    // ref is required for every node in set_graph.
    for (const n of graph.nodes) {
        if (!n.ref)
            return (0, respond_1.err)("Every node in `graph.nodes` needs a `ref`.");
    }
    await client.setWorkflowGraph(slug, graph);
    return (0, respond_1.ok)(`Set workflow \`${slug}\` graph: ${graph.nodes.length} node(s), ${graph.edges.length} edge(s). Run op="get" to see the ordered steps.`);
}
async function opAddNode(client, slug, node, connectFrom) {
    const payload = { ...node, connect_from: connectFrom };
    const { node_id } = await client.addWorkflowNode(slug, payload);
    return (0, respond_1.ok)(`Added node \`${node_id}\` to workflow \`${slug}\` (connected from ${connectFrom ?? "header"}).`);
}
async function opUpdateNode(client, slug, nodeId, node) {
    await client.updateWorkflowNode(slug, nodeId, node);
    return (0, respond_1.ok)(`Updated node \`${nodeId}\` in workflow \`${slug}\`.`);
}
async function opRemoveNode(client, slug, nodeId) {
    await client.removeWorkflowNode(slug, nodeId);
    return (0, respond_1.ok)(`Removed node \`${nodeId}\` from workflow \`${slug}\`.`);
}
async function opConnect(client, slug, from, to) {
    await client.connectWorkflow(slug, from, to);
    return (0, respond_1.ok)(`Connected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}
async function opDisconnect(client, slug, from, to) {
    await client.disconnectWorkflow(slug, from, to);
    return (0, respond_1.ok)(`Disconnected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}
