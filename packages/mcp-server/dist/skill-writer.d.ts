import type { BrainData, ClusterDetailEntry, ClusterSummary } from "./types.js";
export type SkillTarget = "claude" | "openclaw";
/**
 * Check if a cluster skill directory already exists on disk.
 */
export declare function skillExists(slug: string, target?: SkillTarget): Promise<boolean>;
/**
 * Write a per-cluster SKILL.md and its references/ directory.
 */
export declare function writeClusterSkill(slug: string, name: string, brain: BrainData, entries: ClusterDetailEntry[], target?: SkillTarget): Promise<void>;
/**
 * Write the global canvas SKILL.md for cross-cluster routing.
 */
export declare function writeGlobalCanvasSkill(clusters: ClusterSummary[], target?: SkillTarget): Promise<void>;
/**
 * Update the Dopl section in ~/.claude/CLAUDE.md.
 * Uses sentinel markers to replace only the Dopl section, preserving user content.
 */
export declare function writeGlobalClaudemd(clusters: ClusterSummary[], target?: SkillTarget): Promise<void>;
/**
 * Append a single memory line to an existing cluster SKILL.md.
 * Targeted edit — does not rewrite the rest of the file.
 */
export declare function appendMemoryToSkill(slug: string, memory: string, target?: SkillTarget): Promise<void>;
/**
 * Remove a cluster skill directory from disk.
 */
export declare function removeClusterSkill(slug: string, target?: SkillTarget): Promise<void>;
