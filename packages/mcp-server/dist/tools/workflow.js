"use strict";
/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a graph of steps (workflow_steps) connected by branch-
 * conditioned edges (workflow_step_edges). It owns the knowledge bases +
 * skills its steps reference and is the unit agents follow step-by-step.
 * Entry steps are those with no incoming edge. Clusters group workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowTools = registerWorkflowTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const WORKFLOW_DESCRIPTION = `Read and AUTHOR Dopl workflows (a graph of steps connected by branch-conditioned edges; the agent-followable unit). Set \`op\` to one of:
- "list" — discover all workflows. Cheap metadata call; run it proactively to resolve a slug another op needs.
- "get" — retrieve a workflow's metadata, its topologically-ordered steps (each step's id, READ knowledge, ACTION skills, user input, agent output, next), the branch conditions on its edges, and attached knowledge bases + skills. Step ids returned here are what update_node/remove_node/connect take.
- "step" — read ONE step's full detail as you walk the workflow (\`step\` = a step id or ref): its reads/actions/user-input/agent-output/next + its outgoing edges (with branch conditions) and incoming-edge count. The paced-disclosure surface — fetch a step when you reach it.
- "create" — create a new workflow by name.
- "update" — rename (\`name\`) and/or set \`description\`.
- "set_graph" — DECLARATIVE authoring (preferred): pass \`graph\` = { nodes, edges } and the server makes the workflow match exactly (create/update/delete to fit). Each node has a stable \`ref\`; edges connect node \`ref\`s and may carry a branch \`condition\`. Re-send to edit. Knowledge/skill ids in reads/actions auto-attach. Every edge endpoint must be a declared node ref, self-edges are rejected, and a step pair may appear once — a repeated pair with a DIFFERENT condition is a 400 (an identical repeat is deduped).
- "add_node" — add one step (\`node\`, incl. \`ref\`); optional \`connect_from\` (a step id or ref) wires an edge into it. Omit \`connect_from\` to add an entry step. Returns the new step id.
- "update_node" — patch a step's fields (\`node_id\` = step id or ref, plus \`node\`).
- "remove_node" — delete a step (\`node_id\` = step id or ref); its edges go with it.
- "connect" / "disconnect" — add/remove an edge (\`from\`,\`to\` = step id or ref). connect takes an optional branch \`condition\`.
- "set_cluster" — group this workflow under a cluster (\`cluster\` = slug or id from dopl_cluster(op='list')); omit \`cluster\` to ungroup.
- "list_trash" — list soft-deleted workflows in this workspace (the recovery surface). Each shows name, slug, and when it was deleted. Run it before "restore_workflow" to find the slug/id.
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
                return opList(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return opGet(client, args.slug, args.detail);
            }
            case "step": {
                const miss = (0, respond_1.missingParams)("step", args, ["slug", "step"]);
                if (miss)
                    return miss;
                return opStep(client, args.slug, args.step);
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
                return opConnect(client, args.slug, args.from, args.to, args.condition);
            }
            case "disconnect": {
                const miss = (0, respond_1.missingParams)("disconnect", args, ["slug", "from", "to"]);
                if (miss)
                    return miss;
                return opDisconnect(client, args.slug, args.from, args.to);
            }
            case "set_cluster": {
                const miss = (0, respond_1.missingParams)("set_cluster", args, ["slug"]);
                if (miss)
                    return miss;
                return opSetCluster(client, args.slug, args.cluster);
            }
            case "list_trash":
                return opListTrash(client);
            case "restore_workflow": {
                const miss = (0, respond_1.missingParams)("restore_workflow", args, ["slug"]);
                if (miss)
                    return miss;
                return opRestoreWorkflow(client, args.slug);
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
// ── render helpers ───────────────────────────────────────────────────
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
function renderReads(reads) {
    return reads
        .map((r) => r.kind === "file"
        ? `${r.name} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
        : `${r.name} (knowledge base, kb_id: ${r.kbId})`)
        .join("; ");
}
function renderActions(actions) {
    return actions.map((a) => `${a.name} (skill, skill_id: ${a.skillId})`).join("; ");
}
/**
 * Clean "no such workflow" guidance for a backend 404 on a slug-addressed
 * op — mirrors the isNotFound mapping opDisconnect / dopl_cluster_admin use,
 * so authors get a recoverable message instead of a raw "HTTP 404: {json}".
 */
