import type { ClusterSkillParams, ClusterDetailEntry, ClusterSummary } from "./types.js";
/**
 * Slugify an entry title for use as a reference filename.
 */
export declare function slugifyTitle(title: string): string;
/**
 * Render a per-cluster SKILL.md file.
 */
export declare function renderClusterSkillMd(params: ClusterSkillParams): string;
/**
 * Render a reference file for a single entry.
 */
export declare function renderEntryReferenceMd(entry: ClusterDetailEntry): string;
/**
 * Render the global canvas SKILL.md for cross-cluster routing.
 */
export declare function renderGlobalCanvasSkillMd(clusters: ClusterSummary[]): string;
/**
 * Render the SIE section for ~/.claude/CLAUDE.md.
 */
export declare function renderGlobalClaudeMdSection(clusters: ClusterSummary[]): string;
