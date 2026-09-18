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
exports.HOME_ADDRESS = void 0;
exports.isAmbiguousContainer = isAmbiguousContainer;
exports.createWorkspaceDirectory = createWorkspaceDirectory;
exports.containerKindLabel = containerKindLabel;
exports.containerKind = containerKind;
exports.narrowToLock = narrowToLock;
exports.searchLegs = searchLegs;
/**
 * 🔒 **THE RESERVED CONTAINER ADDRESS** (R-32, Samuel 2026-09-17). `home` is the
 * CALLER'S own `kind='personal'` container, resolved per caller — so the same
 * six characters name a different row for every agent that types them, and no
 * agent ever has to be handed an id to reach its own shelf.
 *
 * ⚠ **IT IS A RESERVED WORD AND IT WINS OVER A SLUG.** A standard workspace
 * whose slug is literally `home` is reachable by its id, which is the tradeoff
 * a reserved word always makes; the reverse — a caller's own shelf being
 * shadowed by somebody's workspace name — is the one that cannot be worked
 * around, because the personal container's slug is not published anywhere.
 */
exports.HOME_ADDRESS = "home";
/** ⚠ The one narrowing. A `ContainerRefResolution` carries no `id`, so the
 *  compiler — not a convention — is what stops a caller reading the refusal as
 *  a container. */
function isAmbiguousContainer(resolved) {
    return "ambiguous" in resolved;
}
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
    /**
     * EVERY visible row a ref names. ⚠ **ONE MATCHER, TWO READINGS** (F-719):
     * `resolveWorkspaceRef` takes the head — first-wins is its published
     * contract, and `grant.ts` leans on it — while `resolveContainerRef` reads
     * the whole list and refuses a tie. A second copy of the lock + refresh
     * ordering is how the two drift apart.
     */
    async function matchContainerRefs(ref) {
        // 🔒 THE LOCK ANSWERS BEFORE ANY LOOKUP, so a ref that names another
        // workspace is refused without a cache refresh — and a refused ref is
        // indistinguishable from one that names nothing, which is the same
        // no-oracle discipline the server's own 404 ordering keeps (§4).
        if (lockedTo) {
            return ref === lockedTo.id || ref === lockedTo.slug ? [lockedTo] : [];
        }
        // ⚠ A workspace slug can be shaped like a UUID, so match id AND slug on the
        // first pass — id alone forces a wasteful refresh.
        const list = await getAllWorkspaces();
        const matches = list.filter((w) => w.id === ref || w.slug === ref);
        if (matches.length > 0)
            return matches;
        // Force-refresh once — covers a mid-session membership add.
        workspaceListCache = null;
        return (await getAllWorkspaces()).filter((w) => w.id === ref || w.slug === ref);
    }
    async function resolveWorkspaceRef(ref) {
        return (await matchContainerRefs(ref))[0] ?? null;
    }
    /**
     * ⚠ **THE PERSONAL CONTAINER IS SELECTED OFF THE LISTABLE SET, so the lock
     * narrows it for free**: a locked session sees `[lockedTo]` and finds a
     * personal container there only if that is what it is locked to.
     */
    async function homeContainer() {
        const list = await getWorkspaceList();
        return list.find((w) => containerKind(w) === "personal") ?? null;
    }
    async function resolveContainerRef(ref) {
        // ⚠ THE RESERVED WORD IS TESTED FIRST AND CASE-INSENSITIVELY. An agent that
        // types `Home` means its home space; a slug is lower-case by construction
        // (`slugifyWorkspaceName`), so nothing legitimate is shadowed by the fold.
        if (ref.trim().toLowerCase() === exports.HOME_ADDRESS)
            return homeContainer();
        const matches = await matchContainerRefs(ref);
        // ⚠ **AN ID ANSWERS BEFORE ANY SLUG QUESTION** — it is unique account-wide,
        // so it cannot tie, and it is the remedy the refusal below hands back.
        const byId = matches.find((w) => w.id === ref);
        if (byId)
            return byId;
        if (matches.length === 0)
            return null;
        if (matches.length === 1)
            return matches[0];
        // 🔒 F-719 — REFUSE AND NAME BOTH; never pick.
        return { ambiguous: [...matches].sort((a, b) => a.id.localeCompare(b.id)) };
    }
    async function containerKindIndex() {
        const list = await getWorkspaceList();
        return new Map(list.map((w) => [w.id, containerKind(w)]));
    }
    return {
        getWorkspaceList,
        resolveWorkspaceRef,
        resolveContainerRef,
        homeContainer,
        containerKindIndex,
        lockedWorkspaceId: () => lockedTo?.id ?? null,
    };
}
/**
 * 🔒 **WHAT KIND OF CONTAINER THIS ROW IS, ASKED POSITIVELY AND IN ONE PLACE**
 * (F-564).
 *
 * ⚠ **IT IS A `switch` ON `kind`, NOT `!isStandardWorkspace(…)`.** That
 * predicate answers "does this belong in the rail"; its NEGATION was read as
 * "therefore a home channel" at four sites in this package, which was correct
 * by accident while `standard` and `link` were the only kinds and stops being
 * correct the moment `20260920120000` mints a `personal` container for every
 * user at once. A `default` arm that says "workspace" also fails safe for a
 * kind added later: an unknown container is not silently advertised as somebody
 * else's room.
 *
 * ⚠ **RENDERED, NEVER INFERRED BY THE READER.** A container and a workspace are
 * different things to the operator, and every surface that lists these rows
 * prints this label — which is what lets `getWorkspaceList()` stop hiding
 * containers (B10) without ever calling one a workspace.
 */
/**
 * How a kind is RENDERED in a directory row. The personal container is the one
 * an agent keeps mistaking for a workspace (Samuel, 2026-09-06: "Samuel's
 * Workspace" read as the home space, and the home space read as a workspace),
 * so its label says what it serves as, in words that cannot be read as a
 * second workspace: it is the caller's default, and it is not a workspace.
 *
 * ⚠ **THE VALUE AND THE LABEL SPLIT ON 2026-09-17 (R-32) AND THEY MUST STAY
 * SPLIT.** `kind` is now a typed wire value an agent may COMPARE
 * (`@dopl/contracts › ContainerKind`), so it carries no space and no
 * parenthetical; this table is the only place those words are written. A
 * `Record` keyed by the union, so the compiler proves it total — a fourth kind
 * is a build error here rather than a row that renders its own value at a
 * reader.
 */
const CONTAINER_KIND_LABELS = {
    personal: "home space (your default; a personal container, not a workspace)",
    home_channel: "home channel",
    workspace: "workspace",
};
function containerKindLabel(kind) {
    return CONTAINER_KIND_LABELS[kind];
}
/**
 * ⚠ **THE ONE MAPPING FROM THE COLUMN TO THE WIRE**, and `scripts/
 * check-role-drift.ts › checkContainerKind` holds it against the `workspaces.
 * kind` `CHECK` in both directions.
 */
function containerKind(row) {
    switch (row.kind ?? "standard") {
        case "link":
            return "home_channel";
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
