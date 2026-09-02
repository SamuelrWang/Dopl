/**
 * `dopl_status` — **THE ORCHESTRATOR'S CHECK-IN, IN ONE CALL** (T20).
 *
 * Every channel the caller is a member of — across every workspace AND every
 * home-channel container — with its tenancy handle, its high-water seq, unread
 * past a caller-supplied cursor, the caller's own live sessions in it, and what
 * is addressed to the caller and unanswered.
 *
 * ── WHY IT IS A TOOL AND NOT A `dopl_channel` OP ───────────────────────────
 *
 * ⚠ **IT IS A META TOOL, AND THAT IS THE WHOLE REASON IT WORKS FOR THE CALLER IT
 * IS FOR.** The domain path (`registrar.ts › registerTool`) injects a
 * `workspace=` argument and REFUSES a no-arg call from a caller with 0 or 2+
 * standard memberships — which is exactly the orchestrator this answers for. A
 * `workspace=` on this tool could only ever be wrong, because the question spans
 * every workspace at once; that is `dopl_home`'s argument for the same
 * placement, reached from the other direction.
 *
 * ⚠ **CHARGED, like `dopl_home` and unlike the two orientation tools** (Samuel's
 * ruling Q2 (b) applied): `current_workspace` / `list_workspaces` are how a lost
 * agent finds out where it is and are metered nowhere; this reads
 * content-adjacent data — names, previews, telemetry — across the account, so it
 * pays like a domain tool. The charge is written explicitly in
 * `registrar.ts › registerMetaTool`, opt-in per tool.
 *
 * 🔒 **THE CONTAINER LOCK IS APPLIED, AND NOT HERE.** `tools/account-scope.ts`
 * is the seam, and it delegates to the one reader of the lock
 * (`home-scopes.ts › narrowToLock`). Calling `client.getAccountStatus()` from
 * this file would hand a locked session the ids and names of its operator's
 * other rooms — the enumeration oracle B3 exists to deny.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterMetaTool } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
export declare function registerStatusTool(registerMetaTool: RegisterMetaTool, client: DoplClient, directory: WorkspaceDirectory): void;
