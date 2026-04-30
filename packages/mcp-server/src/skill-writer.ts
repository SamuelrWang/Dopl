import { homedir } from "os";
import { join } from "path";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  access,
  unlink,
} from "fs/promises";
import type { BrainData, ClusterDetailEntry, ClusterSummary } from "@dopl/client";
import {
  renderClusterSkillMd,
  renderEntryReferenceMd,
  renderGlobalCanvasSkillMd,
  renderGlobalClaudeMdSection,
  slugifyTitle,
} from "./templates.js";

// ── Target platform resolution ───────────────────────────────────
// DOPL_SKILL_TARGET=openclaw writes to ~/.openclaw/workspace/data/dopl/
// Default (unset or "claude") writes to ~/.claude/skills/

export type SkillTarget = "claude" | "openclaw";

/**
 * Active canvas context for every skill-writer call. The slug becomes
 * part of the on-disk skill directory so multiple canvases never
 * collide. When the slug is "default" we keep the legacy
 * `dopl-<clusterSlug>` shape so users who haven't moved off the single
 * canvas don't see every skill rename on first upgrade.
 */
export interface CanvasContext {
  slug: string;
}

const DEFAULT_CANVAS_SLUG = "default";

function resolveTarget(): SkillTarget {
  const env = process.env.DOPL_SKILL_TARGET?.toLowerCase();
  if (env === "openclaw") return "openclaw";
  return "claude";
}

function resolvePaths(target?: SkillTarget) {
  const t = target ?? resolveTarget();
  if (t === "openclaw") {
    const baseDir = join(homedir(), ".openclaw", "workspace", "data", "dopl");
    return {
      skillsDir: baseDir,
      indexPath: join(baseDir, "INDEX.md"),
      target: t as SkillTarget,
    };
  }
  const claudeDir = join(homedir(), ".claude");
  return {
    skillsDir: join(claudeDir, "skills"),
    indexPath: join(claudeDir, "CLAUDE.md"),
    target: t as SkillTarget,
  };
}

const DOPL_START = "<!-- DOPL:START -->";
const DOPL_END = "<!-- DOPL:END -->";

function clusterDirName(canvas: CanvasContext, clusterSlug: string): string {
  if (!canvas.slug || canvas.slug === DEFAULT_CANVAS_SLUG) {
    return `dopl-${clusterSlug}`;
  }
  return `dopl-${canvas.slug}-${clusterSlug}`;
}

function globalCanvasDirName(canvas: CanvasContext): string {
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
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, path);
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

