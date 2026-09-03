"use strict";
/**
 * workspace-directory.ts — the session's view of WHICH containers exist and
 * which one a call lands in: membership caching, slug→id resolution, the
 * container lock, and the search fan-out's leg list.
 *
 * ⚠ **THERE IS NO DEFAULT WORKSPACE HERE ANY MORE** (B10/B13). It held the
 * "you belong to N workspaces, name one" refusal and the sole-membership
 * auto-target; both are gone, and the server resolves the caller's own
 * container when a call names none. A blank `workspace=` is still rejected by
 * the caller in `registrar.ts` — fail-closed on an argument that was PASSED is
 * a different question from guessing one that was not.
 *
 * ⚠ A FAILED boot directory load does not seed the cache, so the first
 * resolution retries instead of serving a bogus empty list for a full TTL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkspaceDirectory = createWorkspaceDirectory;
exports.containerKind = containerKind;
exports.narrowToLock = narrowToLock;
exports.searchLegs = searchLegs;
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
    const lockedTo = options.lockedTo ?? null;
    async function getWorkspaceList() {
        // 🔒 THE LOCK SHORT-CIRCUITS BEFORE THE CACHE IS EVEN READ. A locked session
        // sees its container and nothing else — including no evidence that anything
        // else exists.
        if (lockedTo)
            return [lockedTo];
        return getAllWorkspaces();
    }
    async function resolveWorkspaceRef(ref) {
        // 🔒 THE LOCK ANSWERS BEFORE ANY LOOKUP, so a ref that names another
        // workspace is refused without a cache refresh — and a refused ref is
        // indistinguishable from one that names nothing, which is the same
        // no-oracle discipline the server's own 404 ordering keeps (§4).
        if (lockedTo) {
            return ref === lockedTo.id || ref === lockedTo.slug ? lockedTo : null;
        }
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
    return {
        getWorkspaceList,
        resolveWorkspaceRef,
        lockedWorkspaceId: () => lockedTo?.id ?? null,
    };
}
function containerKind(row) {
    switch (row.kind ?? "standard") {
        case "link":
            return "home channel";
        case "personal":
            return "personal";
        default:
            return "workspace";
    }
}
/**
 * 🔒 THE LOCK, APPLIED — and the ONLY reader of
 * {@link WorkspaceDirectory.lockedWorkspaceId} outside this module.
 *
 * ⚠ **GENERIC OVER ANYTHING CARRYING A `workspaceId`, ON PURPOSE.** The
 * account-wide channel reads (T20/T21/T22) need exactly this narrowing over a
 * different row: `GET /api/channels/account/**` is `withUserAuth` and answers
 * the WHOLE ACCOUNT, so the route cannot narrow and the directory those rows
 * never pass through cannot either. The alternative was a second reader of the
 * lock, and a second reader IS the enumeration oracle B3 exists to deny.
 * **Widening the parameter is how a second caller routes THROUGH this instead
 * of around it.**
 *
 * ⚠ It narrows on the SAME id `getWorkspaceList` answers with — one lock, one
 * identity, no second notion of "which room am I in". Unlocked ⇒ unchanged.
 *
 * ⚠ AND IT IS A TRIPWIRE, NOT A FENCE. Bash can open a second unpinned MCP
 * connection, or issue the loopback HTTP directly, and neither passes through
 * this module. What refuses cross-container reads is the container-locked
 * credential and the audience ceiling in
 * `src/features/knowledge/server/service-audience.ts`.
 */
function narrowToLock(rows, directory) {
    const locked = directory.lockedWorkspaceId();
    if (!locked)
        return rows;
    return rows.filter((r) => r.workspaceId === locked);
}
/**
 * THE LEG LIST: every container the caller is in.
 *
 * 🔒 **ONE NARROWED SOURCE, AND SINCE B10 IT IS THE ONLY ONE.** It used to be
 * two — the standard-workspace directory plus a second `GET /api/home/channels`
 * read, de-duped by id, with its own failure mode and its own "your home
 * channels could not be read" footnote. `getWorkspaceList()` answers for both
 * halves now that containers are no longer filtered out of it, so a locked
 * session searches exactly one scope, nothing can be searched twice, and there
 * is no second read to fail.
 */
async function searchLegs(directory) {
    return (await directory.getWorkspaceList()).map((w) => {
        const kind = containerKind(w);
        return {
            id: w.id,
            label: w.name,
            kind,
            ...(kind === "workspace" ? { slug: w.slug } : {}),
        };
    });
}
