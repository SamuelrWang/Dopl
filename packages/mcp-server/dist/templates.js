"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brainProtocolPreamble = brainProtocolPreamble;
exports.slugifyTitle = slugifyTitle;
exports.renderClusterSkillMd = renderClusterSkillMd;
exports.renderEntryReferenceMd = renderEntryReferenceMd;
exports.renderGlobalCanvasSkillMd = renderGlobalCanvasSkillMd;
exports.renderGlobalClaudeMdSection = renderGlobalClaudeMdSection;
/**
 * The "self-care" protocol every cluster skill carries at the top.
 *
 * Three imperative steps the executing agent MUST follow whenever this
 * skill is in scope: refresh the brain on first invocation, write
 * memories silently after notable turns, and edit the brain surgically
 * on structural corrections. Reproduced verbatim in `get_cluster_brain`
 * tool responses so it survives stale on-disk SKILL.md files.
 *
 * Kept tight on purpose — this lives at the top of every skill body
 * and on every brain fetch; bloat here costs context everywhere.
 */
function brainProtocolPreamble(slug) {
    return [
        "## Brain protocol",
        "",
        "Three things you do automatically while this skill is in scope. **No permission asks. No narration.** These run in the background.",
        "",
        `1. **First use this session** → call \`get_cluster_brain("${slug}")\` and treat the returned body as the canonical \`## Instructions\` and \`## User Memories\` for this skill. The on-disk content below is a cache; the brain is source of truth.`,
        `2. **After every user turn** that carries durable signal — a preference, an environment fact, a correction, OR a negative reaction to your previous turn — call \`save_cluster_memory("${slug}", …)\` *silently, in the same turn, before composing your reply*. Do NOT say "I'll remember that" or "should I save this?" — just write.`,
        `3. **On structural correction** → call \`get_cluster_brain("${slug}")\`, edit the affected section surgically (preserve everything else verbatim), call \`update_cluster_brain("${slug}", <full edited body>)\`, then call \`sync_skills\` so this file catches up.`,
        "",
        "### What counts as a trigger",
        "",
        "Trigger phrases for memory (#2): *I prefer X over Y · for my setup … · always use … · skip step … · from now on … · in my environment … · my <env var / value> is …*",
        "",
        "Trigger phrases for brain edit (#3): *step X is wrong · remove the part about … · let's also handle … · add Y to the skill · the example for X should be …*",
        "",
        "**Correction signals** (fire #2 by default, #3 if the correction targets the workflow itself, even with no canonical phrasing): *no · actually … · that's not right · you got X backwards · the answer is Y, not Z*",
        "",
        "**Outcome-dissatisfaction signals** (fire #2 with a memory describing the gotcha; fire #3 if the brain's instructions were the cause): *I tried that, it didn't work · the output wasn't what I wanted · ran it and got the wrong result · this approach gave me garbage · that didn't produce X*. These are the highest-signal moments — the skill led you astray and the user is telling you. Capture the lesson before moving on.",
        "",
        "If unsure whether something is durable enough to save: save it as a memory. Memories are cheap to add and easy to delete; missed lessons are expensive.",
        "",
    ].join("\n");
}
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
    sections.push(`name: dopl-${slug}`);
    sections.push(`description: >-`);
    sections.push(`  ${description}`);
    sections.push(`version: 0.1.0`);
    sections.push(`---`);
    sections.push("");
    // Title
    sections.push(`# ${name}`);
    sections.push("");
    // Brain protocol — the imperative self-maintenance preamble. Lives at
    // the top so the agent reads it before doing any cluster work, not
    // buried at the bottom where end-of-file fatigue hides it.
    sections.push(brainProtocolPreamble(slug));
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
        sections.push(`_No synthesized instructions yet._`);
        sections.push("");
        sections.push(`To fill this in: call the MCP tool \`get_skill_template\` for the canonical prompt, run synthesis against this cluster's entries (fetch with \`get_cluster("${slug}")\`), then call \`update_cluster_brain("${slug}", <your synthesized body>)\`. Run \`sync_skills\` again afterwards to refresh this file.`);
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
    // Source-of-truth note. The when-to-edit protocol lives in the
    // top-of-file Brain protocol section; this footer is just a guard
    // against direct local edits.
    sections.push(`---`);
    sections.push("");
    sections.push(`_Do NOT edit this file directly. The Dopl database is the source of truth for the brain and memories above; local edits are overwritten on the next \`sync_skills\` call and don't propagate to other devices, the web UI, or other agents using the same cluster. Use \`update_cluster_brain\` / \`save_cluster_memory\` to change anything here._`);
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
    sections.push(`name: dopl-canvas`);
    sections.push(`description: >-`);
    sections.push(`  Use when the user asks about their AI/automation setup collection,`);
    sections.push(`  wants to compare approaches across clusters, or needs routing guidance`);
    sections.push(`  for which cluster to use. Tools across clusters: ${allTools || "various"}.`);
    sections.push(`version: 0.1.0`);
    sections.push(`---`);
    sections.push("");
    sections.push(`# Dopl Canvas — Cross-Cluster Routing & Orchestration`);
    sections.push("");
    sections.push(`## Available Clusters`);
    sections.push("");
    if (clusters.length === 0) {
        sections.push(`_No clusters yet. Create clusters in the Dopl canvas to populate this section._`);
    }
    else {
        for (const cluster of clusters) {
            sections.push(`### ${cluster.name} (\`dopl-${cluster.slug}\`)`);
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
            sections.push(`- **${cluster.tools.slice(0, 5).join(", ")}** → Use \`dopl-${cluster.slug}\` skill`);
        }
        else {
            sections.push(`- **${cluster.name}** → Use \`dopl-${cluster.slug}\` skill`);
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
 * Render the Dopl section for ~/.claude/CLAUDE.md.
 */
function renderGlobalClaudeMdSection(clusters) {
    const lines = [];
    lines.push(`## Dopl — Cluster Index`);
    lines.push("");
    lines.push(`You have Dopl skills installed for the following clusters. Each has a dedicated`);
    lines.push(`skill at \`~/.claude/skills/dopl-{slug}/SKILL.md\` that loads automatically when relevant.`);
    lines.push("");
    if (clusters.length === 0) {
        lines.push(`_No clusters yet._`);
    }
    else {
        lines.push(`| Cluster | Skill | Covers |`);
        lines.push(`|---------|-------|--------|`);
        for (const cluster of clusters) {
            lines.push(`| ${cluster.name} | dopl-${cluster.slug} | ${cluster.oneLiner} |`);
        }
    }
    lines.push("");
    lines.push(`For cross-cluster workflows or routing questions, the \`dopl-canvas\` skill has detailed guidance.`);
    return lines.join("\n");
}
