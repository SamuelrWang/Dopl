"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyTitle = slugifyTitle;
exports.renderClusterSkillMd = renderClusterSkillMd;
exports.renderEntryReferenceMd = renderEntryReferenceMd;
exports.renderGlobalCanvasSkillMd = renderGlobalCanvasSkillMd;
exports.renderGlobalClaudeMdSection = renderGlobalClaudeMdSection;
/**
 * Slugify an entry title for use as a reference filename.
 */
function slugifyTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || "untitled";
}
/**
 * Extract tool/keyword names from entries for skill description trigger phrases.
 */
function extractKeywords(entries) {
    const keywords = new Set();
    for (const entry of entries) {
        // Extract from title
        if (entry.title) {
            // Split on common separators, keep meaningful words
            for (const word of entry.title.split(/[\s:—–\-|/,]+/)) {
                const clean = word.trim().toLowerCase();
                if (clean.length > 2 && !STOP_WORDS.has(clean)) {
                    keywords.add(word.trim());
                }
            }
        }
        // Extract from summary (first sentence only)
        if (entry.summary) {
            const firstSentence = entry.summary.split(/[.!?]/)[0] || "";
            for (const word of firstSentence.split(/[\s,]+/)) {
                const clean = word.trim().toLowerCase();
                if (clean.length > 3 && !STOP_WORDS.has(clean) && /^[A-Z]/.test(word.trim())) {
                    keywords.add(word.trim());
                }
            }
        }
    }
    return [...keywords].slice(0, 15);
}
const STOP_WORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "have",
    "will", "been", "were", "are", "was", "has", "had", "not", "but",
    "what", "when", "how", "who", "which", "their", "them", "then",
    "than", "into", "over", "also", "just", "about", "using", "used",
    "setup", "guide", "tutorial", "build", "create", "make",
]);
/**
 * Render a per-cluster SKILL.md file.
 */
function renderClusterSkillMd(params) {
    const { slug, name, brain, entries } = params;
    const keywords = extractKeywords(entries);
    const toolList = keywords.slice(0, 8).join(", ");
    const summaries = entries
        .filter((e) => e.summary)
        .map((e) => e.summary.split(/[.!?]/)[0])
        .slice(0, 3)
        .join("; ");
    const description = `Use when working with ${name}. ` +
        (toolList ? `Covers: ${toolList}. ` : "") +
        (summaries ? `Trigger: "${summaries}".` : "");
    const sections = [];
    // Frontmatter
    sections.push(`---`);
    sections.push(`name: sie-${slug}`);
    sections.push(`description: >-`);
    sections.push(`  ${description}`);
    sections.push(`version: 0.1.0`);
    sections.push(`---`);
    sections.push("");
    // Title
    sections.push(`# ${name}`);
    sections.push("");
    // Overview
    const overview = entries
        .filter((e) => e.summary)
        .map((e) => `${e.title || "Untitled"}: ${e.summary}`)
        .slice(0, 5)
        .join("\n- ");
    sections.push(`## Overview`);
    sections.push("");
    if (overview) {
        sections.push(`This cluster covers:`);
        sections.push(`- ${overview}`);
    }
    else {
        sections.push(`A curated collection of ${entries.length} AI/automation implementations.`);
    }
    sections.push("");
    // Instructions
    sections.push(`## Instructions`);
    sections.push("");
    if (brain.instructions) {
        // Truncate if over ~4000 words to stay under 5000 word budget
        const words = brain.instructions.split(/\s+/);
        if (words.length > 4000) {
            sections.push(words.slice(0, 4000).join(" "));
            sections.push("");
            sections.push(`> **Note**: Instructions truncated. See \`references/\` for complete details on individual entries.`);
        }
        else {
            sections.push(brain.instructions);
        }
    }
    else {
        sections.push(`No synthesized instructions yet. Run \`sync_skills\` after adding entries to generate them.`);
    }
    sections.push("");
    // User Memories
    sections.push(`## User Memories`);
    sections.push("");
    if (brain.memories.length > 0) {
        for (let i = 0; i < brain.memories.length; i++) {
            sections.push(`${i + 1}. ${brain.memories[i].content}`);
        }
    }
    else {
        sections.push(`_No memories yet. Add corrections and preferences here as you work._`);
    }
    sections.push("");
    // References
    sections.push(`## References`);
    sections.push("");
    sections.push(`Individual entry details are in the \`references/\` directory:`);
    sections.push("");
    for (const entry of entries) {
        const entrySlug = slugifyTitle(entry.title || "untitled");
        const shortSummary = entry.summary
            ? entry.summary.slice(0, 80).replace(/\n/g, " ")
            : "No summary";
        sections.push(`- \`references/${entrySlug}.md\` — ${entry.title || "Untitled"}: ${shortSummary}`);
    }
    sections.push("");
    // Self-Maintenance
    sections.push(`## Self-Maintenance`);
    sections.push("");
    sections.push(`This file is a living document. The database is the canonical source of truth,`);
    sections.push(`but this file can be edited locally for quick corrections.`);
    sections.push("");
    sections.push(`**To persist a memory or preference permanently:**`);
    sections.push(`Call the MCP tool \`save_cluster_memory\` with slug \`${slug}\`. This writes to both the database and this file.`);
    sections.push("");
    sections.push(`**To make local-only edits (will be lost if \`sync_skills --force\` runs):**`);
    sections.push(`Edit any section directly. Useful for quick corrections or notes while working.`);
    sections.push("");
    sections.push(`**To fully regenerate this file from the database:**`);
    sections.push(`Run \`sync_skills\` with \`force: true\`.`);
    sections.push("");
    return sections.join("\n");
}
/**
 * Render a reference file for a single entry.
 */
