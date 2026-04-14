"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const skill_writer_js_1 = require("./skill-writer.js");
const CONTEXT_CHAR_BUDGET = 2000;
const SERVER_INSTRUCTIONS = `You are connected to the **Setup Intelligence Engine (SIE)** — a knowledge base of proven AI and automation implementations including agent workflows, n8n automations, Claude skills, API integrations, and more.

## How to use this

You are an expert architect. Use the SIE tools as your reference library — search for proven patterns, retrieve implementation details, and synthesize custom solutions. Your job is to **compose original recommendations** by combining knowledge from multiple sources, not to list or recommend individual entries.

## What you can do

- **Search** — Find relevant implementations by natural language query
- **Deep dive** — Pull full implementation details (README, setup instructions, metadata) for any entry
- **Build** — Compose a complete solution by combining patterns from multiple implementations
- **Canvas** — Manage the user's workspace: add entries, organize into clusters, browse saved items
- **Skills** — Cluster knowledge is automatically available through Claude Code skills at ~/.claude/skills/sie-*/. Run \`sync_skills\` to seed or refresh them

## Behavior

- When the user describes what they want to build, search first, then synthesize a concrete plan
- Focus on actionable guidance: tool recommendations with rationale, architecture decisions, integration patterns, setup steps
- Reference specific tools, repos, and patterns — not the database entries they came from
- Cluster skills are living documents — update them when you learn new patterns or receive user corrections`;
function createServer(client) {
    const server = new mcp_js_1.McpServer({
        name: "setup-intelligence-engine",
        version: "0.1.0",
    }, {
        instructions: SERVER_INSTRUCTIONS,
    });
    // ── search_setups ──────────────────────────────────────────────────
    server.tool("search_setups", "Search the Setup Intelligence Engine knowledge base for AI/automation setups matching a query. Returns ranked results with summaries and an AI synthesis recommendation.", {
        query: zod_1.z.string().describe("Natural language search query, e.g. 'AI agent for job applications' or 'n8n automation with Supabase'"),
        tags: zod_1.z.array(zod_1.z.string()).optional().describe("Filter by tags, e.g. ['claude', 'playwright']"),
        use_case: zod_1.z.string().optional().describe("Filter by use case category"),
        max_results: zod_1.z.number().optional().describe("Number of results to return (default 5)"),
        include_synthesis: zod_1.z.boolean().optional().describe("Include AI synthesis/recommendation (default true)"),
    }, async (params) => {
        const result = await client.searchSetups(params);
        const lines = [];
        if (result.synthesis) {
            lines.push("## Recommendation");
            lines.push(result.synthesis.recommendation);
            if (result.synthesis.composite_approach) {
                lines.push("\n## Suggested Approach");
                lines.push(result.synthesis.composite_approach);
            }
            lines.push("");
        }
        lines.push(`## Results (${result.entries.length} found)\n`);
        for (const entry of result.entries) {
            lines.push(`### ${entry.title || "Untitled"} (${Math.round(entry.similarity * 100)}% match)`);
            lines.push(`ID: ${entry.entry_id}`);
            if (entry.summary)
                lines.push(entry.summary);
            if (entry.relevance_explanation)
                lines.push(`Relevance: ${entry.relevance_explanation}`);
            lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── get_setup ──────────────────────────────────────────────────────
    server.tool("get_setup", "Get full details of a specific setup from the knowledge base, including README, agents.md (AI setup instructions), and manifest.", {
        id: zod_1.z.string().describe("Entry ID (UUID) from search results"),
    }, async ({ id }) => {
        const entry = await client.getSetup(id);
        const lines = [];
        lines.push(`# ${entry.title || "Untitled"}`);
        if (entry.summary)
            lines.push(`\n${entry.summary}`);
        lines.push(`\nStatus: ${entry.status}`);
        lines.push(`Source: ${entry.source_url}`);
        lines.push(`Platform: ${entry.source_platform || "unknown"}`);
        lines.push(`Complexity: ${entry.complexity || "unknown"}`);
        lines.push(`Use case: ${entry.use_case || "unknown"}`);
        if (entry.tags && entry.tags.length > 0) {
            lines.push(`\nTags: ${entry.tags.map((t) => `${t.tag_type}:${t.tag_value}`).join(", ")}`);
        }
        if (entry.readme) {
            lines.push("\n---\n## README\n");
            lines.push(entry.readme);
        }
        if (entry.agents_md) {
            lines.push("\n---\n## agents.md (AI Setup Instructions)\n");
            lines.push(entry.agents_md);
        }
        if (entry.manifest) {
            lines.push("\n---\n## Manifest\n");
            lines.push("```json");
            lines.push(JSON.stringify(entry.manifest, null, 2));
            lines.push("```");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── build_solution ─────────────────────────────────────────────────
    server.tool("build_solution", "Compose a new AI/automation solution from the knowledge base. Describe what you want to build, and the system will find relevant setups and generate a composite README and agents.md.", {
        brief: zod_1.z.string().describe("Description of what you want to build, e.g. 'An AI agent that monitors GitHub issues and auto-triages them'"),
        preferred_tools: zod_1.z.array(zod_1.z.string()).optional().describe("Tools you want to use, e.g. ['claude', 'n8n']"),
        excluded_tools: zod_1.z.array(zod_1.z.string()).optional().describe("Tools to avoid"),
        max_complexity: zod_1.z.string().optional().describe("Maximum complexity: simple, moderate, complex, or advanced"),
    }, async (params) => {
        const result = await client.buildSolution(params);
        const lines = [];
        lines.push("## Composite Solution\n");
        lines.push(`Confidence: ${Math.round(result.confidence.score * 100)}%`);
        if (result.confidence.gaps.length > 0) {
            lines.push(`\nGaps: ${result.confidence.gaps.join(", ")}`);
        }
        lines.push("\n### Source Setups Used:");
        for (const src of result.source_entries) {
            lines.push(`- **${src.title}** (${src.entry_id}): ${src.how_used}`);
        }
        lines.push("\n---\n### README\n");
        lines.push(result.composite_readme);
        lines.push("\n---\n### agents.md\n");
        lines.push(result.composite_agents_md);
        if (result.confidence.suggestions.length > 0) {
            lines.push("\n---\n### Suggestions for Improvement");
            for (const s of result.confidence.suggestions) {
                lines.push(`- ${s}`);
            }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── list_setups ────────────────────────────────────────────────────
    server.tool("list_setups", "Browse all available setups in the knowledge base with optional filters.", {
        use_case: zod_1.z.string().optional().describe("Filter by use case category"),
        complexity: zod_1.z.string().optional().describe("Filter by complexity: simple, moderate, complex, advanced"),
        limit: zod_1.z.number().optional().describe("Number of results (default 20)"),
        offset: zod_1.z.number().optional().describe("Pagination offset"),
    }, async (params) => {
        const result = await client.listSetups({
            ...params,
            limit: params.limit ?? 20,
        });
        const lines = [];
        lines.push(`## Setups (${result.total} total, showing ${result.entries.length})\n`);
        for (const entry of result.entries) {
            lines.push(`- **${entry.title || "Untitled"}** [${entry.complexity || "?"}] — ${entry.summary || "No summary"}`);
            lines.push(`  ID: ${entry.id} | Source: ${entry.source_url}`);
        }
        if (result.total > result.offset + result.entries.length) {
            lines.push(`\n_Use offset=${result.offset + result.entries.length} to see more._`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── list_clusters ──────────────────────────────────────────────────
    server.tool("list_clusters", "List all clusters (curated groupings of setups) available in the knowledge base.", {}, async () => {
        const { clusters } = await client.listClusters();
        const lines = clusters.map((c) => `- **${c.name}** (slug: \`${c.slug}\`) — ${c.panel_count ?? 0} entries`);
        return {
            content: [
                {
                    type: "text",
                    text: lines.join("\n") || "No clusters found.",
                },
            ],
        };
    });
    // ── get_cluster ────────────────────────────────────────────────────
    server.tool("get_cluster", "Get details of a specific cluster including its member entries with summaries and READMEs.", {
        slug: zod_1.z.string().describe("Cluster slug from list_clusters"),
    }, async ({ slug }) => {
        const cluster = await client.getCluster(slug);
        const lines = [];
        lines.push(`# Cluster: ${cluster.name}`);
        lines.push(`Slug: \`${cluster.slug}\``);
        lines.push(`Entries: ${cluster.entries.length}\n`);
        for (const e of cluster.entries) {
            lines.push(`### ${e.title || "Untitled"} (${e.entry_id})`);
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
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── query_cluster ──────────────────────────────────────────────────
    server.tool("query_cluster", "Semantic search scoped to a specific cluster's entries only.", {
        cluster_slug: zod_1.z.string().describe("Cluster slug"),
        query: zod_1.z.string().describe("Natural language search query"),
        max_results: zod_1.z
            .number()
            .optional()
            .describe("Max results (default 5)"),
    }, async ({ cluster_slug, query, max_results }) => {
        const result = await client.queryCluster(cluster_slug, query, max_results);
        const lines = [];
        lines.push(`## Cluster Search: "${query}" in ${result.cluster_slug} (${result.results.length} results)\n`);
        for (const r of result.results) {
            lines.push(`### ${r.title || "Untitled"} (${Math.round(r.similarity * 100)}% match)`);
            lines.push(`ID: ${r.entry_id}`);
            if (r.summary)
                lines.push(r.summary);
            lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── sync_skills ─────────────────────────────────────────────────────
    server.tool("sync_skills", "Write Claude Code skill files for all SIE clusters to ~/.claude/skills/. Creates per-cluster SKILL.md files with synthesized instructions, a global canvas skill for routing, and updates ~/.claude/CLAUDE.md with a cluster index. Run this once to seed skills, then they evolve as living documents.", {
        force: zod_1.z.boolean().optional().describe("Overwrite existing skill files (default: false, skips existing)"),
    }, async ({ force }) => {
        const { clusters } = await client.listClusters();
        const results = [];
        const clusterSummaries = [];
        for (const cluster of clusters) {
            try {
                // Check if skill already exists
                if (!force && await (0, skill_writer_js_1.skillExists)(cluster.slug)) {
                    results.push(`- **${cluster.name}** — skipped (already exists)`);
                    // Still collect summary for global files
                    const detail = await client.getCluster(cluster.slug);
                    clusterSummaries.push(buildClusterSummary(cluster.slug, cluster.name, detail.entries));
                    continue;
                }
                const detail = await client.getCluster(cluster.slug);
                // Get or synthesize brain
                let brain = { instructions: "", memories: [] };
                try {
                    brain = await client.getClusterBrain(cluster.slug);
                }
                catch {
                    // Brain doesn't exist — synthesize it
                    const entriesToSynthesize = detail.entries
                        .filter((e) => e.agents_md)
                        .map((e) => ({
                        title: e.title || "Untitled",
                        agents_md: e.agents_md || "",
                        readme: e.readme || "",
                    }));
                    if (entriesToSynthesize.length > 0) {
                        const synthesis = await client.synthesizeBrain(entriesToSynthesize);
                        brain.instructions = synthesis.instructions;
                        await client.updateClusterBrain(cluster.slug, brain.instructions);
                    }
                }
                await (0, skill_writer_js_1.writeClusterSkill)(cluster.slug, cluster.name, brain, detail.entries);
                results.push(`- **${cluster.name}** — wrote skill with ${detail.entries.length} entries`);
                clusterSummaries.push(buildClusterSummary(cluster.slug, cluster.name, detail.entries));
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                results.push(`- **${cluster.name}** — ERROR: ${msg}`);
            }
        }
        // Write global files (always overwrite these)
        try {
            await (0, skill_writer_js_1.writeGlobalCanvasSkill)(clusterSummaries);
            results.push(`\nGlobal canvas skill: wrote ~/.claude/skills/sie-canvas/SKILL.md`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push(`\nGlobal canvas skill: ERROR — ${msg}`);
        }
        try {
            await (0, skill_writer_js_1.writeGlobalClaudemd)(clusterSummaries);
            results.push(`Global CLAUDE.md: updated ~/.claude/CLAUDE.md`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push(`Global CLAUDE.md: ERROR — ${msg}`);
        }
        return {
            content: [{
                    type: "text",
                    text: `## Skills Synced\n\n${results.join("\n")}`,
                }],
        };
    });
    // ── save_cluster_memory ───────────────────────────────────────────
    server.tool("save_cluster_memory", "Save a user preference or correction as a persistent memory for a cluster. Memories override the cluster's base instructions in future sessions. Use this when the user tells you to change how something works, skip a step, or prefer a specific tool.", {
        slug: zod_1.z.string().describe("Cluster slug"),
        memory: zod_1.z.string().describe("The preference or correction to remember, e.g. 'User prefers Resend over SendGrid for email' or 'Skip the Slack notification step'"),
    }, async ({ slug, memory }) => {
        const result = await client.saveClusterMemory(slug, memory);
        // Also append to on-disk SKILL.md (non-fatal)
        let diskNote = "";
        try {
            await (0, skill_writer_js_1.appendMemoryToSkill)(slug, memory);
            diskNote = `\n(Also updated ~/.claude/skills/sie-${slug}/SKILL.md)`;
        }
        catch (err) {
            console.error(`[SIE] Failed to update skill file for ${slug}:`, err);
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Saved memory for cluster "${slug}": "${result.content}"${diskNote}`,
                },
            ],
        };
    });
    // ── ingest_url ──────────────────────────────────────────────────────
    server.tool("ingest_url", "Ingest a URL into the knowledge base. Extracts content, generates README, agents.md, and manifest. Returns the entry ID for tracking. The entry processes in the background (30-120s). Use get_setup to poll — check the status field: 'processing' means still working, 'complete' means done, 'error' means failed.", {
        url: zod_1.z.string().describe("URL to ingest (blog post, GitHub repo, tweet, etc.)"),
        text: zod_1.z.string().optional().describe("Optional additional text content to include"),
        links: zod_1.z.array(zod_1.z.string()).optional().describe("Optional additional URLs to follow and include"),
    }, async ({ url, text, links }) => {
        const content = {};
        if (text)
            content.text = text;
        if (links)
            content.links = links;
        const result = await client.ingestUrl(url, Object.keys(content).length > 0 ? content : undefined);
        if (result.status === "already_exists") {
            return {
                content: [{
                        type: "text",
                        text: `Entry already exists: **${result.title || "Untitled"}** (${result.entry_id})\nUse \`get_setup("${result.entry_id}")\` to view it.`,
                    }],
            };
        }
        return {
            content: [{
                    type: "text",
                    text: `Ingestion started for ${url}\nEntry ID: ${result.entry_id}\nStatus: ${result.status}\n\nThe entry is processing in the background. Use \`get_setup("${result.entry_id}")\` to check when it's complete.`,
                }],
        };
    });
    // ── update_cluster ─────────────────────────────────────────────────
    server.tool("update_cluster", "Rename a cluster or modify its entry membership. Provide name, entry_ids, or both.", {
        slug: zod_1.z.string().describe("Cluster slug from list_clusters"),
        name: zod_1.z.string().optional().describe("New cluster name"),
        entry_ids: zod_1.z.array(zod_1.z.string()).optional().describe("New set of entry IDs (replaces existing membership)"),
    }, async ({ slug, name, entry_ids }) => {
        const updates = {};
        if (name)
            updates.name = name;
        if (entry_ids)
            updates.entry_ids = entry_ids;
        const result = await client.updateCluster(slug, updates);
        // If the slug changed (due to rename), clean up old skill dir
        if (result.slug !== slug) {
            try {
                await (0, skill_writer_js_1.removeClusterSkill)(slug);
            }
            catch (err) {
                console.error(`[SIE] Failed to remove old skill dir for ${slug}:`, err);
            }
        }
        return {
            content: [{
                    type: "text",
                    text: `Updated cluster **${result.name}** (slug: \`${result.slug}\`) — ${result.panel_count ?? 0} entries.`,
                }],
        };
    });
    // ── delete_cluster ─────────────────────────────────────────────────
    server.tool("delete_cluster", "Delete a cluster. This removes the cluster grouping but does NOT delete the individual entries.", {
        slug: zod_1.z.string().describe("Cluster slug from list_clusters"),
    }, async ({ slug }) => {
        await client.deleteCluster(slug);
        return {
            content: [{
                    type: "text",
                    text: `Deleted cluster \`${slug}\`. Entries remain in the knowledge base.`,
                }],
        };
    });
    // ── get_cluster_brain ──────────────────────────────────────────────
    server.tool("get_cluster_brain", "Get the current brain state for a cluster — its synthesized instructions and user memories.", {
        slug: zod_1.z.string().describe("Cluster slug from list_clusters"),
    }, async ({ slug }) => {
        const brain = await client.getClusterBrain(slug);
        const sections = [];
        sections.push(`# Cluster Brain: ${slug}`);
        sections.push("");
        if (brain.instructions) {
            sections.push("## Instructions");
            sections.push("");
            sections.push(brain.instructions);
            sections.push("");
        }
        else {
            sections.push("_No instructions synthesized yet._");
            sections.push("");
        }
        if (brain.memories.length > 0) {
            sections.push("## Memories");
            sections.push("");
            for (let i = 0; i < brain.memories.length; i++) {
                sections.push(`${i + 1}. ${brain.memories[i].content} (id: \`${brain.memories[i].id}\`)`);
            }
        }
        else {
            sections.push("_No memories saved yet._");
        }
        return { content: [{ type: "text", text: sections.join("\n") }] };
    });
    // ── delete_cluster_memory ──────────────────────────────────────────
    server.tool("delete_cluster_memory", "Remove a specific memory from a cluster's brain. Use get_cluster_brain first to see memory IDs.", {
        slug: zod_1.z.string().describe("Cluster slug"),
        memory_id: zod_1.z.string().describe("Memory ID to delete"),
    }, async ({ slug, memory_id }) => {
        await client.deleteClusterMemory(slug, memory_id);
        return {
            content: [{
                    type: "text",
                    text: `Deleted memory ${memory_id} from cluster "${slug}".`,
                }],
        };
    });
    // ── update_entry ───────────────────────────────────────────────────
    server.tool("update_entry", "Update metadata for a knowledge base entry (title, summary, use_case, complexity).", {
        id: zod_1.z.string().describe("Entry ID (UUID)"),
        title: zod_1.z.string().optional().describe("New title"),
        summary: zod_1.z.string().optional().describe("New summary"),
        use_case: zod_1.z.string().optional().describe("New use case category"),
        complexity: zod_1.z.enum(["simple", "moderate", "complex", "advanced"]).optional().describe("New complexity level"),
    }, async ({ id, title, summary, use_case, complexity }) => {
        const updates = {};
        if (title)
            updates.title = title;
        if (summary)
            updates.summary = summary;
        if (use_case)
            updates.use_case = use_case;
        if (complexity)
            updates.complexity = complexity;
        const entry = await client.updateEntry(id, updates);
        return {
            content: [{
                    type: "text",
                    text: `Updated entry **${entry.title || "Untitled"}** (${id}).`,
                }],
        };
    });
    // ── delete_entry ───────────────────────────────────────────────────
    server.tool("delete_entry", "Delete an entry from the knowledge base. This is permanent and cannot be undone.", {
        id: zod_1.z.string().describe("Entry ID (UUID) to delete"),
    }, async ({ id }) => {
        await client.deleteEntry(id);
        return {
            content: [{
                    type: "text",
                    text: `Deleted entry ${id} from the knowledge base.`,
                }],
        };
    });
    // ── check_entry_updates ─────────────────────────────────────────────
    server.tool("check_entry_updates", "Check if a GitHub-sourced entry has been updated since ingestion. Returns update status for GitHub repos; non-GitHub entries are skipped.", {
        entry_id: zod_1.z.string().describe("Entry ID (UUID) to check"),
    }, async ({ entry_id }) => {
        const result = await client.checkEntryUpdates(entry_id);
        if (result.has_updates === null) {
            return {
                content: [{
                        type: "text",
                        text: `**${result.title || "Untitled"}**: ${result.reason || "Update checking not available."}`,
                    }],
            };
        }
        if (result.has_updates) {
            return {
                content: [{
                        type: "text",
                        text: `**${result.title || "Untitled"}** (${result.repo}): Updates available.\nRepo last pushed ${result.days_since_push} day(s) ago. You ingested it ${result.days_since_ingestion} day(s) ago.\nConsider re-ingesting with \`ingest_url\`.`,
                    }],
            };
        }
        return {
            content: [{
                    type: "text",
                    text: `**${result.title || "Untitled"}** (${result.repo}): No updates since ingestion (${result.days_since_ingestion} day(s) ago).`,
                }],
        };
    });
    // ── check_cluster_updates ──────────────────────────────────────────
    server.tool("check_cluster_updates", "Check all entries in a cluster for GitHub repo updates. Returns a summary of which entries have updates available.", {
        slug: zod_1.z.string().describe("Cluster slug from list_clusters"),
    }, async ({ slug }) => {
        const detail = await client.getCluster(slug);
        const updated = [];
        const current = [];
        const skipped = [];
        for (const entry of detail.entries) {
            try {
                const result = await client.checkEntryUpdates(entry.entry_id);
                if (result.has_updates === true) {
                    updated.push(`- **${result.title || "Untitled"}** (${result.repo}) — updated ${result.days_since_push}d ago, ingested ${result.days_since_ingestion}d ago`);
                }
                else if (result.has_updates === false) {
                    current.push(`- ${result.title || "Untitled"}`);
                }
                else {
                    skipped.push(`- ${result.title || "Untitled"} — ${result.reason || "not GitHub"}`);
                }
            }
            catch {
                skipped.push(`- ${entry.title || "Untitled"} — check failed`);
            }
        }
        const lines = [];
        lines.push(`## Cluster: ${detail.name} — Update Check\n`);
        if (updated.length > 0) {
            lines.push(`### Updates available (${updated.length})\n`);
            lines.push(...updated);
            lines.push("");
        }
        if (current.length > 0) {
            lines.push(`### Up to date (${current.length})\n`);
            lines.push(...current);
            lines.push("");
        }
        if (skipped.length > 0) {
            lines.push(`### Skipped (${skipped.length})\n`);
            lines.push(...skipped);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── add_entry_to_cluster ───────────────────────────────────────────
    server.tool("add_entry_to_cluster", "Add an entry to an existing cluster and incrementally update the cluster's brain. More useful than raw update_cluster because it handles brain merging automatically.", {
        slug: zod_1.z.string().describe("Cluster slug"),
        entry_id: zod_1.z.string().describe("Entry ID to add to the cluster"),
    }, async ({ slug, entry_id }) => {
        // Get current cluster to build updated entry list
        const detail = await client.getCluster(slug);
        const existingIds = detail.entries.map((e) => e.entry_id);
        if (existingIds.includes(entry_id)) {
            return {
                content: [{
                        type: "text",
                        text: `Entry ${entry_id} is already in cluster "${slug}".`,
                    }],
            };
        }
        // Validate entry exists
        const newEntry = await client.getSetup(entry_id);
        // Add entry to cluster membership
        const updatedIds = [...existingIds, entry_id];
        await client.updateCluster(slug, { entry_ids: updatedIds });
        // Incrementally update brain if possible
        let brainNote = "";
        try {
            const brain = await client.getClusterBrain(slug);
            if (brain.instructions && newEntry.agents_md) {
                // Incremental synthesis — merge new entry into existing brain
                const synthesis = await client.synthesizeIncremental(brain.instructions, {
                    title: newEntry.title || "Untitled",
                    agents_md: newEntry.agents_md,
                    readme: newEntry.readme || "",
                });
                await client.updateClusterBrain(slug, synthesis.instructions);
                brainNote = "\nBrain updated incrementally with new entry.";
            }
            else if (!brain.instructions && newEntry.agents_md) {
                // No brain yet — do full synthesis
                const allEntries = [...detail.entries, {
                        entry_id,
                        title: newEntry.title,
                        summary: newEntry.summary,
                        readme: newEntry.readme,
                        agents_md: newEntry.agents_md,
                    }].filter((e) => e.agents_md).map((e) => ({
                    title: e.title || "Untitled",
                    agents_md: e.agents_md || "",
                    readme: e.readme || "",
                }));
                if (allEntries.length > 0) {
                    const synthesis = await client.synthesizeBrain(allEntries);
                    await client.updateClusterBrain(slug, synthesis.instructions);
                    brainNote = "\nBrain synthesized from all entries.";
                }
            }
            else {
                brainNote = "\nNew entry has no agents.md — brain unchanged.";
            }
            // Update skill file
            const updatedDetail = await client.getCluster(slug);
            const updatedBrain = await client.getClusterBrain(slug);
            await (0, skill_writer_js_1.writeClusterSkill)(slug, detail.name, updatedBrain, updatedDetail.entries);
            brainNote += " Skill file updated.";
        }
        catch (err) {
            console.error(`[SIE] Brain update failed for ${slug}:`, err);
            brainNote = "\n(Brain update failed — run `sync_skills` to fix)";
        }
        return {
            content: [{
                    type: "text",
                    text: `Added **${newEntry.title || "Untitled"}** to cluster "${slug}" (now ${updatedIds.length} entries).${brainNote}`,
                }],
        };
    });
    // ── canvas_list_panels ──────────────────────────────────────────────
    server.tool("canvas_list_panels", "List all knowledge base entries currently on your canvas workspace.", {}, async () => {
        const panels = await client.listCanvasPanels();
        if (panels.length === 0) {
            return {
                content: [{ type: "text", text: "Your canvas is empty. Use `canvas_add_entry` to add entries, or `search_setups` to find them first." }],
            };
        }
        const lines = [];
        lines.push(`## Your Canvas (${panels.length} entries)\n`);
        for (const p of panels) {
            lines.push(`- **${p.title || "Untitled"}** (entry: ${p.entry_id})`);
            if (p.summary)
                lines.push(`  ${p.summary}`);
            if (p.source_url)
                lines.push(`  Source: ${p.source_url}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── canvas_add_entry ──────────────────────────────────────────────
    server.tool("canvas_add_entry", "Add a knowledge base entry to your canvas. Use search_setups to find entries first.", {
        entry_id: zod_1.z.string().describe("Entry ID (UUID) from search results or get_setup"),
    }, async ({ entry_id }) => {
        const { panel, created } = await client.addCanvasPanel(entry_id);
        const verb = created ? "Added" : "Already on";
        return {
            content: [
                {
                    type: "text",
                    text: `${verb} canvas: **${panel.title || "Untitled"}** (${panel.entry_id})`,
                },
            ],
        };
    });
    // ── canvas_remove_entry ───────────────────────────────────────────
    server.tool("canvas_remove_entry", "Remove an entry from your canvas. Does not delete it from the knowledge base.", {
        entry_id: zod_1.z.string().describe("Entry ID to remove from canvas"),
    }, async ({ entry_id }) => {
        await client.removeCanvasPanel(entry_id);
        return {
            content: [
                {
                    type: "text",
                    text: `Removed entry ${entry_id} from your canvas.`,
                },
            ],
        };
    });
    // ── canvas_search_and_add ──────────────────────────────────────────
    server.tool("canvas_search_and_add", "Search the knowledge base and add the top results to your canvas in one step. Useful for quickly building a canvas around a topic.", {
        query: zod_1.z.string().describe("Natural language search query, e.g. 'marketing automations' or 'n8n workflows'"),
        max_results: zod_1.z.number().optional().describe("Number of results to add (default 5, max 10)"),
    }, async ({ query, max_results }) => {
        const limit = Math.min(max_results ?? 5, 10);
        const searchResult = await client.searchSetups({
            query,
            max_results: limit,
            include_synthesis: false,
        });
        if (searchResult.entries.length === 0) {
            return {
                content: [{
                        type: "text",
                        text: `No results found for "${query}".`,
                    }],
            };
        }
        const added = [];
        const skipped = [];
        for (const entry of searchResult.entries) {
            try {
                const { created } = await client.addCanvasPanel(entry.entry_id);
                if (created) {
                    added.push(`- **${entry.title || "Untitled"}** (${Math.round(entry.similarity * 100)}% match)`);
                }
                else {
                    skipped.push(`- ${entry.title || "Untitled"} (already on canvas)`);
                }
            }
            catch {
                skipped.push(`- ${entry.title || "Untitled"} (failed to add)`);
            }
        }
        const lines = [];
        if (added.length > 0) {
            lines.push(`## Added to canvas (${added.length})\n`);
            lines.push(...added);
        }
        if (skipped.length > 0) {
            lines.push(`\n## Skipped (${skipped.length})\n`);
            lines.push(...skipped);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── canvas_create_cluster ─────────────────────────────────────────
    server.tool("canvas_create_cluster", "Group canvas entries into a named cluster for organized access via query_cluster. Brain synthesis and skill file generation happen in the background — run sync_skills to check status.", {
        name: zod_1.z.string().min(1, "Cluster name cannot be empty").describe("Cluster name, e.g. 'AI Agent Stack'"),
        entry_ids: zod_1.z.array(zod_1.z.string()).min(1, "Must provide at least one entry ID").describe("Entry IDs to include (must be on your canvas)"),
    }, async ({ name, entry_ids }) => {
        // Validate entry IDs exist before creating cluster
        const validationErrors = [];
        for (const id of entry_ids) {
            try {
                await client.getSetup(id);
            }
            catch {
                validationErrors.push(id);
            }
        }
        if (validationErrors.length > 0) {
            return {
                content: [{
                        type: "text",
                        text: `Entry IDs not found: ${validationErrors.join(", ")}. Use \`search_setups\` to find valid entry IDs.`,
                    }],
            };
        }
        const result = await client.createCluster(name, entry_ids);
        // Fire-and-forget: brain synthesis + skill file generation
        // This can take 30-120s so we don't block the tool response
        (async () => {
            try {
                const detail = await client.getCluster(result.slug);
                const entriesToSynthesize = detail.entries
                    .filter((e) => e.agents_md)
                    .map((e) => ({
                    title: e.title || "Untitled",
                    agents_md: e.agents_md || "",
                    readme: e.readme || "",
                }));
                let brain = { instructions: "", memories: [] };
                if (entriesToSynthesize.length > 0) {
                    const synthesis = await client.synthesizeBrain(entriesToSynthesize);
                    brain.instructions = synthesis.instructions;
                    await client.updateClusterBrain(result.slug, brain.instructions);
                }
                await (0, skill_writer_js_1.writeClusterSkill)(result.slug, result.name, brain, detail.entries);
                const { clusters } = await client.listClusters();
                const summaries = [];
                for (const c of clusters) {
                    try {
                        const d = await client.getCluster(c.slug);
                        summaries.push(buildClusterSummary(c.slug, c.name, d.entries));
                    }
                    catch {
                        summaries.push({ slug: c.slug, name: c.name, oneLiner: "", tools: [] });
                    }
                }
                await (0, skill_writer_js_1.writeGlobalCanvasSkill)(summaries);
                await (0, skill_writer_js_1.writeGlobalClaudemd)(summaries);
            }
            catch (err) {
                console.error(`[SIE] Auto-sync failed for ${result.slug}:`, err);
            }
        })();
        return {
            content: [
                {
                    type: "text",
                    text: `Created cluster **${result.name}** (slug: \`${result.slug}\`) with ${result.panel_count ?? entry_ids.length} entries.\nBrain synthesis running in background (~30s). Use \`get_cluster_brain("${result.slug}")\` to check when ready.`,
                },
            ],
        };
    });
    return server;
}
/**
 * Build a ClusterSummary from entry data for use in global skill/CLAUDE.md files.
 */
function buildClusterSummary(slug, name, entries) {
    const tools = [];
    const summaryParts = [];
    for (const entry of entries) {
        if (entry.title) {
            // Extract tool-like words from titles
            for (const word of entry.title.split(/[\s:—–\-|/,]+/)) {
                const clean = word.trim();
                if (clean.length > 2 && /^[A-Z]/.test(clean)) {
                    tools.push(clean);
                }
            }
        }
        if (entry.summary) {
            summaryParts.push(entry.summary.split(/[.!?]/)[0] || "");
        }
    }
    const oneLiner = summaryParts.slice(0, 2).join("; ").slice(0, 120) ||
        `${entries.length} entries`;
    return {
        slug,
        name,
        oneLiner,
        tools: [...new Set(tools)].slice(0, 10),
    };
}
