"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillExists = skillExists;
exports.skillIsCurrent = skillIsCurrent;
exports.writeClusterSkill = writeClusterSkill;
exports.writeGlobalCanvasSkill = writeGlobalCanvasSkill;
exports.writeGlobalClaudemd = writeGlobalClaudemd;
exports.appendMemoryToSkill = appendMemoryToSkill;
exports.removeClusterSkill = removeClusterSkill;
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const templates_js_1 = require("./templates.js");
const DEFAULT_CANVAS_SLUG = "default";
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
function clusterDirName(canvas, clusterSlug) {
    if (!canvas.slug || canvas.slug === DEFAULT_CANVAS_SLUG) {
        return `dopl-${clusterSlug}`;
    }
    return `dopl-${canvas.slug}-${clusterSlug}`;
}
function globalCanvasDirName(canvas) {
    if (!canvas.slug || canvas.slug === DEFAULT_CANVAS_SLUG) {
        return "dopl-canvas";
    }
    return `dopl-canvas-${canvas.slug}`;
}
/**
 * Atomic file write — write the new content to a temp file in the same
 * directory and rename into place. Crash mid-write leaves the previous
 * file intact rather than half-written. Same-directory rename is atomic
 * on every supported platform.
 */
async function atomicWriteFile(path, content) {
    const tmpPath = `${path}.${process.pid}.tmp`;
    await (0, promises_1.writeFile)(tmpPath, content, "utf-8");
    await (0, promises_1.rename)(tmpPath, path);
}
/**
 * Tiny advisory lock for the CLAUDE.md / INDEX.md mutator. Two parallel
 * `sync_skills` runs would otherwise read-modify-write the same file
 * and the slower one would clobber the faster one's edit. We poll-loop
 * up to LOCK_TIMEOUT_MS waiting for a stale lock to clear; if we time
 * out we proceed without the lock (better to occasionally lose a write
 * than to deadlock the user's tool call).
 */
