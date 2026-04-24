import type { ClusterSkillParams, ClusterDetailEntry, ClusterSummary } from "@dopl/client";
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
export declare function brainProtocolPreamble(slug: string): string;
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
 * Render the Dopl section for ~/.claude/CLAUDE.md.
 */
export declare function renderGlobalClaudeMdSection(clusters: ClusterSummary[]): string;
