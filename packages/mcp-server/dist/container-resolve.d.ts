/**
 * container-resolve.ts — 🔒 **HOW ONE TOOL CALL FINDS ITS CONTAINER** (R-32,
 * Samuel 2026-09-17). The registrar is the mechanism and `workspace-arg.ts` is
 * the policy table; this file is the DECISION, in one place, so the three
 * outcomes a call can have — addressed, unaddressed, refused — are enumerated
 * once rather than spelled out inside a wrapper that also charges credits and
 * appends a footer.
 *
 * ── THE ADDRESS GRAMMAR ────────────────────────────────────────────────────
 *
 *   container=home        → the CALLER's own personal container, per caller
 *   container=<slug>      → a workspace, or a home channel (its channel's slug;
 *                           one channel per link container, minted from the
 *                           same name — `home/server/service-writes.ts ›
 *                           createHomeChannel`)
 *   container=<id>        → any container the caller is an active member of
 *   workspace=<…>         → DEPRECATED alias, same resolver, one release
 *   (omitted)             → the connection's container, else `home`
 *
 * ⚠ **THE LAST LINE IS THE RULING'S POINT AND IT IS STRUCTURE, NOT COPY.** An
 * unaddressed READ resolves to the caller's own container because the SERVER
 * resolves it (B10), not because a prompt told an agent to pass something. An
 * unaddressed MINT is REFUSED — see `workspace-arg.ts ›
 * UNADDRESSED_WRITE_REFUSALS`.
 */
import type { ToolResponse } from "./tools/respond.js";
import type { ActiveWorkspaceState, EffectiveWorkspace, WorkspaceDirectory } from "./workspace-directory.js";
/** The two spellings, as the caller sent them. */
export interface AddressArgs {
    container?: string;
    /** ⚠ DEPRECATED — mapped to the same resolver for one release. */
    workspace?: string;
}
/**
 * ⚠ THREE OUTCOMES AND NO FOURTH. `addressed` carries the container the call
 * must run in; `unaddressed` leaves the connection's own in place; `refusal` is
 * a finished response and the caller returns it verbatim.
 */
export type AddressOutcome = {
    kind: "refusal";
    response: ToolResponse;
} | {
    kind: "addressed";
    effective: EffectiveWorkspace;
    note: string | null;
} | {
    kind: "unaddressed";
    note: string | null;
};
export interface AddressDeps {
    directory: WorkspaceDirectory;
    /** The container `X-Workspace-Id` bound this connection to, or null. */
    activeWorkspace: ActiveWorkspaceState | null;
}
/**
 * Resolve one call's container.
 *
 * ⚠ **`container=` WINS OVER `workspace=` AND BOTH DROPS ARE ANNOUNCED.** A
 * caller that sent two addresses, or sent one on an op that takes none, is told
 * which one the call used — the whole difference between a deprecation window
 * and a silent re-target (B13's argument, one argument later).
 */
export declare function resolveCallAddress(tool: string, op: string | undefined, args: AddressArgs, { directory, activeWorkspace }: AddressDeps): Promise<AddressOutcome>;
