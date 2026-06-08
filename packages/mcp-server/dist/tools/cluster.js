"use strict";
/**
 * `dopl_cluster` + `dopl_cluster_admin` — cluster read/non-destructive writes
 * and the separately permission-gated destructive cluster operations.
 *
 * Follows the canonical consolidation pattern (see `setups.ts`): a single
 * `register(...)` per tool with an `op` enum + a flat schema of all per-op
 * params (optional at the schema level), a handler that switches on `op`,
 * validates required params for the chosen op via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old per-tool
 * handlers in `server.ts` — only restructured into functions, logic and output
 * text unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClusterTools = registerClusterTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
// Local copy of the server-side constant used inside get_cluster's body.
const CONTEXT_CHAR_BUDGET = 2000;
const CLUSTER_DESCRIPTION = `Read and non-destructively modify Dopl clusters (curated groupings of setups). Set \`op\` to one of:
- "list" — discover all clusters in the knowledge base. Cheap metadata call; run it proactively to show the user their workspace or to resolve a slug another op needs, rather than asking for a slug.
- "get" — retrieve a cluster's metadata plus member entries, attached knowledge bases, and attached skills. Use before answering what's in a cluster or what KBs/skills it can access. KB attachments include an entries_index (read a body via op="read_knowledge_entry"); skill bodies are truncated (full procedure via op="read_skill"). For searching inside a cluster, use op="query".
- "query" — semantic search scoped to the entries inside ONE cluster. Use when a cluster is already the focus and the user wants to find something within it — NOT for broad discovery (use the \`search_setups\` tool for cross-KB search). If you lack a slug, run op="list" first.
- "create" — create a new cluster from entries already on the user's canvas. Use on "group these into a cluster", "make a cluster for X", or when canvas panels have grown enough that clustering helps. For adding one entry to an existing cluster, use op="add_entry".
- "update" — rename a cluster or REPLACE its entry membership with a new set of entry IDs. Covers both structural edits and plain renames (pass just \`name\`). For adding a single entry without replacing the whole set, use op="add_entry" (less destructive).
- "add_entry" — add a single entry to an existing cluster to expand its membership. To create a brand-new cluster, use op="create".
- "read_knowledge_entry" — read the full body of one entry inside a knowledge base attached to the cluster. Find the (kb id, entry id) pair via op="get" first. 404s if the KB isn't attached or the entry doesn't exist.
- "read_skill" — read the full body of every file (SKILL.md + supplementary) for a skill attached to the cluster. Find the skill_id via op="get" first. Use when the truncated body from op="get" isn't enough. 404s if the skill isn't attached.`;
const CLUSTER_ADMIN_DESCRIPTION = `DESTRUCTIVE cluster operations — permanent and irreversible. Each op deletes data; confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_cluster" — permanently delete a cluster grouping. Individual entries REMAIN in the KB and on the user's canvas; only the cluster is removed. Use when the user explicitly asks to drop a cluster.
- "delete_entry" — PERMANENTLY remove an entry from the knowledge base. Use only when the user explicitly asks. Irreversible — chunks, tags, sources, and the entry row are all dropped. Canvas panels owned by other users that reference it become missing-entry placeholders. Ask for confirmation before calling if intent is ambiguous.`;
function registerClusterTools(register, client) {
    register("dopl_cluster", CLUSTER_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "get",
            "query",
            "create",
            "update",
            "add_entry",
            "read_knowledge_entry",
            "read_skill",
        ])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=get/update/add_entry: cluster slug from op=list."),
        cluster_slug: zod_1.z
            .string()
            .optional()
            .describe("op=query/read_knowledge_entry/read_skill: cluster slug."),
        query: zod_1.z
            .string()
            .optional()
            .describe("op=query: natural language search query."),
        max_results: zod_1.z
            .number()
            .optional()
            .describe("op=query: max results (default 5)."),
        name: zod_1.z
            .string()
            .optional()
            .describe("op=create: cluster name, e.g. 'AI Agent Stack'. op=update: new cluster name."),
        entries: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("op=create: entry slugs or UUIDs to include (must be on your canvas)."),
        entry_ids: zod_1.z
            .array(zod_1.z.string())
            .optional()
            .describe("op=update: new set of entry IDs (replaces existing membership)."),
        entry: zod_1.z
            .string()
            .optional()
            .describe("op=add_entry: entry slug or UUID to add to the cluster."),
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
            case "query": {
                const miss = (0, respond_1.missingParams)("query", args, ["cluster_slug", "query"]);
                if (miss)
                    return miss;
                return opQuery(client, args.cluster_slug, args.query, args.max_results);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name", "entries"]);
                if (miss)
                    return miss;
                return opCreate(client, args.name, args.entries);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                return opUpdate(client, args.slug, args.name, args.entry_ids);
            }
            case "add_entry": {
                const miss = (0, respond_1.missingParams)("add_entry", args, ["slug", "entry"]);
                if (miss)
                    return miss;
                return opAddEntry(client, args.slug, args.entry);
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
            .enum(["delete_cluster", "delete_entry"])
            .describe("Destructive operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=delete_cluster: cluster slug."),
        entry: zod_1.z
            .string()
            .optional()
            .describe("op=delete_entry: entry slug or UUID to delete."),
    }, async (args) => {
        switch (args.op) {
            case "delete_cluster": {
                const miss = (0, respond_1.missingParams)("delete_cluster", args, ["slug"]);
                if (miss)
                    return miss;
                return opDeleteCluster(client, args.slug);
            }
            case "delete_entry": {
                const miss = (0, respond_1.missingParams)("delete_entry", args, ["entry"]);
                if (miss)
                    return miss;
                return opDeleteEntry(client, args.entry);
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
 * Compose a one-line summary of what a cluster actually contains —
 * entries/setups AND attached knowledge bases AND skills — so "what's in
 * this cluster?" is answered accurately even when it holds no entry panels.
 */
