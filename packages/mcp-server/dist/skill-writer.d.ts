import type { BrainData, ClusterDetailEntry, ClusterSummary } from "@dopl/client";
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
/**
 * Check if a cluster skill directory already exists on disk for the
 * given canvas.
 */
export declare function skillExists(canvas: CanvasContext, clusterSlug: string, target?: SkillTarget): Promise<boolean>;
/**
 * Write a per-cluster SKILL.md and its references/ directory. Atomic:
 * SKILL.md and every reference file land via `<file>.tmp` + rename so
 * a crash mid-write never leaves a torn skill.
 */
export declare function writeClusterSkill(canvas: CanvasContext, clusterSlug: string, name: string, brain: BrainData, entries: ClusterDetailEntry[], target?: SkillTarget): Promise<void>;
/**
 * Write the global cross-cluster routing SKILL.md. One per canvas — so
 * `dopl-canvas-<canvasSlug>` for every non-default canvas, and the
 * legacy `dopl-canvas` for the default canvas.
 */
export declare function writeGlobalCanvasSkill(canvas: CanvasContext, clusters: ClusterSummary[], target?: SkillTarget): Promise<void>;
/**
 * Update the per-canvas Dopl section in `~/.claude/CLAUDE.md`. Each
 * canvas owns its own sentinel-bracketed block (`<!-- DOPL:START:slug
 * -->` … `<!-- DOPL:END:slug -->`) so concurrent syncs from different
 * canvases don't overwrite each other. Acquires an advisory file lock
 * for the duration of the read-modify-write cycle.
 */
export declare function writeGlobalClaudemd(canvas: CanvasContext, clusters: ClusterSummary[], target?: SkillTarget): Promise<void>;
/**
 * Append a single memory line to an existing cluster SKILL.md. Targeted
 * edit — does not rewrite the rest of the file. Atomic write on save.
 */
export declare function appendMemoryToSkill(canvas: CanvasContext, clusterSlug: string, memory: string, target?: SkillTarget): Promise<void>;
/**
 * Remove a cluster skill directory from disk for the given canvas.
 */
export declare function removeClusterSkill(canvas: CanvasContext, clusterSlug: string, target?: SkillTarget): Promise<void>;
