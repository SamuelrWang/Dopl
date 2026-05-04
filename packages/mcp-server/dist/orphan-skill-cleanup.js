"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOrphanSkills = cleanupOrphanSkills;
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const promises_1 = require("node:fs/promises");
const client_1 = require("@dopl/client");
const SKILL_ROOTS = [
    () => (0, node_path_1.join)((0, node_os_1.homedir)(), ".claude", "skills"),
    () => (0, node_path_1.join)((0, node_os_1.homedir)(), ".openclaw", "workspace", "data", "dopl"),
];
async function cleanupOrphanSkills(client) {
    // Build the set of dir names we expect to find on disk based on the
    // user's actual memberships + clusters. Anything else with a meta
    // sidecar is an orphan.
    let workspaces;
    try {
        const result = await client.listWorkspaces();
        workspaces = result.workspaces;
    }
    catch (err) {
        // Don't block boot on a flaky list call — just skip the cleanup.
        console.error(`[dopl-mcp] Orphan skill cleanup skipped: couldn't fetch workspaces (${err instanceof Error ? err.message : String(err)})`);
        return;
    }
    const validDirs = new Set();
    // The M-11 master skill — always preserve.
    validDirs.add("dopl");
    // The legacy "default canvas" global routing skill. We can't tell
    // from disk which workspace is "default," so we accept this name
    // unconditionally as long as it's Dopl-managed.
    validDirs.add("dopl-canvas");
    // Iterate workspaces and pull per-workspace cluster slugs in
    // parallel. Use the M-1 AsyncLocalStorage override so each
    // listClusters call carries the right X-Workspace-Id header without
    // mutating the session default.
    const clusterSlugsByWs = await Promise.all(workspaces.map(async (ws) => {
        try {
            const result = await client_1.workspaceContext.run(ws.id, () => client.listClusters());
            return { wsSlug: ws.slug, clusters: result.clusters };
        }
        catch {
            // Don't fail the whole pass on one bad workspace.
            return { wsSlug: ws.slug, clusters: [] };
        }
    }));
    for (const { wsSlug, clusters } of clusterSlugsByWs) {
        validDirs.add(`dopl-canvas-${wsSlug}`);
        for (const cluster of clusters) {
            // Cluster may exist under EITHER convention (default-canvas or
            // workspace-prefixed) — accept both so we don't false-positive
            // when the on-disk dir was written by a different version.
            validDirs.add(`dopl-${cluster.slug}`);
            validDirs.add(`dopl-${wsSlug}-${cluster.slug}`);
        }
    }
    let deleted = 0;
    for (const rootFn of SKILL_ROOTS) {
        const root = rootFn();
        let entries;
        try {
            entries = await (0, promises_1.readdir)(root, { withFileTypes: true });
        }
        catch {
            // Directory doesn't exist — nothing to clean.
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const name = entry.name;
            // Only consider Dopl-prefixed dirs. The bare `dopl/` (master
            // skill) is preserved by being in `validDirs`.
            if (name !== "dopl" && !name.startsWith("dopl-"))
                continue;
            const childPath = (0, node_path_1.join)(root, name);
            const metaPath = (0, node_path_1.join)(childPath, ".dopl-meta.json");
            try {
                await (0, promises_1.access)(metaPath);
            }
            catch {
                // No meta sidecar = user-authored or unrelated, don't touch.
                continue;
            }
            if (validDirs.has(name))
                continue;
            try {
                await (0, promises_1.rm)(childPath, { recursive: true, force: true });
                deleted += 1;
                console.error(`[dopl-mcp] Removed orphan skill dir: ${childPath} (no matching workspace or cluster)`);
            }
            catch (err) {
                console.error(`[dopl-mcp] Failed to remove orphan skill dir ${childPath}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    if (deleted > 0) {
        const noun = deleted === 1 ? "directory" : "directories";
        console.error(`[dopl-mcp] Orphan skill cleanup: removed ${deleted} stale ${noun}.`);
    }
}
