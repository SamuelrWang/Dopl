/**
 * meta-tools.ts — `dopl_workspaces`, the orientation tool.
 *
 * ⚠ USER-scoped, not workspace-scoped: a membership lookup needs no workspace,
 * which is why it registers through `registerMetaTool` (no injected
 * `workspace=` arg) and reports the connection's container in its footer.
 * Everything else the domain path enforces — the gates, `strictInput` — applies
 * identically; see `registrar.ts`.
 *
 * ── ⚠ THREE TOOLS BECAME ONE (B13, 2026-09-02) ─────────────────────────────
 *
 * `list_workspaces`, `current_workspace` and `dopl_home` answered three
 * questions that had stopped being three: *which containers am I in*, *which
 * one does a no-arg call hit*, and *which of them are home channels*. B10
 * deletes the middle one — there is no default workspace to report, because
 * "home is the default; all workspaces are just normal workspaces" — and with
 * it the reason the third existed. A home-channel container was hidden from
 * `list_workspaces` only because a listing was an advertisement of things a
 * no-arg call might silently pick; nothing picks now, so a container is simply
 * one more container the caller is in, LISTED WITH ITS KIND.
 *
 * ⚠ **WHAT LEFT WITH THEM, AND IT IS A SURFACE DECISION, NOT A TIDY-UP.**
 * `current_workspace(op="set"|"clear")` — the session pin — is gone with the
 * default it pinned. `dopl_home(op="create_channel")` is gone too: minting a
 * room is now an app act, which is what its own INVITE half already was.
 * Reading a home channel is unaffected — its container id is on every row here,
 * and `dopl_status` still answers for the rooms inside it.
 */
import { type CallerIdentity } from "./tools/identity.js";
import type { RegisterMetaTool } from "./tools/respond.js";
import { type ActiveWorkspaceState, type WorkspaceDirectory } from "./workspace-directory.js";
export interface MetaToolDeps {
    directory: WorkspaceDirectory;
    /** The container this connection is bound to, or null. */
    activeWorkspace: ActiveWorkspaceState | null;
    caller: CallerIdentity;
}
export declare function registerWorkspaceMetaTools(registerMetaTool: RegisterMetaTool, { directory, activeWorkspace, caller }: MetaToolDeps): void;