function renderEntryReferenceMd(entry) {
    const sections = [];
    sections.push(`# ${entry.title || "Untitled"}`);
    sections.push("");
    sections.push(`**Entry ID**: ${entry.entry_id}`);
    if (entry.summary) {
        sections.push("");
        sections.push(entry.summary);
    }
    sections.push("");
    if (entry.agents_md) {
        sections.push(`## Setup Instructions (agents.md)`);
        sections.push("");
        sections.push(entry.agents_md);
        sections.push("");
    }
    if (entry.readme) {
        sections.push(`## README`);
        sections.push("");
        // Truncate very long READMEs
        if (entry.readme.length > 5000) {
            sections.push(entry.readme.slice(0, 5000));
            sections.push("");
            sections.push(`> _README truncated at 5000 chars. Retrieve full content via \`get_setup("${entry.entry_id}")\`._`);
        }
        else {
            sections.push(entry.readme);
        }
        sections.push("");
    }
    return sections.join("\n");
}
/**
 * Render the global canvas SKILL.md for cross-cluster routing.
 */
function renderGlobalCanvasSkillMd(clusters) {
    const sections = [];
    const allTools = clusters.flatMap((c) => c.tools).slice(0, 20).join(", ");
    sections.push(`---`);
    sections.push(`name: sie-canvas`);
    sections.push(`description: >-`);
    sections.push(`  Use when the user asks about their AI/automation setup collection,`);
    sections.push(`  wants to compare approaches across clusters, or needs routing guidance`);
    sections.push(`  for which cluster to use. Tools across clusters: ${allTools || "various"}.`);
    sections.push(`version: 0.1.0`);
    sections.push(`---`);
    sections.push("");
    sections.push(`# SIE Canvas — Cross-Cluster Routing & Orchestration`);
    sections.push("");
    sections.push(`## Available Clusters`);
    sections.push("");
    if (clusters.length === 0) {
        sections.push(`_No clusters yet. Create clusters in the SIE canvas to populate this section._`);
    }
    else {
        for (const cluster of clusters) {
            sections.push(`### ${cluster.name} (\`sie-${cluster.slug}\`)`);
            sections.push("");
            if (cluster.tools.length > 0) {
                sections.push(`**Tools**: ${cluster.tools.join(", ")}`);
            }
            sections.push(`**Use when**: ${cluster.oneLiner}`);
            sections.push("");
        }
    }
    sections.push(`## Routing Guide`);
    sections.push("");
    sections.push(`When the user's request involves:`);
    sections.push("");
    for (const cluster of clusters) {
        if (cluster.tools.length > 0) {
            sections.push(`- **${cluster.tools.slice(0, 5).join(", ")}** → Use \`sie-${cluster.slug}\` skill`);
        }
        else {
            sections.push(`- **${cluster.name}** → Use \`sie-${cluster.slug}\` skill`);
        }
    }
    sections.push("");
    sections.push(`## Cross-Cluster Patterns`);
    sections.push("");
    sections.push(`_Edit this section as you discover cross-cluster workflows, shared tools, or integration points._`);
    sections.push("");
    sections.push(`## Self-Maintenance`);
    sections.push("");
    sections.push(`Update this file when:`);
    sections.push(`- A new cluster is created (add it to Available Clusters and Routing Guide)`);
    sections.push(`- You discover cross-cluster dependencies or shared patterns`);
    sections.push(`- The user establishes preferences about which cluster to use for what`);
    sections.push("");
    return sections.join("\n");
}
/**
 * Render the SIE section for ~/.claude/CLAUDE.md.
 */
function renderGlobalClaudeMdSection(clusters) {
    const lines = [];
    lines.push(`## Setup Intelligence Engine — Cluster Index`);
    lines.push("");
    lines.push(`You have SIE skills installed for the following clusters. Each has a dedicated`);
    lines.push(`skill at \`~/.claude/skills/sie-{slug}/SKILL.md\` that loads automatically when relevant.`);
    lines.push("");
    if (clusters.length === 0) {
        lines.push(`_No clusters yet._`);
    }
    else {
        lines.push(`| Cluster | Skill | Covers |`);
        lines.push(`|---------|-------|--------|`);
        for (const cluster of clusters) {
            lines.push(`| ${cluster.name} | sie-${cluster.slug} | ${cluster.oneLiner} |`);
        }
    }
    lines.push("");
    lines.push(`For cross-cluster workflows or routing questions, the \`sie-canvas\` skill has detailed guidance.`);
    return lines.join("\n");
}
