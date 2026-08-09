"use strict";
/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in.
 *
 * Split out of `server.ts` (§2, the layer rule): membership caching,
 * slug→id resolution and the "you must pass `workspace=`" refusal are one
 * responsibility — resolving a target — distinct from registering tools
 * (`registrar.ts`), gating ops (`gating.ts`) or writing the briefing
 * (`instructions.ts`).
 *
 * FAIL-CLOSED IS THE POINT AND IT DID NOT MOVE. A blank `workspace=` is
 * rejected by the caller in `registrar.ts`; a caller with 0 or 2+ memberships
 * and no pin gets {@link WorkspaceDirectory.noWorkspaceError} rather than a
 * guessed workspace; and a boot directory load that FAILED does not seed the
 * cache, so the first resolution retries instead of serving a bogus empty list
 * for a full TTL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkspaceDirectory = createWorkspaceDirectory;
const narration_js_1 = require("./tools/narration.js");
const instructions_js_1 = require("./instructions.js");
/**
 * Cache TTL for the user's workspace memberships (slug→id resolution).
 * Seeded from the boot `listWorkspaces()` call; refreshed on demand after it.
 */
const WORKSPACE_CACHE_TTL_MS = 60_000;
function createWorkspaceDirectory(client, options = {}) {
    // Seed from the boot directory — but NOT when the boot load failed, or we'd
    // cache a bogus empty list for the full TTL and mask the failure. Leaving it
    // null lets the first `workspace=` / no-default path retry the load.
    let workspaceListCache = options.directory && !options.directoryLoadFailed
        ? { workspaces: options.directory, loadedAt: Date.now() }
        : null;
    async function getWorkspaceList() {
        if (workspaceListCache &&
            Date.now() - workspaceListCache.loadedAt < WORKSPACE_CACHE_TTL_MS) {
            return workspaceListCache.workspaces;
        }
        const result = await client.listWorkspaces();
        workspaceListCache = {
            workspaces: result.workspaces,
            loadedAt: Date.now(),
        };
        return result.workspaces;
    }
    async function resolveWorkspaceRef(ref) {
        // Audit B11: a workspace slug shaped like a UUID (lowercase hex
        // with hyphens) is theoretically possible. Matching on id alone
        // would miss the slug, forcing a wasteful refresh on the second
        // pass. Cheap to try both id and slug on the first pass.
        let list = await getWorkspaceList();
        let match = list.find((w) => w.id === ref || w.slug === ref);
        if (match)
            return match;
        // Force-refresh once — covers the case where the user was added to
        // a new workspace mid-session and the cache hasn't ticked over.
        workspaceListCache = null;
        list = await getWorkspaceList();
        match = list.find((w) => w.id === ref || w.slug === ref);
        return match ?? null;
    }
    /**
     * The isError response for a no-`workspace=` call that has no session
     * default (M-3). Lists the caller's workspaces so the agent can retry
     * with an explicit `workspace=`; mirrors the backend WORKSPACE_REQUIRED
     * envelope in intent. Reads the boot-seeded directory (cached — no extra
     * loopback on the happy path).
     */
    async function noWorkspaceError() {
        let list;
        // Start from the boot-time load state; a fresh successful load below
        // supersedes it (the cache is left unseeded when boot failed, so this
        // actually retries rather than returning a stale empty list).
        let loadFailed = options.directoryLoadFailed ?? false;
        try {
            list = await getWorkspaceList();
            loadFailed = false;
        }
        catch {
            list = options.directory ?? [];
        }
        if (list.length === 0) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: loadFailed
                            ? "We couldn't load your workspace memberships just now — this looks like a transient backend issue, not that you have none. Retry in a moment, and reconnect if it persists."
                            : "You're not an active member of any workspace, so there's nothing to act on. Create one in the Dopl web app, then reconnect.",
                    },
                ],
            };
        }
        const lines = [
            `This connection has no default workspace because you belong to ${list.length} workspaces. Pass \`workspace=<slug_or_id>\` on this call — pick one:`,
            "",
            instructions_js_1.UNTRUSTED_DIRECTORY_NOTE,
            "",
        ];
        for (const w of list) {
            lines.push(`- ${(0, narration_js_1.inlineOr)(w.name, instructions_js_1.UNNAMED_WORKSPACE)} (slug: \`${w.slug}\`, role: ${w.role})`);
        }
        return {
            isError: true,
            content: [{ type: "text", text: lines.join("\n") }],
        };
    }
    return { getWorkspaceList, resolveWorkspaceRef, noWorkspaceError };
}
