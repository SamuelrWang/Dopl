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
import type { DoplClient, HomeChannel } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
/**
 * The caller's home channels, NARROWED to the container lock when one is armed.
 *
 * ⚠ THE NARROWING IS A FILTER ON `workspaceId`, matched against the SAME id
 * `getWorkspaceList` answers with — one lock, one identity, no second notion of
 * "which room am I in".
 */
export declare function listHomeChannels(client: DoplClient, directory: WorkspaceDirectory): Promise<HomeChannel[]>;
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
export declare function narrowToLock<T extends {
    workspaceId: string;
}>(rows: T[], directory: WorkspaceDirectory): T[];
/**
 * ONE SCOPE the `everywhere` fan-out searches.
 *
 * ⚠ `kind` IS RENDERED, NOT INFERRED BY THE READER. A container and a workspace
 * are different things to the operator — one is a home channel with a person in
 * it, the other is a tenancy — and a heading that called a container a
 * "workspace" would advertise it as one, which INVARIANTS §4A forbids everywhere
 * else on this surface.
 */
export interface SearchLeg {
    /** The workspace id every per-leg request runs against. */
    id: string;
    /** Neutralized display name — a VALUE, spliced into a heading we wrote. */
    label: string;
    kind: "workspace" | "home channel";
    /** Slug, for a standard workspace only — a container's is not advertised. */
    slug?: string;
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
export declare function searchLegs(client: DoplClient, directory: WorkspaceDirectory): Promise<{
    legs: SearchLeg[];
    homeReadFailed: boolean;
}>;
