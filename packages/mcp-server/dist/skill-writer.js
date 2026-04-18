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
function resolveTarget() {
    const env = process.env.DOPL_SKILL_TARGET?.toLowerCase();
    if (env === "openclaw")
        return "openclaw";
    return "claude";
}
function resolvePaths(target) {
    const t = target ?? resolveTarget();
    if (t === "openclaw") {
        const baseDir = (0, path_1.join)((0, os_1.homedir)(), ".openclaw", "workspace", "data", "dopl");
        return {
            skillsDir: baseDir,
            indexPath: (0, path_1.join)(baseDir, "INDEX.md"),
            target: t,
        };
    }
    const claudeDir = (0, path_1.join)((0, os_1.homedir)(), ".claude");
    return {
        skillsDir: (0, path_1.join)(claudeDir, "skills"),
        indexPath: (0, path_1.join)(claudeDir, "CLAUDE.md"),
        target: t,
    };
}
const DOPL_START = "<!-- DOPL:START -->";
const DOPL_END = "<!-- DOPL:END -->";
/**
 * Check if a cluster skill directory already exists on disk.
 */
async function skillExists(slug, target) {
    const { skillsDir } = resolvePaths(target);
    try {
        await (0, promises_1.access)((0, path_1.join)(skillsDir, `dopl-${slug}`, "SKILL.md"));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Write a per-cluster SKILL.md and its references/ directory.
 */
async function writeClusterSkill(slug, name, brain, entries, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, `dopl-${slug}`);
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
async function writeGlobalCanvasSkill(clusters, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, "dopl-canvas");
    await (0, promises_1.mkdir)(skillDir, { recursive: true });
    const content = (0, templates_js_1.renderGlobalCanvasSkillMd)(clusters);
    await (0, promises_1.writeFile)((0, path_1.join)(skillDir, "SKILL.md"), content, "utf-8");
}
/**
 * Update the Dopl section in ~/.claude/CLAUDE.md.
 * Uses sentinel markers to replace only the Dopl section, preserving user content.
 */
async function writeGlobalClaudemd(clusters, target) {
    const { indexPath } = resolvePaths(target);
    const indexDir = (0, path_1.join)(indexPath, "..");
    await (0, promises_1.mkdir)(indexDir, { recursive: true });
    const sieSection = `${DOPL_START}\n${(0, templates_js_1.renderGlobalClaudeMdSection)(clusters)}\n${DOPL_END}`;
    let existing = "";
    try {
        existing = await (0, promises_1.readFile)(indexPath, "utf-8");
    }
    catch {
        // File doesn't exist yet
    }
    const startIdx = existing.indexOf(DOPL_START);
    const endIdx = existing.indexOf(DOPL_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = existing.slice(0, startIdx);
        const after = existing.slice(endIdx + DOPL_END.length);
        await (0, promises_1.writeFile)(indexPath, before + sieSection + after, "utf-8");
    }
    else if (startIdx !== -1 || endIdx !== -1) {
        const cleaned = existing
            .replace(DOPL_START, "")
            .replace(DOPL_END, "")
            .trimEnd();
        await (0, promises_1.writeFile)(indexPath, cleaned + "\n\n" + sieSection + "\n", "utf-8");
    }
    else if (existing) {
        await (0, promises_1.writeFile)(indexPath, existing.trimEnd() + "\n\n" + sieSection + "\n", "utf-8");
    }
    else {
        await (0, promises_1.writeFile)(indexPath, sieSection + "\n", "utf-8");
    }
}
/**
 * Append a single memory line to an existing cluster SKILL.md.
 * Targeted edit — does not rewrite the rest of the file.
 */
async function appendMemoryToSkill(slug, memory, target) {
    const { skillsDir } = resolvePaths(target);
    const skillPath = (0, path_1.join)(skillsDir, `dopl-${slug}`, "SKILL.md");
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
async function removeClusterSkill(slug, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, `dopl-${slug}`);
    try {
        await (0, promises_1.rm)(skillDir, { recursive: true, force: true });
    }
    catch {
        // Directory may not exist
    }
}
