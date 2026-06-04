"use strict";
/**
 * `dopl_brain` — read + maintain a cluster's brain (instructions + memories).
 *
 * Consolidates the old `dopl_brain(op='get')`, `dopl_brain(op='update_instructions')`,
 * `dopl_brain(op='save_memory')`, `dopl_brain(op='update_memory')`, and `dopl_brain(op='template')`
 * tools. Follows the canonical pattern in `setups.ts`: a single `register(...)`
 * with an `op` enum + a flat schema of all per-op params (optional), a handler
 * that switches on `op`, validates required params via `missingParams`, then
 * calls the existing `client.*` method. Op bodies are lifted verbatim.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBrainTools = registerBrainTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const templates_js_1 = require("../templates.js");
const DESCRIPTION = `Read and maintain a cluster's brain (synthesized instructions + numbered user memories). Set \`op\` to one of:
- "get" — Read the current brain for a cluster — synthesized instructions plus numbered user memories. **Call this on first invocation per session of a cluster's skill** so the body you execute against reflects edits made via the web UI or other agents since the last fetch. Also call before op="update_instructions" (so surgical edits preserve existing text), before op="update_memory" / delete (to get memory IDs), and any time you want to know what durable knowledge already exists for a cluster before adding more.
- "update_instructions" — **Call this when the user gives structural feedback** that should change the skill's instructions for future sessions — corrections to steps ('step 3 is wrong'), additions of new use cases ('let's also handle …'), removal of stale guidance ('drop the part about …'), or scope expansions tied to a new entry. Do this in the background, no permission ask. ALWAYS call op="get" first and edit SURGICALLY — replace only the affected section, preserve the rest verbatim. The canonical structure has these section headings: \`## When to use this skill\`, \`## Instructions\`, \`## Step-by-step\`, \`## Examples\`, \`## Anti-patterns\`, \`## When to save a memory\`, \`## When to update this skill\`, \`## References\`. Missing structural sections trigger a non-blocking warning in the response. Routing: short preferences and environment facts go through op="save_memory"; revising an existing memory goes through op="update_memory". See the server instructions for the full when-to-edit-what decision rules.
- "save_memory" — **Call this proactively** after any user turn that carries durable signal about a cluster — do NOT wait for 'remember this' phrasing. Write silently in the same turn, before composing your reply. Three categories fire this op: (1) **Preferences / env facts** — 'I prefer X over Y', 'always use Z', 'skip that step', 'for my setup …', 'in my environment …', 'from now on …', 'my <env var / value> is …'. (2) **Soft corrections** — 'no', 'actually …', 'that's not right', 'you got X backwards', 'the answer is Y, not Z' (even without canonical wrong-phrasing). (3) **Outcome dissatisfaction** — 'I tried that, it didn't work', 'the output wasn't what I wanted', 'ran it and got the wrong result', 'this approach gave me garbage', 'that didn't produce X'. Category 3 is the highest-signal — the skill led the agent astray and the user is telling you; capture the lesson as a memory describing the gotcha. Memories override the base instructions in future sessions. Routing: use op="update_memory" instead if a near-duplicate memory exists (call op="get" first to check IDs); escalate to op="update_instructions" if the issue is structural to the workflow itself rather than a single fact. Optional \`scope\` enum (workspace|personal).
- "update_memory" — Revise the text of an EXISTING memory in place. Use this when the user refines or corrects a preference you already saved — avoids accumulating near-duplicate memories. Call op="get" first to get memory IDs and current text. For a genuinely new preference with no existing counterpart, use op="save_memory".
- "template" — Fetch the canonical skill synthesis prompt + expected output structure. Use this whenever you need to generate or restructure a cluster brain — e.g. right after \`dopl_cluster(op='create')\` (initial synthesis), when restructuring a flat/legacy brain, or when a op="update_instructions" response returned a structure warning. The server does NOT run synthesis for you; paste the returned prompt into your context, feed it the entries' agents.md from \`get_cluster(slug)\`, produce a structured body, then call op="update_instructions" with the body. No credits are charged by this op.`;
function registerBrainTools(register, client) {
    register("dopl_brain", DESCRIPTION, {
        op: zod_1.z
            .enum(["get", "update_instructions", "save_memory", "update_memory", "template"])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=get|update_instructions|save_memory|update_memory: cluster slug."),
        instructions: zod_1.z
            .string()
            .optional()
            .describe("op=update_instructions: new brain instructions (markdown). This REPLACES the previous instructions — include everything you want kept."),
        memory: zod_1.z
            .string()
            .optional()
            .describe("op=save_memory: the preference or correction to remember, e.g. 'User prefers Resend over SendGrid for email' or 'Skip the Slack notification step'."),
        scope: zod_1.z
            .enum(["workspace", "personal"])
            .optional()
            .describe("op=save_memory: visibility scope. Default 'workspace' — every member of this canvas sees the memory and the skill embeds it for everyone. Use 'personal' when the user says 'for my setup', 'in my env', 'on my machine', or shares a fact only meaningful to themselves (their API key path, their preferred local tool, their personal alias). Personal memories are visible only to the author and never written to the shared canvas brain panel."),
        memory_id: zod_1.z
            .string()
            .optional()
            .describe("op=update_memory: memory ID to update."),
        content: zod_1.z
            .string()
            .optional()
            .describe("op=update_memory: new memory content (fully replaces the prior text)."),
    }, async (args) => {
        switch (args.op) {
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return opGet(client, args.slug);
            }
            case "update_instructions": {
                const miss = (0, respond_1.missingParams)("update_instructions", args, ["slug", "instructions"]);
                if (miss)
                    return miss;
                return opUpdateInstructions(client, args.slug, args.instructions);
            }
            case "save_memory": {
                const miss = (0, respond_1.missingParams)("save_memory", args, ["slug", "memory"]);
                if (miss)
                    return miss;
                return opSaveMemory(client, args.slug, args.memory, args.scope);
            }
            case "update_memory": {
                const miss = (0, respond_1.missingParams)("update_memory", args, ["slug", "memory_id", "content"]);
                if (miss)
                    return miss;
                return opUpdateMemory(client, args.slug, args.memory_id, args.content);
            }
            case "template":
                return opTemplate(client);
        }
    });
}
async function opGet(client, slug) {
    const brain = await client.getClusterBrain(slug);
    // Return the brain as a complete SKILL.md body so Claude Code can
    // treat it as the canonical skill content at invocation time —
    // no translation or assembly step on the agent's side. If the
    // instructions are already section-structured, they carry through;
    // if they're flat (legacy), they render as a plain body and the
    // consumer still gets usable content.
    const sections = [];
    sections.push(`# Skill: ${slug}`);
    sections.push("");
    sections.push(`> Canonical skill body for cluster \`${slug}\`, fetched from Dopl. Treat this as the full SKILL.md body — execute against it directly. If you need to modify it, call \`dopl_brain(op='update_instructions')\` for structural changes or \`dopl_brain(op='save_memory')\` for short preferences.`);
    sections.push("");
    // Inject the self-maintenance protocol so the executing agent
    // always has the canonical routing rules (when to save_cluster_memory
    // vs update_cluster_brain) on first contact with the cluster.
    sections.push((0, templates_js_1.brainProtocolPreamble)(slug));
    if (brain.instructions && brain.instructions.trim().length > 0) {
        // If the brain already has the canonical section headings, pass
        // through as-is. Otherwise wrap the flat text in an Instructions
        // section so the body still parses as a valid skill.
        if (brain.instructions.includes("## When to use") || brain.instructions.includes("## Instructions")) {
            sections.push(brain.instructions.trim());
        }
        else {
            sections.push("## Instructions");
            sections.push("");
            sections.push(brain.instructions.trim());
        }
        sections.push("");
    }
    else {
        sections.push("## Instructions");
        sections.push("");
        sections.push(`_This brain is empty._ Synthesize one: call \`dopl_brain(op='template')\` for the canonical prompt, run synthesis in your context against \`dopl_cluster({ op: "get", slug: "${slug}" })\`, then call \`dopl_brain({ op: "update_instructions", slug: "${slug}", instructions: <result> })\`.`);
        sections.push("");
    }
    // Memories always render as their own section so the agent can
    // distinguish durable structural guidance from user-specific
    // overrides. IDs are kept for update/delete tool targeting.
    if (brain.memories.length > 0) {
        sections.push("## User Memories");
        sections.push("");
        sections.push("_Persistent user preferences and corrections. These override the base instructions above when they conflict._");
        sections.push("");
        for (let i = 0; i < brain.memories.length; i++) {
            sections.push(`${i + 1}. ${brain.memories[i].content} _(id: \`${brain.memories[i].id}\`)_`);
        }
        sections.push("");
    }
    return (0, respond_1.ok)(sections.join("\n"));
}
async function opUpdateInstructions(client, slug, instructions) {
    const result = await client.updateClusterBrain(slug, instructions);
    // Surface the backend's advisory structure check so the agent learns
    // what a proper brain looks like and self-corrects next time.
    let warningNote = "";
    if (result.structure_warning) {
        warningNote =
            `\n\n⚠️ Structure warning: brain is missing required sections: ${result.structure_warning.missing_sections.join(", ")}. ` +
                `The write succeeded, but the skill will produce weaker results at invocation time. ` +
                `Call \`dopl_brain(op='template')\` for the canonical structure and consider re-synthesizing.`;
    }
    return (0, respond_1.ok)(`Updated brain for cluster "${slug}" (${instructions.length} chars).${warningNote}`);
}
async function opSaveMemory(client, slug, memory, scope) {
    let result;
    try {
        result = await client.saveClusterMemory(slug, memory, scope);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return (0, respond_1.err)(`Failed to save memory for cluster "${slug}": ${msg}`);
    }
    const scopeLabel = result.scope === "personal" ? " (personal)" : "";
    return (0, respond_1.ok)(`Saved memory${scopeLabel} for cluster "${slug}": "${result.content}"`);
}
async function opUpdateMemory(client, slug, memory_id, content) {
    const updated = await client.updateClusterMemory(slug, memory_id, content);
    return (0, respond_1.ok)(`Updated memory for cluster "${slug}": "${updated.content}"`);
}
async function opTemplate(client) {
    const tpl = await client.getSkillTemplate();
    return (0, respond_1.ok)(tpl.payload);
}
