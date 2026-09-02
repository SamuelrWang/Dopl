/**
 * `dopl_channel` — THE TWO ACCOUNT-WIDE READS: `op="read"` with no `channel`
 * (T21) and `op="read_sessions"` with no `channel` (T22).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── WHAT "ACCOUNT-WIDE" MEANS HERE, AND HOW IT DIFFERS FROM `await` ────────
 *
 * ⚠ **THREE SCOPES EXIST ON THIS TOOL AND THEY ARE NOT THE SAME. Do not
 * "unify" them:**
 *   - `op="read"`  with a `channel`  → ONE room.
 *   - `op="await"` with no `channel` → ONE WORKSPACE (the one this call
 *     resolved). The hold re-proves a membership set per tick and that proof is
 *     workspace-scoped; widening it is a different change with a different
 *     fence.
 *   - `op="read"`  with no `channel` → THE WHOLE ACCOUNT, every workspace and
 *     every home-channel container. It can afford to, because a PAGE has no
 *     per-tick access invariant to preserve — it reads once, against a
 *     membership set proved once.
 *
 * ⚠ **THE SESSION READ MOVED WITH IT.** `op="read_sessions"` with no `channel`
 * used to mean "every session of mine in the ACTIVE WORKSPACE" and now means
 * "every session of mine, anywhere". That is a widening of a read that was
 * already own-scoped (`user_id` is the fence, server-side), and it is what makes
 * the op usable at all from a home channel — a container is never the active
 * workspace unless it was explicitly addressed. Every row still names its room.
 *
 * 🔒 **BOTH GO THROUGH `account-scope.ts`, WHICH APPLIES THE CONTAINER LOCK.**
 * The routes behind them are `withUserAuth` and answer for the whole account;
 * calling `client.getAccountStatus()` / `client.readAccountMessages()` from here
 * would hand a locked session its operator's other rooms.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory.js";
/**
 * `op="read"` WITH NO `channel` — new messages past one cursor, everywhere.
 *
 * ⚠ **ONE CURSOR IS LEGAL BECAUSE `seq` IS A TABLE-WIDE IDENTITY** — see
 * `src/features/channels/server/repository-account.ts ›
 * listAccountMessagesAfter`. That is a stronger fact than the workspace-wide
 * await's copy states, and it is the whole reason this op can exist.
 */
export declare function opReadAccount(client: DoplClient, directory: WorkspaceDirectory, since: number, limit: number | undefined, selfUserId?: string | null): Promise<ToolResponse>;
/**
 * `op="read_sessions"` WITH NO `channel` — every session of the caller's,
 * grouped by the room it is working in.
 *
 * ⚠ **IT REUSES THE PROJECTION RENDERER VERBATIM** (`formatSessionLine`,
 * `sessionLegend`, and both notes). A second session line would be a second
 * opinion about what "stale" means and about which fields a peer may read — see
 * `channel-session-render.ts`'s header.
 */
export declare function opReadSessionsAccount(client: DoplClient, directory: WorkspaceDirectory): Promise<ToolResponse>;
