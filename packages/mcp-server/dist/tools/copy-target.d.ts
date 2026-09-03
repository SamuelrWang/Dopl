/**
 * copy-target.ts — 🔒 **THE ONE PLACE `to_workspace` BECOMES A TENANCY**, shared
 * by `dopl_agent(op="copy")` and `dopl_kb(op="copy_base")` exactly as `shelf.ts`
 * is shared by their create paths. Both ops resolve, refuse and address a target
 * through here; a second resolver would be a second opinion about which room a
 * copy lands in.
 *
 * ── 🔒 WHY A COPY IS COMPOSED IN THE MCP LAYER AND NOT IN A SERVER SERVICE ──
 *
 * A server-side `copyBase(sourceWs, targetWs)` would be a NEW CROSS-TENANCY
 * AUTHZ PATH. `withWorkspaceAuth` resolves exactly ONE workspace, so such a
 * route would have to prove membership in the TARGET itself — a second statement
 * of a fence that already exists, and a re-statement is what F-336 and the
 * `service-shared.ts` mirror-list exist to warn about.
 *
 * **So a copy is what `search-everywhere.ts` is: N ORDINARY, ALREADY-FENCED
 * CALLS**, each inside its own `workspaceContext.run(<id>, …)`. Leg 1 reads the
 * source, fenced by `withWorkspaceAuth` in the SOURCE workspace; leg 2 creates,
 * fenced the same way in the TARGET. Layer A, B1, `canSeeBase` / `canSeeTemplate`
 * and the guest floors all apply per leg with NO re-statement. **That is why
 * this ticket ships no migration and no route** — there is nothing new to fence.
 *
 * ⚠ AND THERE IS NO RESOLUTION FALLBACK. {@link resolveCopyTarget} answers
 * through `workspace-directory.ts › resolveWorkspaceRef` and nothing else — the
 * one resolver that accepts a home-channel CONTAINER id (§4A: it deliberately
 * does not filter) and that answers `null` under the CONTAINER LOCK for anything
 * but the locked container. An unresolvable ref REFUSES and creates nothing.
 */
import type { WorkspaceListItem } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond.js";
/**
 * The `to_workspace` arg's schema description, worded ONCE for both tools.
 *
 * ⚠ It names the CONTAINER form explicitly, because a home channel is the one
 * target an agent can discover from `dopl_workspaces`, which since B10 lists
 * containers beside workspaces — the tool
 * that publishes their ids.
 */
export declare const TO_WORKSPACE_ARG_DESCRIPTION = "Where the COPY is created: a workspace slug or UUID, or a home-channel CONTAINER id from dopl_workspaces. Required for the copy ops, and the SOURCE must be one you created. It must be somewhere you are a member \u2014 an id that does not resolve for you refuses and creates nothing, and there is no fallback to the current workspace. The copy always lands PRIVATE to you, and it is a STRANGER to the original: editing one never touches the other.";
/**
 * 🔒 **R2 — A COPY IS OF SOMETHING THE OPERATOR OWNS, NOT OF ANYTHING THEY CAN
 * READ** (Desktop Agent default 2026-09-02; Samuel may loosen).
 *
 * Both ops resolved their source through the ordinary READ resolvers, so until
 * this fence they would copy any template or base the caller could SEE — a
 * teammate's `workspace`-visible template, a shared base — into a container that
 * teammate may not be in, landing it `private` to the copier. That is not what
 * the spec says the op is (INVARIANTS §10: *"An operator's OWN template or
 * knowledge base"*), and it is the one direction a copy can widen an audience.
 *
 * ⚠ **AND IT FAILS CLOSED ON AN UNKNOWN.** `createdBy` is nullable (rows older
 * than the column) and `CallerIdentity.userId` is nullable (auth did not
 * resolve). Neither is evidence of ownership, so neither passes — an unprovable
 * owner refuses and creates nothing, which is recoverable, where a wrong guess
 * is a copy nobody can delete from this surface (§10).
 *
 * ⚠ It is a NARROWING of a read that was already fenced, never a new authz path:
 * the source read still answers only what the caller may see, and this drops
 * rows from inside that answer.
 */
export declare function notOwnedRefusal(createdBy: string | null | undefined, selfUserId: string | null, noun: string, ref: string): ToolResponse | null;
/** Narrow the `resolve → row | refusal` union the copy ops branch on. */
export declare function isCopyRefusal(x: WorkspaceListItem | ToolResponse): x is ToolResponse;
/**
 * 🔒 `to_workspace` → the tenancy leg 2 runs in, or the refusal to return
 * verbatim.
 *
 * ⚠ ONE RESOLVER, AND IT IS THE SESSION'S OWN. `resolveWorkspaceRef` already
 * carries both properties this op needs and neither is restated here: it matches
 * a CONTAINER id (which no listing advertises) and it answers `null` for every
 * ref but the locked one under a container lock. A local id-shaped guess, a
 * name match, or a fall back to the calling workspace would each defeat one of
 * those.
 *
 * ⚠ THE REFUSAL IS UNIFORM, so "no such workspace" and "not yours to write into"
 * — including "your session is locked to one container" — stay ONE answer. A
 * sentence that distinguished them is an existence oracle over the operator's
 * other rooms, which is the whole point of B3.
 */
export declare function resolveCopyTarget(directory: WorkspaceDirectory, ref: string): Promise<WorkspaceListItem | ToolResponse>;
/**
 * ⚠ A COPY ONTO ITSELF IS REFUSED, NOT SILENTLY DUPLICATED. The source row's own
 * `workspaceId` is the authority for "where the call already is" — the server
 * resolved it, so this needs no second notion of the active workspace and works
 * on both registrar paths (per-call `workspace=` and the session default).
 *
 * Returns the refusal, or null to proceed.
 */
export declare function sameWorkspaceRefusal(target: WorkspaceListItem, sourceWorkspaceId: string, 
/** Short noun phrase for the thing being copied, e.g. "agent template". */
subject: string, 
/** The op that creates a fresh one here, named as the alternative. */
createOp: string): ToolResponse | null;
/**
 * The `workspace=` handle a follow-up call addresses the copy with.
 *
 * ⚠ SLUG FOR A WORKSPACE, ID FOR A CONTAINER — the same split
 * `workspace-directory.ts › SearchLeg` renders. §4A keeps a container's slug off every
 * agent-facing surface; its id is what `dopl_workspaces` publishes and what
 * `resolveWorkspaceRef` takes.
 */
export declare function workspaceHandle(ws: WorkspaceListItem): string;
/**
 * A target rendered for narration. ⚠ The NAME is a VALUE spliced into a line we
 * wrote, and it is member-typed; the kind is stated because a container is a
 * HOME CHANNEL to the operator and never a workspace (§4A).
 */
export declare function workspaceLabel(ws: WorkspaceListItem): string;
