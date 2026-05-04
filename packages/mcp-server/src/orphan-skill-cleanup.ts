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
 *
 * Safety (Audit B7) — multi-user OS account guard: when a meta
 * sidecar carries a `userId` field, we only delete dirs whose userId
 * matches the booting MCP server's user. Legacy meta files without
 * `userId` are LEFT ALONE (we can't prove they're ours). The skill-
 * writer is expected to stamp `userId` going forward; until then
 * cleanup is conservative on legacy data.
 *
 * Concurrency (Audit B12) — we cap parallel `listClusters` calls so a
 * user with many workspaces doesn't fan out an N-wide HTTP burst at
 * boot. Six in flight at once is plenty for the dozens-of-workspaces
 * case without tripping rate limiters.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { access, readdir, readFile, rm } from "node:fs/promises";
import { workspaceContext } from "@dopl/client";
import type { DoplClient, ClusterRow, WorkspaceListItem } from "@dopl/client";

const SKILL_ROOTS = [
  () => join(homedir(), ".claude", "skills"),
  () => join(homedir(), ".openclaw", "workspace", "data", "dopl"),
];

const LIST_CLUSTERS_CONCURRENCY = 6;

interface DoplSkillMeta {
  /** Optional — present on dirs written by post-B7 skill-writers.
   *  Used for the multi-user-OS-account safety check. */
  userId?: string;
}

export async function cleanupOrphanSkills(
  client: DoplClient,
  options: { userId?: string | null } = {},
): Promise<void> {
  const callerUserId = options.userId ?? null;

  // Build the set of dir names we expect to find on disk based on the
  // user's actual memberships + clusters. Anything else with a meta
  // sidecar is an orphan.
  let workspaces: WorkspaceListItem[];
  try {
    const result = await client.listWorkspaces();
    workspaces = result.workspaces;
  } catch (err) {
    // Don't block boot on a flaky list call — just skip the cleanup.
    console.error(
      `[dopl-mcp] Orphan skill cleanup skipped: couldn't fetch workspaces (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return;
  }

  const validDirs = new Set<string>();
  // The M-11 master skill — always preserve.
  validDirs.add("dopl");
  // The legacy "default canvas" global routing skill. We can't tell
  // from disk which workspace is "default," so we accept this name
  // unconditionally as long as it's Dopl-managed.
  validDirs.add("dopl-canvas");

  // Iterate workspaces and pull per-workspace cluster slugs in chunks
  // so we don't fan out an N-wide HTTP burst. Each chunk runs in
  // parallel via Promise.all; chunks run sequentially.
  const clusterSlugsByWs: Array<{
    wsSlug: string;
    clusters: ClusterRow[];
  }> = [];
  for (let i = 0; i < workspaces.length; i += LIST_CLUSTERS_CONCURRENCY) {
    const chunk = workspaces.slice(i, i + LIST_CLUSTERS_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (ws) => {
        try {
          const result = await workspaceContext.run(ws.id, () =>
            client.listClusters(),
          );
          return { wsSlug: ws.slug, clusters: result.clusters as ClusterRow[] };
        } catch {
          // Don't fail the whole pass on one bad workspace.
          return { wsSlug: ws.slug, clusters: [] as ClusterRow[] };
        }
      }),
    );
    clusterSlugsByWs.push(...results);
  }

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
  let skippedForOwnership = 0;
  for (const rootFn of SKILL_ROOTS) {
    const root = rootFn();
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      // Directory doesn't exist — nothing to clean.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // Only consider Dopl-prefixed dirs. The bare `dopl/` (master
      // skill) is preserved by being in `validDirs`.
      if (name !== "dopl" && !name.startsWith("dopl-")) continue;

      const childPath = join(root, name);
      const metaPath = join(childPath, ".dopl-meta.json");

      let meta: DoplSkillMeta | null = null;
      try {
        const raw = await readFile(metaPath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          meta = parsed as DoplSkillMeta;
        } else {
          meta = {};
        }
      } catch (err) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          // No meta sidecar = user-authored or unrelated, don't touch.
          continue;
        }
        // Any other read/parse failure: skip this dir defensively.
        continue;
      }

      // Audit B7: when meta carries a `userId`, only delete if it
      // matches the booting user. When meta has no `userId` (legacy
      // writers), conservatively skip — a shared OS account would
      // otherwise have one user wipe another's dirs.
      if (typeof meta.userId === "string") {
        if (!callerUserId || meta.userId !== callerUserId) {
          skippedForOwnership += 1;
          continue;
        }
      } else {
        // Legacy unattributed dir — don't risk it.
        skippedForOwnership += 1;
        continue;
      }

      if (validDirs.has(name)) continue;

      try {
        await rm(childPath, { recursive: true, force: true });
        deleted += 1;
        console.error(
          `[dopl-mcp] Removed orphan skill dir: ${childPath} (no matching workspace or cluster)`,
        );
      } catch (err) {
        console.error(
          `[dopl-mcp] Failed to remove orphan skill dir ${childPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  if (deleted > 0) {
    const noun = deleted === 1 ? "directory" : "directories";
    console.error(
      `[dopl-mcp] Orphan skill cleanup: removed ${deleted} stale ${noun}.`,
    );
  }
  if (skippedForOwnership > 0) {
    console.error(
      `[dopl-mcp] Orphan skill cleanup: skipped ${skippedForOwnership} ` +
        `unattributable director${skippedForOwnership === 1 ? "y" : "ies"} ` +
        `(no userId in .dopl-meta.json — left in place for safety).`,
    );
  }
}
