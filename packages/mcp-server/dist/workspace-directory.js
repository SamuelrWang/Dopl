"use strict";
/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in: membership caching, slug→id resolution, and the
 * "you must pass `workspace=`" refusal.
 *
 * ⚠ FAIL-CLOSED throughout. A blank `workspace=` is rejected by the caller in
 * `registrar.ts`; 0 or 2+ memberships with no pin gets
 * {@link WorkspaceDirectory.noWorkspaceError}, never a guessed workspace; and a
 * FAILED boot directory load does not seed the cache, so the first resolution
 * retries instead of serving a bogus empty list for a full TTL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkspaceDirectory = createWorkspaceDirectory;
const client_1 = require("@dopl/client");
const narration_js_1 = require("./tools/narration.js");
const instructions_js_1 = require("./instructions.js");
/** Membership cache TTL (slug→id). Seeded at boot, refreshed on demand. */
const WORKSPACE_CACHE_TTL_MS = 60_000;
function createWorkspaceDirectory(client, options = {}) {
    // ⚠ Seed from the boot directory, but NOT when the boot load FAILED — that
    // caches a bogus empty list for a full TTL and masks the failure. Null lets
    // the first `workspace=` / no-default path retry.
    let workspaceListCache = options.directory && !options.directoryLoadFailed
        ? { workspaces: options.directory, loadedAt: Date.now() }
        : null;
    /** The cache, kind and all. ⚠ RESOLUTION reads this; LISTING never does. */
    async function getAllWorkspaces() {
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
    async function getWorkspaceList() {
        return (await getAllWorkspaces()).filter(client_1.isStandardWorkspace);
    }
    async function resolveWorkspaceRef(ref) {
        // ⚠ Resolves against the UNFILTERED directory: `workspace=<link id>` is how
        // an agent acting in a home channel addresses its container, and the
        // container is deliberately absent from every listing.
        // ⚠ A workspace slug can be shaped like a UUID, so match id AND slug on the
        // first pass — id alone forces a wasteful refresh.
        let list = await getAllWorkspaces();
        let match = list.find((w) => w.id === ref || w.slug === ref);
        if (match)
            return match;
        // Force-refresh once — covers a mid-session membership add.
        workspaceListCache = null;
        list = await getAllWorkspaces();
        match = list.find((w) => w.id === ref || w.slug === ref);
        return match ?? null;
    }
    /**
     * isError for a no-`workspace=` call with no session default. Lists the
     * caller's workspaces so the agent can retry explicitly; mirrors the backend
     * WORKSPACE_REQUIRED envelope. Reads the boot-seeded cache — no extra
     * loopback on the happy path.
     */
    async function noWorkspaceError() {
        let list;
        // Start from the boot-time load state; a fresh successful load supersedes
        // it (an unseeded cache after a failed boot means this really retries).
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
