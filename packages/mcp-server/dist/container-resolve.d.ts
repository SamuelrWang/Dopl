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
 *   (omitted)             → the connection's container, else `home`
 *
 * ⚠ **`workspace=` IS GONE (2026-09-18)** — one release as a bare alias, then
 * deleted from the schema, so it is now a `-32602` that NAMES the field rather
 * than a second spelling this file has to keep mapping.
 *
 * ⚠ **THE LAST LINE IS THE RULING'S POINT AND IT IS STRUCTURE, NOT COPY.** An
 * unaddressed READ resolves to the caller's own container because the SERVER
 * resolves it (B10), not because a prompt told an agent to pass something. An
 * unaddressed MINT is REFUSED — see `workspace-arg.ts ›
 * UNADDRESSED_WRITE_REFUSALS`.
 */
import type { ToolResponse } from "./tools/respond.js";
import type { ActiveWorkspaceState, EffectiveWorkspace, WorkspaceDirectory } from "./workspace-directory.js";
import type { WorkspaceListItem } from "@dopl/client";
/** The address the caller sent, if any. ⚠ ONE KEY since the alias retired. */
export interface AddressArgs {
    container?: string;
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
 * ⚠ **A DROP IS ANNOUNCED.** A caller that addressed an op which takes no
 * address is told the argument was ignored — the whole difference between a
 * deprecation window and a silent re-target (B13's argument, one argument
 * later). The alias half of that announcement retired with the alias.
 */
export declare function resolveCallAddress(tool: string, op: string | undefined, args: AddressArgs, { directory, activeWorkspace }: AddressDeps): Promise<AddressOutcome>;
/**
 * THE AMBIGUITY REFUSAL — **it lists, and it does not pick** (F-719).
 *
 * ⚠ **IT IS `knowledge-shared.ts › ambiguousBase`'s CONTRACT, ONE TABLE OVER, AND
 * DELIBERATELY NOT A SECOND IDIOM**: the same `reason=ambiguous_slug` literal, the
 * same opening, the same one-line-per-candidate list keyed by the ID to re-issue
 * with — so an agent that learned the remedy from `dopl_kb` applies it unchanged.
 *
 * ⚠ **THE LIST IS THE WHOLE VALUE.** "That slug is ambiguous" alone sends the caller
 * to `dopl_workspaces` for ids it was already holding; each row carries the id and
 * the KIND, which is what says "one of these is a room somebody else named".
 * ⚠ **AND IT IS NOT AN ORACLE** — every row came back from this caller's own
 * lock-narrowed directory, so it discloses exactly what `dopl_workspaces` would.
 *
 * ⚠ **EXPORTED FOR `tools/grant.ts` SINCE 2026-09-17** — `argName` is what makes
 * it reusable: a grant re-issues with `to=<id>`, not `container=<id>`.
 */
export declare function ambiguousContainer(argName: string, ref: string, matches: WorkspaceListItem[]): string;