function clusterContentSummary(c) {
    const entries = c.panel_count ?? 0;
    const kbs = c.knowledge_base_count ?? 0;
    const skills = c.skill_count ?? 0;
    if (entries === 0 && kbs === 0 && skills === 0)
        return "empty";
    const parts = [];
    if (entries > 0)
        parts.push(plural(entries, "setup"));
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
    // Lead with a composed summary of what the cluster actually contains so
    // the answer to "what's in this cluster?" is accurate even when it holds
    // no entry panels (e.g. a cluster that's all knowledge bases + skills).
    lines.push(`**Contains:** ${clusterContentSummary({
        panel_count: cluster.entries.length,
        knowledge_base_count: cluster.knowledge_bases.length,
        skill_count: cluster.skills.length,
        knowledge_base_names: cluster.knowledge_bases.map((kb) => kb.name),
        skill_names: cluster.skills.map((sk) => sk.name),
    })}`);
    lines.push("");
    if (cluster.entries.length > 0) {
        lines.push(`## Entries\n`);
        for (const e of cluster.entries) {
            const title = e.title || "Untitled";
            const url = client.entryUrl(e.slug);
            const heading = url ? `[${title}](${url})` : title;
            lines.push(`### ${heading}`);
            if (e.summary)
                lines.push(e.summary);
            if (e.readme) {
                lines.push(`\nREADME:\n${e.readme.slice(0, CONTEXT_CHAR_BUDGET)}`);
            }
            if (e.agents_md) {
                lines.push(`\nagents.md:\n${e.agents_md.slice(0, CONTEXT_CHAR_BUDGET)}`);
            }
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
async function opQuery(client, cluster_slug, query, max_results) {
    const result = await client.queryCluster(cluster_slug, query, max_results);
    const lines = [];
    lines.push(`## Cluster Search: "${query}" in ${result.cluster_slug} (${result.results.length} results)\n`);
    for (const r of result.results) {
        const title = r.title || "Untitled";
        const url = client.entryUrl(r.slug);
        const heading = url ? `[${title}](${url})` : title;
        lines.push(`### ${heading} (${Math.round(r.similarity * 100)}% match)`);
        if (r.summary)
            lines.push(r.summary);
        lines.push("");
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreate(client, name, entries) {
    // Validate entries exist (and resolve slug → UUID where needed) before creating cluster.
    const validationErrors = [];
    const resolvedIds = [];
    for (const ref of entries) {
        try {
            const entry = await client.getSetup(ref);
            resolvedIds.push(entry.id);
        }
        catch {
            validationErrors.push(ref);
        }
    }
    if (validationErrors.length > 0) {
        return (0, respond_1.ok)(`Entries not found: ${validationErrors.join(", ")}. Use \`search_setups\` to find valid entries.`);
    }
    const result = await client.createCluster(name, resolvedIds);
    const slug = result.slug;
    return (0, respond_1.ok)(`Created cluster **${result.name}** (slug: \`${slug}\`) with ${result.panel_count ?? resolvedIds.length} entries.`);
}
async function opUpdate(client, slug, name, entry_ids) {
    const updates = {};
    if (name)
        updates.name = name;
    if (entry_ids)
        updates.entry_ids = entry_ids;
    const result = await client.updateCluster(slug, updates);
    return (0, respond_1.ok)(`Updated cluster **${result.name}** (slug: \`${result.slug}\`) — ${result.panel_count ?? 0} entries.`);
}
async function opAddEntry(client, slug, entryRef) {
    // Get current cluster to build updated entry list
    const detail = await client.getCluster(slug);
    const existingIds = detail.entries.map((e) => e.entry_id);
    // Validate entry exists and resolve slug → UUID for cluster membership.
    const newEntry = await client.getSetup(entryRef);
    const newEntryId = newEntry.id;
    const title = newEntry.title || "Untitled";
    const url = client.entryUrl(newEntry.slug);
    const label = url ? `[${title}](${url})` : title;
    if (existingIds.includes(newEntryId)) {
        return (0, respond_1.ok)(`**${label}** is already in cluster "${slug}".`);
    }
    // Add entry to cluster membership.
    const updatedIds = [...existingIds, newEntryId];
    await client.updateCluster(slug, { entry_ids: updatedIds });
    return (0, respond_1.ok)(`Added **${label}** to cluster "${slug}" (now ${updatedIds.length} entries).`);
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
    return (0, respond_1.ok)(`Deleted cluster \`${slug}\`. Entries remain in the knowledge base.`);
}
async function opDeleteEntry(client, entry) {
    await client.deleteEntry(entry);
    return (0, respond_1.ok)(`Deleted entry from the knowledge base.`);
}
