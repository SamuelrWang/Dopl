/**
 * Orphan skill-dir cleanup (M-5).
 *
 * Earlier versions of @dopl/mcp-server wrote per-cluster SKILL.md
 * bundles to `~/.claude/skills/dopl-{slug}/` (and an alternate path
 * `~/.openclaw/workspace/data/dopl/`) at startup. When a user leaves a
 * workspace, deletes a cluster, or just upgrades the server after that
 * sync was removed, those dirs become stale — Claude Code keeps
 * autoloading them via `~/.claude/CLAUDE.md` and the agent gets stale
 * routing context that doesn't match what `list_clusters` says.
 *
 * On boot we now do one pass: list every `dopl-*` directory under
 * the skill roots that contains a `.dopl-meta.json` sidecar (the marker
 * "Dopl-managed; safe to touch"), compare against the user's current
 * workspaces + clusters, and delete the ones that don't correspond to
 * anything live. Each deletion is logged to stderr with the
 * `[dopl-mcp]` prefix — never a silent rm.
 *
 * Directories WITHOUT `.dopl-meta.json` are user-authored or otherwise
 * non-Dopl and we never touch them, even if their name starts with
 * `dopl-`. Likewise the bare `dopl/` directory (the M-11 master skill)
 * is always preserved.
 *
 * Naming conventions we account for (legacy from skill-writer):
 *   - `dopl-{cluster-slug}` — cluster in the user's default canvas
 *   - `dopl-{canvas-slug}-{cluster-slug}` — cluster in a non-default canvas
 *   - `dopl-canvas` — global routing skill for the default canvas
 *   - `dopl-canvas-{canvas-slug}` — global routing for a non-default canvas
 *
 * "Canvas" pre-multi-workspace = "workspace" today. We use the
 * workspace slug for both old-style "{ws}-{cluster}" and "canvas-{ws}"
 * names. Slugs may contain hyphens, so a dir like `dopl-foo-bar` is
 * ambiguous (workspace foo + cluster bar, or default-canvas cluster
 * foo-bar). The cleanup is permissive: if EITHER interpretation
 * matches something live, we keep the dir.
 */
import type { DoplClient } from "@dopl/client";
export declare function cleanupOrphanSkills(client: DoplClient): Promise<void>;