function workflowNotFound(slug) {
    return (0, respond_1.err)(`No workflow \`${slug}\` in this workspace. Run dopl_workflow(op="list") to see valid slugs/ids.`);
}
// ── ops ──────────────────────────────────────────────────────────────
async function opList(client) {
    const { workflows } = await client.listWorkflows();
    if (workflows.length === 0)
        return (0, respond_1.ok)("No workflows found.");
    const lines = workflows.map((w) => {
        const steps = w.step_count ?? 0;
        const kbs = w.knowledge_base_count ?? 0;
        const skills = w.skill_count ?? 0;
        const parts = [
            steps > 0 ? plural(steps, "step") : null,
            kbs > 0 ? plural(kbs, "knowledge base") : null,
            skills > 0 ? plural(skills, "skill") : null,
        ].filter(Boolean);
        const summary = parts.length === 0 ? "empty" : parts.join(" · ");
        return `- **${w.name}** (slug: \`${w.slug}\`) — ${summary}`;
    });
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug, detail) {
    const wf = await client.getWorkflow(slug);
    const summaryOnly = detail === "summary";
    const lines = [];
    lines.push(`# Workflow: ${wf.name}`);
    lines.push(`Slug: \`${wf.slug}\` · id: \`${wf.id}\`${wf.cluster_id ? ` · cluster id: \`${wf.cluster_id}\`` : " · no cluster"} · updated ${wf.updated_at}`);
    if (wf.description)
        lines.push(wf.description);
    lines.push("");
    const steps = wf.graph?.nodes ?? [];
    if (steps.length > 0) {
        const graphEdges = wf.graph?.edges ?? [];
        // ── Hierarchy: stages + per-step dependencies ────────────────────
        // Stage = longest-path depth from the entry steps (steps arrive
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
        const nextEdgesOf = (id) => graphEdges.filter((e) => e.from === id);
        const stageCount = Math.max(...[...stage.values()]) + 1;
        if (summaryOnly) {
            lines.push(`## Steps (${steps.length}) — ${plural(stageCount, "stage")}`);
            for (let i = 0; i < steps.length; i++) {
                const n = steps[i];
                lines.push(`- Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\` — stage ${(stage.get(n.id) ?? 0) + 1}`);
            }
            lines.push("");
        }
        else {
            lines.push(`## Steps (${steps.length}) — execution order`);
            lines.push(`Topologically ordered into ${plural(stageCount, "stage")}. Stages run IN SEQUENCE; steps in the SAME stage have no dependency between them and are parallel branches — do them in any order (or concurrently) before moving to the next stage. Each step's "Depends on" / "Leads to" lines give the exact edges (with branch conditions). Per step: READ (knowledge), ACTIONS (skills), expected user input, the output to produce, and when to advance.`);
            lines.push("");
            for (let i = 0; i < steps.length; i++) {
                const n = steps[i];
                lines.push(`### Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\` (ref: \`${n.ref}\`) — stage ${(stage.get(n.id) ?? 0) + 1} of ${stageCount}`);
                if (n.description)
                    lines.push(n.description);
                const prev = prevOf(n.id);
                const next = nextEdgesOf(n.id);
                lines.push(prev.length === 0
                    ? `- Depends on: nothing — entry step`
                    : `- Depends on: ${prev.map(label).join(", ")}${prev.length > 1 ? " (all must be done first)" : ""}`);
                lines.push(next.length === 0
                    ? `- Leads to: nothing — terminal step`
                    : `- Leads to: ${next.map((e) => `${label(e.to)}${e.condition ? ` when ${e.condition}` : ""}`).join(", ")}${next.length > 1 ? " (branches)" : ""}`);
                if (n.reads.length > 0)
                    lines.push(`- Read: ${renderReads(n.reads)}`);
                if (n.actions.length > 0)
                    lines.push(`- Action: ${renderActions(n.actions)}`);
                if (n.userInput)
                    lines.push(`- User input: ${n.userInput}`);
                if (n.agentOutput)
                    lines.push(`- Agent output: ${n.agentOutput}`);
                if (n.nextInstructions)
                    lines.push(`- Next: ${n.nextInstructions}`);
                lines.push("");
            }
            if (graphEdges.length > 0) {
                lines.push(`Connections: ${graphEdges.map((e) => `\`${e.from}\` → \`${e.to}\`${e.condition ? ` [${e.condition}]` : ""}`).join(", ")}`);
                lines.push("");
            }
        }
    }
    else {
        lines.push("_No steps authored into this workflow yet._");
        lines.push("");
    }
    if (wf.knowledge_bases.length > 0) {
        if (summaryOnly) {
            lines.push(`## Knowledge Bases: ${wf.knowledge_bases
                .map((kb) => `${kb.name} (\`${kb.slug}\`, ${kb.entries_index.length} entries)`)
                .join(", ")}`);
            lines.push("");
        }
        else {
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
    }
    if (wf.skills.length > 0) {
        if (summaryOnly) {
            lines.push(`## Skills: ${wf.skills
                .map((sk) => `${sk.name} (\`${sk.slug}\`, ${sk.status})`)
                .join(", ")}`);
            lines.push("");
        }
        else {
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
    }
    if (summaryOnly) {
        lines.push(`_Summary view — pass detail="full" for step details, entry indexes, and skill procedures._`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opStep(client, slug, stepRef) {
    const wf = await client.getWorkflow(slug);
    const steps = wf.graph?.nodes ?? [];
    const edges = wf.graph?.edges ?? [];
    const step = steps.find((s) => s.id === stepRef || s.ref === stepRef);
    if (!step) {
        return (0, respond_1.err)(`Step \`${stepRef}\` not found in workflow \`${slug}\`. Run op="get" to list step ids/refs.`);
    }
    const byId = new Map(steps.map((s) => [s.id, s]));
    const nameOf = (id) => {
        const s = byId.get(id);
        return s ? `\`${s.ref}\`${s.title ? ` (${s.title})` : ""}` : `\`${id}\``;
    };
    const outgoing = edges.filter((e) => e.from === step.id);
    const incoming = edges.filter((e) => e.to === step.id).length;
    const lines = [];
    lines.push(`# Step: ${step.title || "(untitled)"}`);
    lines.push(`Workflow: \`${wf.slug}\` · step id: \`${step.id}\` · ref: \`${step.ref}\``);
    if (step.description)
        lines.push("", step.description);
    lines.push("");
    lines.push(incoming === 0
        ? `- Entry step — no incoming edges.`
        : `- Incoming edges: ${incoming}.`);
    if (step.reads.length > 0)
        lines.push(`- Read: ${renderReads(step.reads)}`);
    if (step.actions.length > 0)
        lines.push(`- Action: ${renderActions(step.actions)}`);
    if (step.userInput)
        lines.push(`- User input: ${step.userInput}`);
    if (step.agentOutput)
        lines.push(`- Agent output: ${step.agentOutput}`);
    if (step.nextInstructions)
        lines.push(`- Next: ${step.nextInstructions}`);
    lines.push("");
    if (outgoing.length === 0) {
        lines.push(`- Leads to: nothing — terminal step.`);
    }
    else {
        lines.push(`- Leads to:`);
        for (const e of outgoing) {
            lines.push(`  → ${nameOf(e.to)}${e.condition ? ` when ${e.condition}` : ""}`);
        }
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreate(client, name) {
    const wf = await client.createWorkflow(name);
    return (0, respond_1.ok)(`Created workflow **${wf.name}** (slug: \`${wf.slug}\`). Now author its graph with op="set_graph" (or add_node + connect), then op="get" to verify.`);
}
async function opUpdate(client, slug, name, description) {
    let wf;
    try {
        wf = await client.updateWorkflow(slug, { name, description });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return workflowNotFound(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Updated workflow **${wf.name}** (slug: \`${wf.slug}\`).`);
}
async function opSetGraph(client, slug, graph) {
    // ref is required for every node in set_graph.
    for (const n of graph.nodes) {
        if (!n.ref)
            return (0, respond_1.err)("Every node in `graph.nodes` needs a `ref`.");
    }
    try {
        await client.setWorkflowGraph(slug, graph);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return workflowNotFound(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Set workflow \`${slug}\` graph: ${graph.nodes.length} step(s), ${graph.edges.length} edge(s). Run op="get" to see the ordered steps.`);
}
async function opAddNode(client, slug, node, connectFrom) {
    const payload = { ...node, connect_from: connectFrom };
    const { node_id } = await client.addWorkflowNode(slug, payload);
    return (0, respond_1.ok)(`Added step \`${node_id}\` to workflow \`${slug}\`${connectFrom ? ` (connected from ${connectFrom})` : " (entry step)"}.`);
}
async function opUpdateNode(client, slug, nodeId, node) {
    try {
        await client.updateWorkflowNode(slug, nodeId, node);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't update step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Updated step \`${nodeId}\` in workflow \`${slug}\`.`);
}
async function opRemoveNode(client, slug, nodeId) {
    try {
        await client.removeWorkflowNode(slug, nodeId);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't remove step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Removed step \`${nodeId}\` from workflow \`${slug}\`.`);
}
async function opConnect(client, slug, from, to, condition) {
    try {
        await client.connectWorkflow(slug, from, to, condition);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't connect \`${from}\` → \`${to}\` — workflow \`${slug}\` or one of those steps doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Connected \`${from}\` → \`${to}\` in workflow \`${slug}\`${condition ? ` when ${condition}` : ""}.`);
}
async function opDisconnect(client, slug, from, to) {
    try {
        await client.disconnectWorkflow(slug, from, to);
    }
    catch (e) {
        // Backend now 404s when no such edge existed; report that instead of a
        // false "disconnected" success the author would trust.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No edge \`${from}\` → \`${to}\` in workflow \`${slug}\` — nothing disconnected. Run op="get" to see current connections.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Disconnected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}
async function opSetCluster(client, slug, cluster) {
    // Empty / omitted → ungroup the workflow.
    if (!cluster || !cluster.trim()) {
        let wf;
        try {
            wf = await client.updateWorkflow(slug, { clusterId: null });
        }
        catch (e) {
            if ((0, respond_1.isNotFound)(e))
                return workflowNotFound(slug);
            throw e;
        }
        return (0, respond_1.ok)(`Workflow **${wf.name}** (slug: \`${wf.slug}\`) is now ungrouped (no cluster).`);
    }
    // The API takes a cluster UUID; agents hold slugs, so resolve slug-or-id
    // → id via the cluster list.
    const { clusters } = await client.listClusters();
    const match = clusters.find((c) => c.id === cluster || c.slug === cluster);
    if (!match) {
        return (0, respond_1.err)(`Cluster not found: \`${cluster}\`. Run dopl_cluster(op="list") to see valid clusters.`);
    }
    let wf;
    try {
        wf = await client.updateWorkflow(slug, { clusterId: match.id });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return workflowNotFound(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Grouped workflow **${wf.name}** (slug: \`${wf.slug}\`) under cluster **${match.name}** (slug: \`${match.slug}\`).`);
}
async function opListTrash(client) {
    const { workflows } = await client.listWorkflowTrash();
    if (workflows.length === 0)
        return (0, respond_1.ok)("Workflow trash is empty.");
    const lines = [
        `## Workflow trash (${plural(workflows.length, "workflow")})\n`,
    ];
    for (const w of workflows) {
        lines.push(`- **${w.name}** (slug: \`${w.slug}\`) — deleted ${w.deleted_at}`);
    }
    lines.push("");
    lines.push(`Restore one with \`dopl_workflow(op='restore_workflow', slug='<slug or id>')\`.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRestoreWorkflow(client, slug) {
    let wf;
    try {
        wf = await client.restoreWorkflow(slug);
    }
    catch (e) {
        // 404 = nothing in trash matched. Point at the trash listing, not
        // op="list" (which only shows live workflows).
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No deleted workflow matches \`${slug}\`. Run dopl_workflow(op="list_trash") to see restorable workflows; it may already be active.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored workflow **${wf.name}** (slug: \`${wf.slug}\`). Its steps + edges are back — run op="get" to verify.`);
}
