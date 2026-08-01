"use strict";
/**
 * `dopl_workflow` READ op handlers: list, get (metadata + topo-ordered
 * steps + attachments, summary|full), step (one step's walk detail), and
 * list_trash (the recovery surface). Non-mutating. Routed from the
 * registrar in workflow.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opGet = opGet;
exports.opStep = opStep;
exports.opListTrash = opListTrash;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const workflow_render_1 = require("./workflow-render");
/**
 * `listWorkflows` drops teams-mode rows the caller holds no grant on
 * (features/workflows/server/service.ts) and excludes soft-deleted ones, and
 * the rendered list said neither. "No workflows found." in particular was an
 * assertion about the WORKSPACE produced by a per-caller query.
 */
const LIST_SCOPE_NOTE = `_Workflows you can read. Team-scoped ones you hold no grant on are not listed, and soft-deleted ones are in op="list_trash" — so this is not the workspace's workflow count._`;
/** The trash read is scoped harder than the live one; see the op description. */
const TRASH_SCOPE_NOTE = `_Trashed workflows you can see. A trashed TEAMS-SCOPED workflow is visible only to its creator and to admins/owners, so a grantee's empty trash is not proof the workspace's is empty._`;
/**
 * How many of an attachment's entries get rendered. The header printed the
 * INDEX'S FULL LENGTH and then listed at most this many rows, so a base with
 * 300 indexed entries announced 300 and showed 50 with nothing in between —
 * and the index itself is already capped server-side before it arrives.
 */
