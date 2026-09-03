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
 * default it pinned.
 *
 * ⚠ **`create_home_channel` CAME BACK AT THE INTEGRATION (F-621).** B13 retired
 * `dopl_home(op="create_channel")` with its tool and named no successor, which
 * is a wire-visible deletion of a capability rather than a rename — so the op
 * moved here instead. Minting a room and INVITING somebody into one are not the
 * same act: the invite half has been `sessionOnly` since the tool shipped, and
 * a room an agent can make but not populate is a finished state, not a
 * half-built one. Reading a home channel was never affected — its container id
 * is on every row here, and `dopl_status` answers for the rooms inside it.
 *
 * 🔒 **`op` IS OPTIONAL AND ITS DEFAULT MUST STAY THE READ.**
 * `gating.ts › opRefusal` returns `null` for an ABSENT op — an op-less tool has
 * nothing to gate — so a default that wrote would be a write no scope gate ever
 * sees. The default is `list`, and this tool is the one an agent that has lost
 * its bearings calls with `{}`.
 */
import { type CallerIdentity } from "./tools/identity.js";
import { type RegisterMetaTool } from "./tools/respond.js";
import type { DoplClient } from "@dopl/client";
import { type ActiveWorkspaceState, type WorkspaceDirectory } from "./workspace-directory.js";
export interface MetaToolDeps {
    directory: WorkspaceDirectory;
    /** The container this connection is bound to, or null. */
    activeWorkspace: ActiveWorkspaceState | null;
    caller: CallerIdentity;
    /** ⚠ The WRITE half only. The list is the directory's, which is already
     *  `lockedTo`-narrowed; this client mints. */
    client: DoplClient;
}
export declare function registerWorkspaceMetaTools(registerMetaTool: RegisterMetaTool, { directory, activeWorkspace, caller, client }: MetaToolDeps): void;
