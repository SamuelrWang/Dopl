"use strict";
/**
 * home-scopes.ts — 🔒 **THE ONE PLACE A HOME-CHANNEL LIST IS NARROWED TO THE
 * CONTAINER LOCK, AND THE ONE PLACE THE SEARCH FAN-OUT'S LEG LIST IS DERIVED.**
 *
 * Two tools need the caller's home channels: `dopl_home(op="list_channels")` and
 * `dopl_search(scope="everywhere")`. Both must obey B3 — a session pinned to a
 * SHARED `kind='link'` container sees that container ALONE, and learns nothing
 * about the existence of anything else. `GET /api/home/channels` is
 * `withUserAuth` and answers the whole account, so the narrowing cannot live
 * there; and `workspace-directory.ts` narrows the WORKSPACE directory, which
 * these rows never pass through.
 *
 * ⚠ SO IT LIVES HERE, ONCE. A second reader that calls `client.getHomeChannels()`
 * directly has built the enumeration oracle B3 exists to deny — it would hand a
 * locked session the ids of its operator's OTHER containers, which is precisely
 * what the lock is for. `container-lock.test.ts` pins it.
 *
 * ⚠ AND IT IS A TRIPWIRE, NOT A FENCE, like every other B3 surface. Bash can
 * open a second unpinned MCP connection, or issue the loopback HTTP directly,
 * and neither passes through this module. What actually refuses cross-container
 * reads is the container-locked credential (B1) and the audience ceiling in
 * `src/features/knowledge/server/service-audience.ts`. Do not let a green test
 * here read as containment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listHomeChannels = listHomeChannels;
exports.narrowToLock = narrowToLock;
exports.searchLegs = searchLegs;
const client_1 = require("@dopl/client");
/**
 * The caller's home channels, NARROWED to the container lock when one is armed.
 *
 * ⚠ THE NARROWING IS A FILTER ON `workspaceId`, matched against the SAME id
 * `getWorkspaceList` answers with — one lock, one identity, no second notion of
 * "which room am I in".
 */
async function listHomeChannels(client, directory) {
    const payload = await client.getHomeChannels();
    // ⚠ `?? []` — the wire type is non-optional and an older server is not, and a
    // `.filter` on undefined throws where an empty list merely says "none".
    return narrowToLock(payload.channels ?? [], directory);
}
/**
 * 🔒 THE LOCK, APPLIED — and it is the ONLY reader of
 * `WorkspaceDirectory.lockedWorkspaceId()` outside `workspace-directory.ts`
 * itself.
 *
 * ⚠ **GENERIC OVER ANYTHING CARRYING A `workspaceId`, ON PURPOSE (2026-09-01).**
 * It was `HomeChannel[]`, and the account-wide channel reads (T20/T21/T22) need
 * exactly the same narrowing over a different row: `GET
 * /api/channels/account/**` is `withUserAuth` and answers the WHOLE ACCOUNT, so
 * — like `/api/home/channels` — the route cannot narrow and the workspace
 * directory these rows never pass through cannot either. The alternative was a
 * second reader of the lock, and the rule this module's header states is that a
 * second reader IS the enumeration oracle B3 exists to deny. **Widening the
 * parameter is how a second caller routes THROUGH this instead of around it.**
 *
 * ⚠ It narrows on the SAME id `getWorkspaceList` answers with — one lock, one
 * identity, no second notion of "which room am I in". Unlocked ⇒ unchanged.
 */
function narrowToLock(rows, directory) {
    const locked = directory.lockedWorkspaceId();
    if (!locked)
        return rows;
    return rows.filter((r) => r.workspaceId === locked);
}
/**
 * THE LEG LIST: the caller's standard workspaces, then their home channels.
 *
 * 🔒 **BOTH HALVES COME FROM THE SAME NARROWED SOURCE.** `getWorkspaceList()` is
 * `lockedTo`-narrowed and `isStandardWorkspace`-filtered by construction, and
 * the home half goes through {@link listHomeChannels}. A locked session
 * therefore searches exactly one scope and learns nothing about the others —
 * which is the property §8's rule 2 of the plan demands and the reason this is
 * one function rather than two lists a caller unions by hand.
 *
 * ⚠ DE-DUPED ON ID. A locked session's `getWorkspaceList()` answers
 * `[container]` — the very container the home list also names — and a scope
 * searched twice would charge twice and render two headings for one room.
 *
 * ⚠ A FAILED HOME READ DEGRADES TO THE WORKSPACE LEGS, never to an error: the
 * fan-out's whole promise is that one unreadable scope does not fail the search.
 * The caller NAMES the loss (`partialRead`), it is not swallowed here.
 */
async function searchLegs(client, directory) {
    const workspaces = await directory.getWorkspaceList();
    const legs = workspaces.map((w) => ({
        id: w.id,
        label: w.name,
        // ⚠ A locked session's list is `[container]`, so this is not always
        // "workspace" even here — ask the predicate rather than assuming the source.
        kind: (0, client_1.isStandardWorkspace)(w) ? "workspace" : "home channel",
        ...((0, client_1.isStandardWorkspace)(w) ? { slug: w.slug } : {}),
    }));
    const seen = new Set(legs.map((l) => l.id));
    let homeReadFailed = false;
    try {
        for (const channel of await listHomeChannels(client, directory)) {
            if (seen.has(channel.workspaceId))
                continue;
            seen.add(channel.workspaceId);
            legs.push({
                id: channel.workspaceId,
                label: channel.name,
                kind: "home channel",
            });
        }
    }
    catch {
        homeReadFailed = true;
    }
    return { legs, homeReadFailed };
}
