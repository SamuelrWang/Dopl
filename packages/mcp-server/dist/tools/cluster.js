"use strict";
/**
 * `dopl_cluster` + `dopl_cluster_admin` — cluster read/non-destructive writes
 * and the separately permission-gated destructive cluster operations.
 *
 * Clusters are containers for attached knowledge bases + skills.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClusterTools = registerClusterTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const CLUSTER_DESCRIPTION = `Read and non-destructively modify Dopl clusters (curated groupings of knowledge bases + skills). Set \`op\` to one of:
- "list" — discover all clusters. Cheap metadata call; run it proactively to show the user their workspace or to resolve a slug another op needs, rather than asking for a slug.
- "get" — retrieve a cluster's metadata plus attached knowledge bases and skills. Use before answering what's in a cluster or what KBs/skills it can access. KB attachments include an entries_index (read a body via op="read_knowledge_entry"); skill bodies are truncated (full procedure via op="read_skill").
- "create" — create a new, empty cluster by name. Use on "make a cluster for X". Attach knowledge bases / skills to it as a separate step.
- "update" — rename a cluster (pass \`name\`).
- "read_knowledge_entry" — read the full body of one entry inside a knowledge base attached to the cluster. Find the (kb id, entry id) pair via op="get" first. 404s if the KB isn't attached or the entry doesn't exist.
- "read_skill" — read the full body of every file (SKILL.md + supplementary) for a skill attached to the cluster. Find the skill_id via op="get" first. Use when the truncated body from op="get" isn't enough. 404s if the skill isn't attached.`;
const CLUSTER_ADMIN_DESCRIPTION = `DESTRUCTIVE cluster operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_cluster" — permanently delete a cluster grouping. Attached knowledge bases + skills REMAIN; only the cluster grouping is removed.`;
function registerClusterTools(register, client) {
    register("dopl_cluster", CLUSTER_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "get",
            "create",
            "update",
            "read_knowledge_entry",
            "read_skill",
        ])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=get/update: cluster slug from op=list."),
        cluster_slug: zod_1.z
            .string()
            .optional()
            .describe("op=read_knowledge_entry/read_skill: cluster slug."),
        name: zod_1.z
            .string()
            .optional()
            .describe("op=create: cluster name, e.g. 'AI Agent Stack'. op=update: new cluster name."),
        description: zod_1.z
            .string()
            .optional()
            .describe("op=update: workflow description (max 300 chars) shown on the cluster's canvas card and in op=get."),
        knowledge_base_id: zod_1.z
            .string()
            .optional()
            .describe("op=read_knowledge_entry: knowledge base UUID."),
        entry_id: zod_1.z
            .string()
            .optional()
            .describe("op=read_knowledge_entry: knowledge entry UUID."),
        skill_id: zod_1.z
            .string()
            .optional()
            .describe("op=read_skill: skill UUID."),
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
            case "read_knowledge_entry": {
                const miss = (0, respond_1.missingParams)("read_knowledge_entry", args, [
                    "cluster_slug",
                    "knowledge_base_id",
                    "entry_id",
                ]);
                if (miss)
                    return miss;
                return opReadKnowledgeEntry(client, args.cluster_slug, args.knowledge_base_id, args.entry_id);
            }
            case "read_skill": {
                const miss = (0, respond_1.missingParams)("read_skill", args, [
                    "cluster_slug",
                    "skill_id",
                ]);
                if (miss)
                    return miss;
                return opReadSkill(client, args.cluster_slug, args.skill_id);
            }
        }
    });
    register("dopl_cluster_admin", CLUSTER_ADMIN_DESCRIPTION, {
        op: zod_1.z
            .enum(["delete_cluster"])
            .describe("Destructive operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=delete_cluster: cluster slug."),
    }, async (args) => {
        switch (args.op) {
            case "delete_cluster": {
                const miss = (0, respond_1.missingParams)("delete_cluster", args, ["slug"]);
                if (miss)
                    return miss;
                return opDeleteCluster(client, args.slug);
            }
        }
    });
}
// ── dopl_cluster ops ─────────────────────────────────────────────────
/** Pluralize a count, e.g. plural(2, "skill") → "2 skills". */
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
/**
 * Compose a one-line summary of what a cluster contains — attached
 * knowledge bases AND skills.
 */