const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 50;
const LOCK_STALE_MS = 30_000;
async function acquireLock(target) {
    const lockPath = `${target}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            await (0, promises_1.writeFile)(lockPath, `${process.pid}@${Date.now()}`, {
                flag: "wx",
            });
            return async () => {
                try {
                    await (0, promises_1.unlink)(lockPath);
                }
                catch {
                    // Already gone — fine.
                }
            };
        }
        catch {
            // Existing lock — check staleness so a crashed sibling doesn't
            // wedge us forever.
            try {
                const raw = await (0, promises_1.readFile)(lockPath, "utf-8");
                const ts = Number(raw.split("@")[1] ?? 0);
                if (ts && Date.now() - ts > LOCK_STALE_MS) {
                    await (0, promises_1.unlink)(lockPath).catch(() => { });
                    continue;
                }
            }
            catch {
                // Lock file disappeared between attempts — try again.
            }
            await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
        }
    }
    // Timed out — proceed unlocked. The file may end up wrong; better
    // than blocking the caller indefinitely.
    return async () => { };
}
/**
 * Check if a cluster skill directory already exists on disk for the
 * given canvas. Existence-only — does NOT verify the on-disk version
 * matches the server. Use `skillIsCurrent` for that check.
 */
async function skillExists(canvas, clusterSlug, target) {
    const { skillsDir } = resolvePaths(target);
    try {
        await (0, promises_1.access)((0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug), "SKILL.md"));
        return true;
    }
    catch {
        return false;
    }
}
const META_FILENAME = ".dopl-meta.json";
async function readSkillMeta(canvas, clusterSlug, target) {
    const { skillsDir } = resolvePaths(target);
    const path = (0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug), META_FILENAME);
    try {
        const raw = await (0, promises_1.readFile)(path, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1)
            return null;
        if (typeof parsed.brainVersion !== "number")
            return null;
        return {
            version: 1,
            brainVersion: parsed.brainVersion,
            syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : "",
            entrySlugs: Array.isArray(parsed.entrySlugs)
                ? parsed.entrySlugs.filter((s) => typeof s === "string")
                : [],
        };
    }
    catch {
        return null;
    }
}
async function writeSkillMeta(canvas, clusterSlug, meta, target) {
    const { skillsDir } = resolvePaths(target);
    const dir = (0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug));
    await (0, promises_1.mkdir)(dir, { recursive: true });
    await atomicWriteFile((0, path_1.join)(dir, META_FILENAME), JSON.stringify(meta, null, 2) + "\n");
}
/**
 * Returns true when the on-disk skill is up to date for the given
 * server brain version. Used by `sync_skills` to skip reads + writes
 * for clusters whose brain hasn't changed. Treats "no meta file" as
 * stale so a freshly-installed agent re-syncs everything once.
 */
async function skillIsCurrent(canvas, clusterSlug, serverBrainVersion, target) {
    const meta = await readSkillMeta(canvas, clusterSlug, target);
    if (!meta)
        return false;
    return meta.brainVersion === serverBrainVersion;
}
/**
 * Write a per-cluster SKILL.md and its references/ directory. Atomic:
 * SKILL.md and every reference file land via `<file>.tmp` + rename so
 * a crash mid-write never leaves a torn skill. Reconciles orphaned
 * reference files (entries removed from the cluster since the last
 * sync) and writes a `.dopl-meta.json` recording the server brain
 * version this write reflects.
 */
async function writeClusterSkill(canvas, clusterSlug, name, brain, entries, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug));
    const refsDir = (0, path_1.join)(skillDir, "references");
    await (0, promises_1.mkdir)(refsDir, { recursive: true });
    const skillContent = (0, templates_js_1.renderClusterSkillMd)({
        slug: clusterSlug,
        name,
        brain,
        entries,
    });
    await atomicWriteFile((0, path_1.join)(skillDir, "SKILL.md"), skillContent);
    const usedSlugs = new Map();
    const writtenRefSlugs = new Set();
    for (const entry of entries) {
        let entrySlug = (0, templates_js_1.slugifyTitle)(entry.title || "untitled");
        const count = usedSlugs.get(entrySlug) || 0;
        if (count > 0)
            entrySlug = `${entrySlug}-${count + 1}`;
        usedSlugs.set(entrySlug, count + 1);
        const refContent = (0, templates_js_1.renderEntryReferenceMd)(entry);
        await atomicWriteFile((0, path_1.join)(refsDir, `${entrySlug}.md`), refContent);
        writtenRefSlugs.add(entrySlug);
    }
    // Prune orphan reference files — entries that have left the cluster
    // since the last sync. Without this, an entry removed from the
    // cluster keeps its `.md` file in the skill's `references/` dir
    // forever, confusing the agent (and humans skimming the dir) about
    // what's in scope. We compare the just-written set against what's on
    // disk and unlink the difference. Non-fatal: a failure here means a
    // stale reference lingers, but the SKILL.md itself is correct.
    try {
        const existing = await (0, promises_1.readdir)(refsDir);
        for (const file of existing) {
            if (!file.endsWith(".md"))
                continue;
            const slug = file.slice(0, -3);
            if (!writtenRefSlugs.has(slug)) {
                await (0, promises_1.unlink)((0, path_1.join)(refsDir, file)).catch(() => { });
            }
        }
    }
    catch {
        // refsDir might not exist if the cluster has no entries yet;
        // mkdir above already covered the create-on-write case.
    }
    await writeSkillMeta(canvas, clusterSlug, {
        version: 1,
        brainVersion: brain.brain_version ?? 0,
        syncedAt: new Date().toISOString(),
        entrySlugs: Array.from(writtenRefSlugs),
    }, target);
}
/**
 * Write the global cross-cluster routing SKILL.md. One per canvas — so
 * `dopl-canvas-<canvasSlug>` for every non-default canvas, and the
 * legacy `dopl-canvas` for the default canvas.
 */
async function writeGlobalCanvasSkill(canvas, clusters, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, globalCanvasDirName(canvas));
    await (0, promises_1.mkdir)(skillDir, { recursive: true });
    const content = (0, templates_js_1.renderGlobalCanvasSkillMd)(clusters);
    await atomicWriteFile((0, path_1.join)(skillDir, "SKILL.md"), content);
}
/**
 * Update the per-canvas Dopl section in `~/.claude/CLAUDE.md`. Each
 * canvas owns its own sentinel-bracketed block (`<!-- DOPL:START:slug
 * -->` … `<!-- DOPL:END:slug -->`) so concurrent syncs from different
 * canvases don't overwrite each other. Acquires an advisory file lock
 * for the duration of the read-modify-write cycle.
 */
async function writeGlobalClaudemd(canvas, clusters, target) {
    const { indexPath } = resolvePaths(target);
    const indexDir = (0, path_1.join)(indexPath, "..");
    await (0, promises_1.mkdir)(indexDir, { recursive: true });
    const release = await acquireLock(indexPath);
    try {
        const slugTag = canvas.slug || DEFAULT_CANVAS_SLUG;
        const startMarker = slugTag === DEFAULT_CANVAS_SLUG
            ? DOPL_START
            : `<!-- DOPL:START:${slugTag} -->`;
        const endMarker = slugTag === DEFAULT_CANVAS_SLUG
            ? DOPL_END
            : `<!-- DOPL:END:${slugTag} -->`;
        const sieSection = `${startMarker}\n${(0, templates_js_1.renderGlobalClaudeMdSection)(clusters)}\n${endMarker}`;
        let existing = "";
        try {
            existing = await (0, promises_1.readFile)(indexPath, "utf-8");
        }
        catch {
            // File doesn't exist yet
        }
        const startIdx = existing.indexOf(startMarker);
        const endIdx = existing.indexOf(endMarker);
        let next;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const before = existing.slice(0, startIdx);
            const after = existing.slice(endIdx + endMarker.length);
            next = before + sieSection + after;
        }
        else if (startIdx !== -1 || endIdx !== -1) {
            const cleaned = existing
                .replace(startMarker, "")
                .replace(endMarker, "")
                .trimEnd();
            next = cleaned + "\n\n" + sieSection + "\n";
        }
        else if (existing) {
            next = existing.trimEnd() + "\n\n" + sieSection + "\n";
        }
        else {
            next = sieSection + "\n";
        }
        await atomicWriteFile(indexPath, next);
    }
    finally {
        await release();
    }
}
/**
 * Append a single memory line to an existing cluster SKILL.md. Targeted
 * edit — does not rewrite the rest of the file. Atomic write on save.
 */
async function appendMemoryToSkill(canvas, clusterSlug, memory, target) {
    const { skillsDir } = resolvePaths(target);
    const skillPath = (0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug), "SKILL.md");
    let content;
    try {
        content = await (0, promises_1.readFile)(skillPath, "utf-8");
    }
    catch {
        return;
    }
    const memoriesHeader = "## User Memories";
    const headerIndex = content.indexOf(memoriesHeader);
    if (headerIndex === -1) {
        const insertBefore = content.indexOf("## References") !== -1
            ? content.indexOf("## References")
            : content.indexOf("## Self-Maintenance") !== -1
                ? content.indexOf("## Self-Maintenance")
                : content.length;
        const newSection = `${memoriesHeader}\n\n1. ${memory}\n\n`;
        const updated = content.slice(0, insertBefore) + newSection + content.slice(insertBefore);
        await atomicWriteFile(skillPath, updated);
        return;
    }
    const afterHeader = content.slice(headerIndex + memoriesHeader.length);
    const nextHeadingMatch = afterHeader.match(/\n## /);
    const sectionEnd = nextHeadingMatch
        ? headerIndex + memoriesHeader.length + nextHeadingMatch.index
        : content.length;
    const memoriesSection = content.slice(headerIndex + memoriesHeader.length, sectionEnd);
    const existingItems = memoriesSection.match(/^\d+\./gm);
    const nextNumber = existingItems ? existingItems.length + 1 : 1;
    const cleanedSection = memoriesSection.replace(/\n_No memories yet[^_]*_\n?/, "\n");
    const updatedSection = cleanedSection.trimEnd() + `\n${nextNumber}. ${memory}\n\n`;
    const updated = content.slice(0, headerIndex + memoriesHeader.length) +
        updatedSection +
        content.slice(sectionEnd);
    await atomicWriteFile(skillPath, updated);
}
/**
 * Remove a cluster skill directory from disk for the given canvas.
 */
async function removeClusterSkill(canvas, clusterSlug, target) {
    const { skillsDir } = resolvePaths(target);
    const skillDir = (0, path_1.join)(skillsDir, clusterDirName(canvas, clusterSlug));
    try {
        await (0, promises_1.rm)(skillDir, { recursive: true, force: true });
    }
    catch {
        // Already gone — fine.
    }
}
