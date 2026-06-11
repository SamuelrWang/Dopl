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
const WORKFLOW_DESCRIPTION = `Read and non-destructively modify Dopl workflows (a header + its connected node graph; the agent-followable unit). Set \`op\` to one of:
- "list" — discover all workflows. Cheap metadata call; run it proactively to show the user their workspace or to resolve a slug another op needs.
- "get" — retrieve a workflow's metadata, its topologically-ordered steps (each with what to READ, which ACTIONS to apply, user input, agent output, and when to advance), and the knowledge bases + skills it references. Use before answering what a workflow does or executing it.
- "create" — create a new, empty workflow by name. Use on "make a workflow for X". Nodes + connectors are authored on the canvas.
- "update" — rename a workflow (\`name\`) and/or set its \`description\`.`;
const WORKFLOW_ADMIN_DESCRIPTION = `DESTRUCTIVE workflow operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_workflow" — permanently delete a workflow. Its nodes stay on the canvas; attached knowledge bases + skills are detached (not deleted).`;
function registerWorkflowTools(register, client) {
    register("dopl_workflow", WORKFLOW_DESCRIPTION, {
        op: zod_1.z
            .enum(["list", "get", "create", "update"])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=get/update: workflow slug from op=list."),
        name: zod_1.z
            .string()
            .optional()
            .describe("op=create: workflow name. op=update: new name."),
        description: zod_1.z
            .string()
            .max(300, "description is capped at 300 chars")
            .optional()
            .describe("op=update: workflow description (max 300 chars), shown to agents in op=get."),
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
        lines.push(`## Steps (${steps.length})`);
        lines.push(`Topologically ordered. Follow them in order; each step lists what to READ (knowledge), which ACTIONS (skills) to apply, expected user input, the output to produce, and when to advance.`);
        lines.push("");
        for (let i = 0; i < steps.length; i++) {
            const n = steps[i];
            lines.push(`### Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\``);
            if (n.description)
                lines.push(n.description);
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
    return (0, respond_1.ok)(`Created workflow **${wf.name}** (slug: \`${wf.slug}\`). Author its nodes + connectors on the canvas.`);
}
async function opUpdate(client, slug, name, description) {
    const wf = await client.updateWorkflow(slug, { name, description });
    return (0, respond_1.ok)(`Updated workflow **${wf.name}** (slug: \`${wf.slug}\`).`);
}
