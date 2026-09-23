/**
 * The session grid shared by `op="status"` and the sessions block on a hold (`op="read"` with
 * `wait_ms`). State predicates come from `channel-session-render.ts`, so stale, model label and age
 * have one definition. The `channel-` filename prefix is load-bearing for the parity scans.
 */
import type { ChannelSessionState, ChannelSessionStateOwn } from "@dopl/client";
import { type SessionRenderOpts } from "./channel-session-render";
/**
 * Header + alignment row for {@link sessionRow}; column order is the row's. `name` (what a person
 * calls it) and `handle` (what a caller addresses) are separate columns (F-708).
 */
export declare const SESSION_TABLE_HEAD: readonly string[];
/** One session as a row; shared by every surface (`channel-session-liveness.test.ts` pins them equal). */
export declare function sessionRow(s: ChannelSessionState | ChannelSessionStateOwn, opts?: SessionRenderOpts): string;
/**
 * The caller's own agents, appended under a hold's messages (never interleaved with them).
 * `undefined` (not reported) renders nothing; `[]` renders one line, since that is what a crashed
 * or signed-out desktop looks like.
 */
export declare function sessionBlockLines(sessions: readonly ChannelSessionStateOwn[] | undefined, now?: number, operatorOnline?: boolean): string[];