function clusterContentSummary(c) {
    const kbs = c.knowledge_base_count ?? 0;
    const skills = c.skill_count ?? 0;
    if (kbs === 0 && skills === 0)
        return "empty";
    const parts = [];
    if (kbs > 0) {
        const names = c.knowledge_base_names?.length
            ? ` (${c.knowledge_base_names.join(", ")})`
            : "";
        parts.push(`${plural(kbs, "knowledge base")}${names}`);
    }
    if (skills > 0) {
        const names = c.skill_names?.length
            ? ` (${c.skill_names.join(", ")})`
            : "";
        parts.push(`${plural(skills, "skill")}${names}`);
    }
    return parts.join(" · ");
}
async function opList(client) {
    const { clusters } = await client.listClusters();
    if (clusters.length === 0)
        return (0, respond_1.ok)("No clusters found.");
    const lines = clusters.map((c) => `- **${c.name}** (slug: \`${c.slug}\`) — ${clusterContentSummary(c)}`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug) {
    const cluster = await client.getCluster(slug);
    const lines = [];
    lines.push(`# Cluster: ${cluster.name}`);
    lines.push(`Slug: \`${cluster.slug}\``);
    if (cluster.description)
        lines.push(cluster.description);
    lines.push(`**Contains:** ${clusterContentSummary({
        knowledge_base_count: cluster.knowledge_bases.length,
        skill_count: cluster.skills.length,
        knowledge_base_names: cluster.knowledge_bases.map((kb) => kb.name),
        skill_names: cluster.skills.map((sk) => sk.name),
    })}`);
    lines.push("");
    // ── Workflow (node blocks + connectors composed from the canvas) ──
    if (cluster.workflow && cluster.workflow.nodes.length > 0) {
        const wf = cluster.workflow;
        lines.push(`## Workflow (${wf.nodes.length} step${wf.nodes.length === 1 ? "" : "s"})`);
        lines.push(`Steps are topologically ordered. Follow them in order; each step lists what to READ (knowledge), which ACTIONS (skills) to apply, what input to expect from the user, what output to produce, and when to move on.`);
        lines.push("");
        for (let i = 0; i < wf.nodes.length; i++) {
            const n = wf.nodes[i];
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
        if (wf.edges.length > 0) {
            lines.push(`Connections: ${wf.edges.map((e) => `\`${e.from}\` → \`${e.to}\``).join(", ")}`);
            lines.push("");
        }
    }
    if (cluster.knowledge_bases.length > 0) {
        lines.push(`## Attached Knowledge Bases\n`);
        for (const kb of cluster.knowledge_bases) {
            lines.push(`### Knowledge: ${kb.name}`);
            lines.push(`slug: \`${kb.slug}\` · id: \`${kb.knowledge_base_id}\` · agent_write: ${kb.agent_write_enabled ? "on" : "off"}`);
            if (kb.description)
                lines.push(kb.description);
            if (kb.entries_index.length > 0) {
                lines.push(`\nEntries (${kb.entries_index.length}):`);
                for (const e of kb.entries_index.slice(0, 50)) {
                    const path = e.folder_path ? `${e.folder_path}/${e.title}` : e.title;
                    lines.push(`- ${path}  \`(entry_id: ${e.entry_id})\``);
                }
                if (kb.entries_index.length > 50) {
                    lines.push(`- … ${kb.entries_index.length - 50} more`);
                }
                lines.push(`\nTo read a specific entry: \`dopl_cluster({ op: "read_knowledge_entry", cluster_slug: "${cluster.slug}", knowledge_base_id: "${kb.knowledge_base_id}", entry_id: "<entry_id>" })\``);
            }
            lines.push("");
        }
    }
    if (cluster.skills.length > 0) {
        lines.push(`## Attached Skills\n`);
        for (const sk of cluster.skills) {
            lines.push(`### Skill: ${sk.name}`);
            lines.push(`slug: \`${sk.slug}\` · id: \`${sk.skill_id}\` · status: ${sk.status}`);
            if (sk.description)
                lines.push(sk.description);
            if (sk.when_to_use) {
                lines.push(`\n**When to use:** ${sk.when_to_use}`);
            }
            if (sk.body) {
                lines.push(`\nProcedure (truncated):\n${sk.body}`);
                lines.push(`\nFor the full body across all skill files: \`dopl_cluster({ op: "read_skill", cluster_slug: "${cluster.slug}", skill_id: "${sk.skill_id}" })\``);
            }
            lines.push("");
        }
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreate(client, name) {
    const result = await client.createCluster(name);
    return (0, respond_1.ok)(`Created cluster **${result.name}** (slug: \`${result.slug}\`). Attach knowledge bases or skills to populate it.`);
}
async function opUpdate(client, slug, name, description) {
    const result = await client.updateCluster(slug, { name, description });
    return (0, respond_1.ok)(`Updated cluster **${result.name}** (slug: \`${result.slug}\`).`);
}
async function opReadKnowledgeEntry(client, cluster_slug, knowledge_base_id, entry_id) {
    const e = await client.getClusterKnowledgeEntry(cluster_slug, knowledge_base_id, entry_id);
    const path = e.folder_path ? `${e.folder_path}/${e.title}` : e.title;
    const text = [
        `# ${e.title}`,
        `KB: \`${e.knowledge_base_slug}\` · path: \`${path}\``,
        ``,
        e.body,
    ].join("\n");
    return (0, respond_1.ok)(text);
}
async function opReadSkill(client, cluster_slug, skill_id) {
    const sk = await client.getClusterSkill(cluster_slug, skill_id);
    const lines = [];
    lines.push(`# Skill: ${sk.name}`);
    lines.push(`slug: \`${sk.skill_slug}\` · status: ${sk.status}`);
    if (sk.description)
        lines.push(sk.description);
    if (sk.when_to_use)
        lines.push(`\n**When to use:** ${sk.when_to_use}`);
    lines.push("");
    for (const f of sk.files) {
        lines.push(`## ${f.name}\n`);
        lines.push(f.body);
        lines.push("");
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
// ── dopl_cluster_admin ops ───────────────────────────────────────────
async function opDeleteCluster(client, slug) {
    await client.deleteCluster(slug);
    return (0, respond_1.ok)(`Deleted cluster \`${slug}\`. Attached knowledge bases + skills remain.`);
}
