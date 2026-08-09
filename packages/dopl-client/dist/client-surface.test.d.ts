/**
 * THE GUARD ON THE §2 PER-DOMAIN SPLIT.
 *
 * `client.ts` was one 720-line class; it is now a terminal link on a chain of
 * `client-<domain>.ts` method groups (see `client-base.ts`). That refactor is
 * only correct if NOTHING about `DoplClient` changed for a caller — and the
 * package's other three test files never touched most of the surface, so a
 * method silently lost in the move, or a route that drifted when its body left
 * the class, would have gone green.
 *
 * Two checks, for the two ways the split could lie:
 *
 *  1. THE SURFACE. `PUBLIC_SURFACE` is the frozen method list — the exact
 *     public API that `@dopl/mcp-server` and the app compile against. (Read
 *     off the declaration emit, minus the trash-teardown methods that left the
 *     class in a separate change; see the note on the constant itself, which
 *     is where the seven-method gap against HEAD is accounted for.) Checked in
 *     BOTH directions: every frozen name still resolves to a function on an
 *     instance, and the prototype chain exposes nothing that is not on the
 *     list. Adding a method to a link means adding it here, deliberately.
 *
 *  2. THE ROUTES THAT MOVED. Only the cluster / workflow / workspace bodies
 *     actually relocated (into `clusters.ts`, `workflows.ts`, `workspaces.ts`);
 *     every other domain already delegated to a module this refactor never
 *     touched. Those are the ones whose path, verb, and tool header are pinned
 *     here — including the `encodeURIComponent` on every interpolated segment,
 *     which is the detail a move is most likely to drop.
 */
export {};