const KB_ENTRY_ROWS = 50;
async function opList(client) {
    const { workflows } = await client.listWorkflows();
    if (workflows.length === 0) {
        return (0, respond_1.ok)(`No workflows visible to you in this workspace.\n\n${LIST_SCOPE_NOTE}`);
    }
    const lines = workflows.map((w) => {
        const steps = w.step_count ?? 0;
        const kbs = w.knowledge_base_count ?? 0;
        const skills = w.skill_count ?? 0;
        const parts = [
            steps > 0 ? (0, workflow_render_1.plural)(steps, "step") : null,
            kbs > 0 ? (0, workflow_render_1.plural)(kbs, "knowledge base") : null,
            skills > 0 ? (0, workflow_render_1.plural)(skills, "skill") : null,
        ].filter(Boolean);
        const summary = parts.length === 0 ? "empty" : parts.join(" · ");
        return `- ${(0, narration_1.inlineOr)(w.name, workflow_render_1.NO_NAME)} (slug: \`${w.slug}\`) — ${summary}`;
    });
    return (0, respond_1.ok)([...lines, "", LIST_SCOPE_NOTE].join("\n"));
}
async function opGet(client, slug, detail) {
    const wf = await client.getWorkflow(slug);
    const summaryOnly = detail === "summary";
    const lines = [];
    lines.push(`# Workflow ${(0, narration_1.inlineOr)(wf.name, workflow_render_1.NO_NAME)}`);
    lines.push(`Slug: \`${wf.slug}\` · id: \`${wf.id}\`${wf.cluster_id ? ` · cluster id: \`${wf.cluster_id}\`` : " · no cluster"} · updated ${wf.updated_at}`);
    if (wf.description)
        lines.push((0, narration_1.inlineOr)(wf.description, ""));
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
            lines.push(`## Steps (${steps.length}) — ${(0, workflow_render_1.plural)(stageCount, "stage")}`);
            for (let i = 0; i < steps.length; i++) {
                const n = steps[i];
                lines.push(`- Step ${i + 1}: ${(0, narration_1.inlineOr)(n.title, workflow_render_1.NO_TITLE)} \`${n.id}\` — stage ${(stage.get(n.id) ?? 0) + 1}`);
            }
            lines.push("");
        }
        else {
            lines.push(`## Steps (${steps.length}) — execution order`);
            lines.push(`Topologically ordered into ${(0, workflow_render_1.plural)(stageCount, "stage")}. Stages run IN SEQUENCE; steps in the SAME stage have no dependency between them and are parallel branches — do them in any order (or concurrently) before moving to the next stage. Each step's "Depends on" / "Leads to" lines give the exact edges (with branch conditions). Per step: READ (knowledge), ACTIONS (skills), expected user input, the output to produce, and when to advance.`);
            lines.push("");
            for (let i = 0; i < steps.length; i++) {
                const n = steps[i];
                lines.push(`### Step ${i + 1}: ${(0, narration_1.inlineOr)(n.title, workflow_render_1.NO_TITLE)} \`${n.id}\` (ref: \`${n.ref}\`) — stage ${(stage.get(n.id) ?? 0) + 1} of ${stageCount}`);
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
                    lines.push(`- Read: ${(0, workflow_render_1.renderReads)(n.reads)}`);
                if (n.actions.length > 0)
                    lines.push(`- Action: ${(0, workflow_render_1.renderActions)(n.actions)}`);
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
                .map((kb) => `${(0, narration_1.inlineOr)(kb.name, workflow_render_1.NO_NAME)} (\`${kb.slug}\`, ${kb.entries_index.length} entries)`)
                .join(", ")}`);
            lines.push("");
        }
        else {
            lines.push(`## Knowledge Bases\n`);
            for (const kb of wf.knowledge_bases) {
                lines.push(`### Knowledge base ${(0, narration_1.inlineOr)(kb.name, workflow_render_1.NO_NAME)}`);
                lines.push(`slug: \`${kb.slug}\` · id: \`${kb.knowledge_base_id}\``);
                if (kb.description)
                    lines.push((0, narration_1.inlineOr)(kb.description, ""));
                if (kb.entries_index.length > 0) {
                    const shown = kb.entries_index.slice(0, KB_ENTRY_ROWS);
                    lines.push(`\nEntries (${kb.entries_index.length} indexed):`);
                    for (const e of shown) {
                        const path = e.folder_path ? `${e.folder_path}/${e.title}` : e.title;
                        lines.push(`- ${(0, narration_1.inlineOr)(path, workflow_render_1.NO_TITLE)}  \`(entry_id: ${e.entry_id})\``);
                    }
                    // The count above is the INDEX's length, and the index is itself
                    // capped server-side across all attached bases before it gets here —
                    // so neither number is the base's entry count. Say which is which
                    // rather than let the header stand as a total.
                    lines.push(kb.entries_index.length > shown.length
                        ? `_Listing ${shown.length} of ${kb.entries_index.length} INDEXED entries, and the index is capped server-side across all attached bases. Neither number is this base's entry count: dopl_kb(op="get_tree", base="${kb.slug}") is._`
                        : `_This is the attachment INDEX, capped server-side across all attached bases. For the base's real contents: dopl_kb(op="get_tree", base="${kb.slug}")._`);
                }
                lines.push("");
            }
        }
    }
    if (wf.skills.length > 0) {
        if (summaryOnly) {
            lines.push(`## Skills: ${wf.skills
                .map((sk) => `${(0, narration_1.inlineOr)(sk.name, workflow_render_1.NO_NAME)} (\`${sk.slug}\`, ${sk.status})`)
                .join(", ")}`);
            lines.push("");
        }
        else {
            lines.push(`## Skills\n`);
            for (const sk of wf.skills) {
                lines.push(`### Skill ${(0, narration_1.inlineOr)(sk.name, workflow_render_1.NO_NAME)}`);
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
        return (0, respond_1.err)(`Step ${(0, narration_1.inlineOr)(stepRef, "`(unreadable ref)`")} not found in workflow \`${slug}\`. Run op="get" to list step ids/refs.`);
    }
    const byId = new Map(steps.map((s) => [s.id, s]));
    const nameOf = (id) => {
        const s = byId.get(id);
        return s ? `\`${s.ref}\`${s.title ? ` (${(0, narration_1.inlineOr)(s.title, workflow_render_1.NO_TITLE)})` : ""}` : `\`${id}\``;
    };
    const outgoing = edges.filter((e) => e.from === step.id);
    const incoming = edges.filter((e) => e.to === step.id).length;
    const lines = [];
    lines.push(`# Step ${(0, narration_1.inlineOr)(step.title, workflow_render_1.NO_TITLE)}`);
    lines.push(`Workflow: \`${wf.slug}\` · step id: \`${step.id}\` · ref: \`${step.ref}\``);
    if (step.description)
        lines.push("", step.description);
    lines.push("");
    lines.push(incoming === 0
        ? `- Entry step — no incoming edges.`
        : `- Incoming edges: ${incoming}.`);
    if (step.reads.length > 0)
        lines.push(`- Read: ${(0, workflow_render_1.renderReads)(step.reads)}`);
    if (step.actions.length > 0)
        lines.push(`- Action: ${(0, workflow_render_1.renderActions)(step.actions)}`);
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
async function opListTrash(client) {
    const { workflows } = await client.listWorkflowTrash();
    if (workflows.length === 0) {
        return (0, respond_1.ok)(`Nothing in workflow trash that you can see.\n\n${TRASH_SCOPE_NOTE}`);
    }
    const lines = [
        `## Workflow trash (${(0, workflow_render_1.plural)(workflows.length, "workflow")})\n`,
    ];
    for (const w of workflows) {
        lines.push(`- ${(0, narration_1.inlineOr)(w.name, workflow_render_1.NO_NAME)} (slug: \`${w.slug}\`) — deleted ${w.deleted_at}`);
    }
    lines.push("");
    lines.push(`Restore one with \`dopl_workflow(op='restore_workflow', slug='<slug or id>')\`.`);
    lines.push("", TRASH_SCOPE_NOTE);
    return (0, respond_1.ok)(lines.join("\n"));
}
