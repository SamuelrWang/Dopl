import { homedir } from "os";
import { join } from "path";
import { mkdir, writeFile, readFile, rm, access } from "fs/promises";
import type { BrainData, ClusterDetailEntry, ClusterSummary } from "./types.js";
import {
  renderClusterSkillMd,
  renderEntryReferenceMd,
  renderGlobalCanvasSkillMd,
  renderGlobalClaudeMdSection,
  slugifyTitle,
} from "./templates.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const CLAUDE_MD_PATH = join(CLAUDE_DIR, "CLAUDE.md");

const SIE_START = "<!-- DOPL:START -->";
const SIE_END = "<!-- DOPL:END -->";

/**
 * Check if a cluster skill directory already exists on disk.
 */
export async function skillExists(slug: string): Promise<boolean> {
  try {
    await access(join(SKILLS_DIR, `dopl-${slug}`, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a per-cluster SKILL.md and its references/ directory.
 */
export async function writeClusterSkill(
  slug: string,
  name: string,
  brain: BrainData,
  entries: ClusterDetailEntry[],
): Promise<void> {
  const skillDir = join(SKILLS_DIR, `dopl-${slug}`);
  const refsDir = join(skillDir, "references");

  await mkdir(refsDir, { recursive: true });

  // Write SKILL.md
  const skillContent = renderClusterSkillMd({ slug, name, brain, entries });
  await writeFile(join(skillDir, "SKILL.md"), skillContent, "utf-8");

  // Write reference files for each entry
  const usedSlugs = new Map<string, number>();
  for (const entry of entries) {
    let entrySlug = slugifyTitle(entry.title || "untitled");
    // Handle slug collisions
    const count = usedSlugs.get(entrySlug) || 0;
    if (count > 0) {
      entrySlug = `${entrySlug}-${count + 1}`;
    }
    usedSlugs.set(entrySlug, count + 1);

    const refContent = renderEntryReferenceMd(entry);
    await writeFile(join(refsDir, `${entrySlug}.md`), refContent, "utf-8");
  }
}

/**
 * Write the global canvas SKILL.md for cross-cluster routing.
 */
export async function writeGlobalCanvasSkill(
  clusters: ClusterSummary[],
): Promise<void> {
  const skillDir = join(SKILLS_DIR, "dopl-canvas");
  await mkdir(skillDir, { recursive: true });

  const content = renderGlobalCanvasSkillMd(clusters);
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
}

/**
 * Update the Dopl section in ~/.claude/CLAUDE.md.
 * Uses sentinel markers to replace only the Dopl section, preserving user content.
 */
export async function writeGlobalClaudemd(
  clusters: ClusterSummary[],
): Promise<void> {
  await mkdir(CLAUDE_DIR, { recursive: true });

  const sieSection = `${SIE_START}\n${renderGlobalClaudeMdSection(clusters)}\n${SIE_END}`;

  let existing = "";
  try {
    existing = await readFile(CLAUDE_MD_PATH, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  const startIdx = existing.indexOf(SIE_START);
  const endIdx = existing.indexOf(SIE_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Valid markers — replace existing Dopl section
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + SIE_END.length);
    await writeFile(CLAUDE_MD_PATH, before + sieSection + after, "utf-8");
  } else if (startIdx !== -1 || endIdx !== -1) {
    // Corrupted markers (one missing, or wrong order) — strip both and re-append
    const cleaned = existing
      .replace(SIE_START, "")
      .replace(SIE_END, "")
      .trimEnd();
    await writeFile(
      CLAUDE_MD_PATH,
      cleaned + "\n\n" + sieSection + "\n",
      "utf-8",
    );
  } else if (existing) {
    // Append Dopl section
    await writeFile(
      CLAUDE_MD_PATH,
      existing.trimEnd() + "\n\n" + sieSection + "\n",
      "utf-8",
    );
  } else {
    // Create new file
    await writeFile(CLAUDE_MD_PATH, sieSection + "\n", "utf-8");
  }
}

/**
 * Append a single memory line to an existing cluster SKILL.md.
 * Targeted edit — does not rewrite the rest of the file.
 */
export async function appendMemoryToSkill(
  slug: string,
  memory: string,
): Promise<void> {
  const skillPath = join(SKILLS_DIR, `dopl-${slug}`, "SKILL.md");

  let content: string;
  try {
    content = await readFile(skillPath, "utf-8");
  } catch {
    // Skill file doesn't exist yet — nothing to update
    return;
  }

  const memoriesHeader = "## User Memories";
  const headerIndex = content.indexOf(memoriesHeader);

  if (headerIndex === -1) {
    // No memories section — insert before ## References or ## Self-Maintenance
    const insertBefore =
      content.indexOf("## References") !== -1
        ? content.indexOf("## References")
        : content.indexOf("## Self-Maintenance") !== -1
          ? content.indexOf("## Self-Maintenance")
          : content.length;

    const newSection = `${memoriesHeader}\n\n1. ${memory}\n\n`;
    const updated =
      content.slice(0, insertBefore) + newSection + content.slice(insertBefore);
    await writeFile(skillPath, updated, "utf-8");
    return;
  }

  // Find the end of the memories section (next ## heading or end of file)
  const afterHeader = content.slice(headerIndex + memoriesHeader.length);
  const nextHeadingMatch = afterHeader.match(/\n## /);
  const sectionEnd = nextHeadingMatch
    ? headerIndex + memoriesHeader.length + nextHeadingMatch.index!
    : content.length;

  const memoriesSection = content.slice(
    headerIndex + memoriesHeader.length,
    sectionEnd,
  );

  // Count existing numbered items
  const existingItems = memoriesSection.match(/^\d+\./gm);
  const nextNumber = existingItems ? existingItems.length + 1 : 1;

  // Remove the placeholder if present
  const cleanedSection = memoriesSection.replace(
    /\n_No memories yet[^_]*_\n?/,
    "\n",
  );

  // Append the new memory
  const updatedSection = cleanedSection.trimEnd() + `\n${nextNumber}. ${memory}\n\n`;

  const updated =
    content.slice(0, headerIndex + memoriesHeader.length) +
    updatedSection +
    content.slice(sectionEnd);

  await writeFile(skillPath, updated, "utf-8");
}

/**
 * Remove a cluster skill directory from disk.
 */
export async function removeClusterSkill(slug: string): Promise<void> {
  const skillDir = join(SKILLS_DIR, `dopl-${slug}`);
  try {
    await rm(skillDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
}