async function acquireLock(target: string): Promise<() => Promise<void>> {
  const lockPath = `${target}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await writeFile(lockPath, `${process.pid}@${Date.now()}`, {
        flag: "wx",
      });
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // Already gone — fine.
        }
      };
    } catch {
      // Existing lock — check staleness so a crashed sibling doesn't
      // wedge us forever.
      try {
        const raw = await readFile(lockPath, "utf-8");
        const ts = Number(raw.split("@")[1] ?? 0);
        if (ts && Date.now() - ts > LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // Lock file disappeared between attempts — try again.
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  // Timed out — proceed unlocked. The file may end up wrong; better
  // than blocking the caller indefinitely.
  return async () => {};
}

/**
 * Check if a cluster skill directory already exists on disk for the
 * given canvas. Existence-only — does NOT verify the on-disk version
 * matches the server. Use `skillIsCurrent` for that check.
 */
export async function skillExists(
  canvas: CanvasContext,
  clusterSlug: string,
  target?: SkillTarget,
): Promise<boolean> {
  const { skillsDir } = resolvePaths(target);
  try {
    await access(
      join(skillsDir, clusterDirName(canvas, clusterSlug), "SKILL.md"),
    );
    return true;
  } catch {
    return false;
  }
}

// ── Skill metadata ───────────────────────────────────────────────────
//
// Each cluster skill dir owns a `.dopl-meta.json` file that records the
// brain version + sync timestamp + entry slugs at last write. The next
// `sync_skills` call compares the server's brain_version against this
// number to decide whether the on-disk SKILL.md is stale.
//
// This replaces the old "skip if file exists" heuristic, which silently
// missed every server-side brain edit because the file was always
// present. The meta file is small (<200 bytes) and read once per
// cluster per sync, so the cost is negligible.

interface SkillMetaV1 {
  version: 1;
  brainVersion: number;
  syncedAt: string;
  entrySlugs: string[];
}

const META_FILENAME = ".dopl-meta.json";

async function readSkillMeta(
  canvas: CanvasContext,
  clusterSlug: string,
  target?: SkillTarget,
): Promise<SkillMetaV1 | null> {
  const { skillsDir } = resolvePaths(target);
  const path = join(
    skillsDir,
    clusterDirName(canvas, clusterSlug),
    META_FILENAME,
  );
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SkillMetaV1>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.brainVersion !== "number") return null;
    return {
      version: 1,
      brainVersion: parsed.brainVersion,
      syncedAt:
        typeof parsed.syncedAt === "string" ? parsed.syncedAt : "",
      entrySlugs: Array.isArray(parsed.entrySlugs)
        ? parsed.entrySlugs.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch {
    return null;
  }
}

async function writeSkillMeta(
  canvas: CanvasContext,
  clusterSlug: string,
  meta: SkillMetaV1,
  target?: SkillTarget,
): Promise<void> {
  const { skillsDir } = resolvePaths(target);
  const dir = join(skillsDir, clusterDirName(canvas, clusterSlug));
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(
    join(dir, META_FILENAME),
    JSON.stringify(meta, null, 2) + "\n",
  );
}

/**
 * Returns true when the on-disk skill is up to date for the given
 * server brain version. Used by `sync_skills` to skip reads + writes
 * for clusters whose brain hasn't changed. Treats "no meta file" as
 * stale so a freshly-installed agent re-syncs everything once.
 */
export async function skillIsCurrent(
  canvas: CanvasContext,
  clusterSlug: string,
  serverBrainVersion: number,
  target?: SkillTarget,
): Promise<boolean> {
  const meta = await readSkillMeta(canvas, clusterSlug, target);
  if (!meta) return false;
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
export async function writeClusterSkill(
  canvas: CanvasContext,
  clusterSlug: string,
  name: string,
  brain: BrainData,
  entries: ClusterDetailEntry[],
  target?: SkillTarget,
): Promise<void> {
  const { skillsDir } = resolvePaths(target);
  const skillDir = join(skillsDir, clusterDirName(canvas, clusterSlug));
  const refsDir = join(skillDir, "references");

  await mkdir(refsDir, { recursive: true });

  const skillContent = renderClusterSkillMd({
    slug: clusterSlug,
    name,
    brain,
    entries,
  });
  await atomicWriteFile(join(skillDir, "SKILL.md"), skillContent);

  const usedSlugs = new Map<string, number>();
  const writtenRefSlugs = new Set<string>();
  for (const entry of entries) {
    let entrySlug = slugifyTitle(entry.title || "untitled");
    const count = usedSlugs.get(entrySlug) || 0;
    if (count > 0) entrySlug = `${entrySlug}-${count + 1}`;
    usedSlugs.set(entrySlug, count + 1);

    const refContent = renderEntryReferenceMd(entry);
    await atomicWriteFile(join(refsDir, `${entrySlug}.md`), refContent);
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
    const existing = await readdir(refsDir);
    for (const file of existing) {
      if (!file.endsWith(".md")) continue;
      const slug = file.slice(0, -3);
      if (!writtenRefSlugs.has(slug)) {
        await unlink(join(refsDir, file)).catch(() => {});
      }
    }
  } catch {
    // refsDir might not exist if the cluster has no entries yet;
    // mkdir above already covered the create-on-write case.
  }

  await writeSkillMeta(
    canvas,
    clusterSlug,
    {
      version: 1,
      brainVersion: brain.brain_version ?? 0,
      syncedAt: new Date().toISOString(),
      entrySlugs: Array.from(writtenRefSlugs),
    },
    target,
  );
}

/**
 * Write the global cross-cluster routing SKILL.md. One per canvas — so
 * `dopl-canvas-<workspaceSlug>` for every non-default canvas, and the
 * legacy `dopl-canvas` for the default canvas.
 */
export async function writeGlobalCanvasSkill(
  canvas: CanvasContext,
  clusters: ClusterSummary[],
  target?: SkillTarget,
): Promise<void> {
  const { skillsDir } = resolvePaths(target);
  const skillDir = join(skillsDir, globalCanvasDirName(canvas));
  await mkdir(skillDir, { recursive: true });
  const content = renderGlobalCanvasSkillMd(clusters);
  await atomicWriteFile(join(skillDir, "SKILL.md"), content);
}

/**
 * Update the per-canvas Dopl section in `~/.claude/CLAUDE.md`. Each
 * canvas owns its own sentinel-bracketed block (`<!-- DOPL:START:slug
 * -->` … `<!-- DOPL:END:slug -->`) so concurrent syncs from different
 * canvases don't overwrite each other. Acquires an advisory file lock
 * for the duration of the read-modify-write cycle.
 */
export async function writeGlobalClaudemd(
  canvas: CanvasContext,
  clusters: ClusterSummary[],
  target?: SkillTarget,
): Promise<void> {
  const { indexPath } = resolvePaths(target);
  const indexDir = join(indexPath, "..");
  await mkdir(indexDir, { recursive: true });

  const release = await acquireLock(indexPath);
  try {
    const slugTag = canvas.slug || DEFAULT_CANVAS_SLUG;
    const startMarker = slugTag === DEFAULT_CANVAS_SLUG
      ? DOPL_START
      : `<!-- DOPL:START:${slugTag} -->`;
    const endMarker = slugTag === DEFAULT_CANVAS_SLUG
      ? DOPL_END
      : `<!-- DOPL:END:${slugTag} -->`;
    const sieSection = `${startMarker}\n${renderGlobalClaudeMdSection(clusters)}\n${endMarker}`;

    let existing = "";
    try {
      existing = await readFile(indexPath, "utf-8");
    } catch {
      // File doesn't exist yet
    }

    const startIdx = existing.indexOf(startMarker);
    const endIdx = existing.indexOf(endMarker);

    let next: string;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + endMarker.length);
      next = before + sieSection + after;
    } else if (startIdx !== -1 || endIdx !== -1) {
      const cleaned = existing
        .replace(startMarker, "")
        .replace(endMarker, "")
        .trimEnd();
      next = cleaned + "\n\n" + sieSection + "\n";
    } else if (existing) {
      next = existing.trimEnd() + "\n\n" + sieSection + "\n";
    } else {
      next = sieSection + "\n";
    }
    await atomicWriteFile(indexPath, next);
  } finally {
    await release();
  }
}

/**
 * Append a single memory line to an existing cluster SKILL.md. Targeted
 * edit — does not rewrite the rest of the file. Atomic write on save.
 */
export async function appendMemoryToSkill(
  canvas: CanvasContext,
  clusterSlug: string,
  memory: string,
  target?: SkillTarget,
): Promise<void> {
  const { skillsDir } = resolvePaths(target);
  const skillPath = join(
    skillsDir,
    clusterDirName(canvas, clusterSlug),
    "SKILL.md",
  );

  let content: string;
  try {
    content = await readFile(skillPath, "utf-8");
  } catch {
    return;
  }

  const memoriesHeader = "## User Memories";
  const headerIndex = content.indexOf(memoriesHeader);

  if (headerIndex === -1) {
    const insertBefore =
      content.indexOf("## References") !== -1
        ? content.indexOf("## References")
        : content.indexOf("## Self-Maintenance") !== -1
          ? content.indexOf("## Self-Maintenance")
          : content.length;
    const newSection = `${memoriesHeader}\n\n1. ${memory}\n\n`;
    const updated =
      content.slice(0, insertBefore) + newSection + content.slice(insertBefore);
    await atomicWriteFile(skillPath, updated);
    return;
  }

  const afterHeader = content.slice(headerIndex + memoriesHeader.length);
  const nextHeadingMatch = afterHeader.match(/\n## /);
  const sectionEnd = nextHeadingMatch
    ? headerIndex + memoriesHeader.length + nextHeadingMatch.index!
    : content.length;
  const memoriesSection = content.slice(
    headerIndex + memoriesHeader.length,
    sectionEnd,
  );
  const existingItems = memoriesSection.match(/^\d+\./gm);
  const nextNumber = existingItems ? existingItems.length + 1 : 1;
  const cleanedSection = memoriesSection.replace(
    /\n_No memories yet[^_]*_\n?/,
    "\n",
  );
  const updatedSection =
    cleanedSection.trimEnd() + `\n${nextNumber}. ${memory}\n\n`;
  const updated =
    content.slice(0, headerIndex + memoriesHeader.length) +
    updatedSection +
    content.slice(sectionEnd);
  await atomicWriteFile(skillPath, updated);
}

/**
 * Remove a cluster skill directory from disk for the given canvas.
 */
export async function removeClusterSkill(
  canvas: CanvasContext,
  clusterSlug: string,
  target?: SkillTarget,
): Promise<void> {
  const { skillsDir } = resolvePaths(target);
  const skillDir = join(skillsDir, clusterDirName(canvas, clusterSlug));
  try {
    await rm(skillDir, { recursive: true, force: true });
  } catch {
    // Already gone — fine.
  }
}
