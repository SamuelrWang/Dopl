"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillExists = skillExists;
exports.writeClusterSkill = writeClusterSkill;
exports.writeGlobalCanvasSkill = writeGlobalCanvasSkill;
exports.writeGlobalClaudemd = writeGlobalClaudemd;
exports.appendMemoryToSkill = appendMemoryToSkill;
exports.removeClusterSkill = removeClusterSkill;
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const templates_js_1 = require("./templates.js");
const CLAUDE_DIR = (0, path_1.join)((0, os_1.homedir)(), ".claude");
const SKILLS_DIR = (0, path_1.join)(CLAUDE_DIR, "skills");
const CLAUDE_MD_PATH = (0, path_1.join)(CLAUDE_DIR, "CLAUDE.md");
const SIE_START = "<!-- DOPL:START -->";
const SIE_END = "<!-- DOPL:END -->";
/**
 * Check if a cluster skill directory already exists on disk.
 */
async function skillExists(slug) {
    try {
        await (0, promises_1.access)((0, path_1.join)(SKILLS_DIR, `dopl-${slug}`, "SKILL.md"));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Write a per-cluster SKILL.md and its references/ directory.
 */
async function writeClusterSkill(slug, name, brain, entries) {
    const skillDir = (0, path_1.join)(SKILLS_DIR, `dopl-${slug}`);
    const refsDir = (0, path_1.join)(skillDir, "references");
    await (0, promises_1.mkdir)(refsDir, { recursive: true });
    // Write SKILL.md
    const skillContent = (0, templates_js_1.renderClusterSkillMd)({ slug, name, brain, entries });
    await (0, promises_1.writeFile)((0, path_1.join)(skillDir, "SKILL.md"), skillContent, "utf-8");
    // Write reference files for each entry
    const usedSlugs = new Map();
    for (const entry of entries) {
        let entrySlug = (0, templates_js_1.slugifyTitle)(entry.title || "untitled");
        // Handle slug collisions
        const count = usedSlugs.get(entrySlug) || 0;
        if (count > 0) {
            entrySlug = `${entrySlug}-${count + 1}`;
        }
        usedSlugs.set(entrySlug, count + 1);
        const refContent = (0, templates_js_1.renderEntryReferenceMd)(entry);
        await (0, promises_1.writeFile)((0, path_1.join)(refsDir, `${entrySlug}.md`), refContent, "utf-8");
    }
}
/**
 * Write the global canvas SKILL.md for cross-cluster routing.
 */
async function writeGlobalCanvasSkill(clusters) {
    const skillDir = (0, path_1.join)(SKILLS_DIR, "dopl-canvas");
    await (0, promises_1.mkdir)(skillDir, { recursive: true });
    const content = (0, templates_js_1.renderGlobalCanvasSkillMd)(clusters);
    await (0, promises_1.writeFile)((0, path_1.join)(skillDir, "SKILL.md"), content, "utf-8");
}
/**
 * Update the Dopl section in ~/.claude/CLAUDE.md.
 * Uses sentinel markers to replace only the Dopl section, preserving user content.
 */
async function writeGlobalClaudemd(clusters) {
    await (0, promises_1.mkdir)(CLAUDE_DIR, { recursive: true });
    const sieSection = `${SIE_START}\n${(0, templates_js_1.renderGlobalClaudeMdSection)(clusters)}\n${SIE_END}`;
    let existing = "";
    try {
        existing = await (0, promises_1.readFile)(CLAUDE_MD_PATH, "utf-8");
    }
    catch {
        // File doesn't exist yet
    }
    const startIdx = existing.indexOf(SIE_START);
    const endIdx = existing.indexOf(SIE_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Valid markers — replace existing Dopl section
        const before = existing.slice(0, startIdx);
        const after = existing.slice(endIdx + SIE_END.length);
        await (0, promises_1.writeFile)(CLAUDE_MD_PATH, before + sieSection + after, "utf-8");
    }
    else if (startIdx !== -1 || endIdx !== -1) {
        // Corrupted markers (one missing, or wrong order) — strip both and re-append
        const cleaned = existing
            .replace(SIE_START, "")
            .replace(SIE_END, "")
            .trimEnd();
        await (0, promises_1.writeFile)(CLAUDE_MD_PATH, cleaned + "\n\n" + sieSection + "\n", "utf-8");
    }
    else if (existing) {
        // Append Dopl section
        await (0, promises_1.writeFile)(CLAUDE_MD_PATH, existing.trimEnd() + "\n\n" + sieSection + "\n", "utf-8");
    }
    else {
        // Create new file
        await (0, promises_1.writeFile)(CLAUDE_MD_PATH, sieSection + "\n", "utf-8");
    }
}
/**
 * Append a single memory line to an existing cluster SKILL.md.
 * Targeted edit — does not rewrite the rest of the file.
 */
async function appendMemoryToSkill(slug, memory) {
    const skillPath = (0, path_1.join)(SKILLS_DIR, `dopl-${slug}`, "SKILL.md");
    let content;
    try {
        content = await (0, promises_1.readFile)(skillPath, "utf-8");
    }
    catch {
        // Skill file doesn't exist yet — nothing to update
        return;
    }
    const memoriesHeader = "## User Memories";
    const headerIndex = content.indexOf(memoriesHeader);
    if (headerIndex === -1) {
        // No memories section — insert before ## References or ## Self-Maintenance
        const insertBefore = content.indexOf("## References") !== -1
            ? content.indexOf("## References")
            : content.indexOf("## Self-Maintenance") !== -1
                ? content.indexOf("## Self-Maintenance")
                : content.length;
        const newSection = `${memoriesHeader}\n\n1. ${memory}\n\n`;
        const updated = content.slice(0, insertBefore) + newSection + content.slice(insertBefore);
        await (0, promises_1.writeFile)(skillPath, updated, "utf-8");
        return;
    }
    // Find the end of the memories section (next ## heading or end of file)
    const afterHeader = content.slice(headerIndex + memoriesHeader.length);
    const nextHeadingMatch = afterHeader.match(/\n## /);
    const sectionEnd = nextHeadingMatch
        ? headerIndex + memoriesHeader.length + nextHeadingMatch.index
        : content.length;
    const memoriesSection = content.slice(headerIndex + memoriesHeader.length, sectionEnd);
    // Count existing numbered items
    const existingItems = memoriesSection.match(/^\d+\./gm);
    const nextNumber = existingItems ? existingItems.length + 1 : 1;
    // Remove the placeholder if present
    const cleanedSection = memoriesSection.replace(/\n_No memories yet[^_]*_\n?/, "\n");
    // Append the new memory
    const updatedSection = cleanedSection.trimEnd() + `\n${nextNumber}. ${memory}\n\n`;
    const updated = content.slice(0, headerIndex + memoriesHeader.length) +
        updatedSection +
        content.slice(sectionEnd);
    await (0, promises_1.writeFile)(skillPath, updated, "utf-8");
}
/**
 * Remove a cluster skill directory from disk.
 */
async function removeClusterSkill(slug) {
    const skillDir = (0, path_1.join)(SKILLS_DIR, `dopl-${slug}`);
    try {
        await (0, promises_1.rm)(skillDir, { recursive: true, force: true });
    }
    catch {
        // Directory may not exist
    }
}
