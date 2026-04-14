import type { BrainData, ClusterDetailEntry, ClusterSummary } from "./types.js";
/**
 * Check if a cluster skill directory already exists on disk.
 */
export declare function skillExists(slug: string): Promise<boolean>;
/**
 * Write a per-cluster SKILL.md and its references/ directory.
 */
export declare function writeClusterSkill(slug: string, name: string, brain: BrainData, entries: ClusterDetailEntry[]): Promise<void>;
/**
 * Write the global canvas SKILL.md for cross-cluster routing.
 */
export declare function writeGlobalCanvasSkill(clusters: ClusterSummary[]): Promise<void>;
/**
 * Update the SIE section in ~/.claude/CLAUDE.md.
 * Uses sentinel markers to replace only the SIE section, preserving user content.
 */
export declare function writeGlobalClaudemd(clusters: ClusterSummary[]): Promise<void>;
/**
 * Append a single memory line to an existing cluster SKILL.md.
 * Targeted edit — does not rewrite the rest of the file.
 */
export declare function appendMemoryToSkill(slug: string, memory: string): Promise<void>;
/**
 * Remove a cluster skill directory from disk.
 */
export declare function removeClusterSkill(slug: string): Promise<void>;
