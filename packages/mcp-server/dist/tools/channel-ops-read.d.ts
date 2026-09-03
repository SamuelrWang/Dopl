/**
 * `dopl_channel` READ op handlers: list, read, list_threads, members. All
 * non-mutating, all ONE round-trip rendered — except a THREAD-SCOPED `read`,
 * which is two. The HOLD lives in `channel-ops-hold.ts` (the only looping shape).
 *
 * ⚠ **`op="get_thread"` WAS FOLDED INTO `read(thread=)` ON 2026-09-02 (C15).**
 * Two ops answered one noun — "what is this exchange" — and the split cost 200
 * characters of published prose explaining that the first returned no bodies.
 * A thread-scoped read now carries the METADATA HEADER that op rendered, above
 * the transcript it always rendered, so the fold deleted an op and no answer.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread` — the `thread`
 * op param resolves against `channel_tasks` rows and `/tasks` routes under
 * `@dopl/client`.
 *
 * Every STRING these ops emit lives in `channel-render.ts`, where the
 * peer-authored-text discipline is documented and enforced. This file is
 * control flow.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type ResponseFormat } from "./response-size";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opRead(client: DoplClient, ref: string, since?: number, limit?: number, selfUserId?: string | null, thread?: string, format?: ResponseFormat): Promise<ToolResponse>;
/**
 * READ-SESSION-STATE — the caller's OWN live sessions: handle, reduced state
 * (working / idle / ended — desktop `session-summary.js` vocabulary;
 * deliberately no "thinking", which needs streaming and streaming is off), and
 * thread. `ref` narrows to one channel; omitted = all in active workspace.
 *
 * ⚠ OWN-SCOPED is the whole security model: server read keys on the caller's
 * user id, RLS backs it, a peer's sessions never come back. Channel names and
 * thread titles are still counterparty-influenced, so they go through the same
 * inline-neutralizer under listing framing.
 *
 * Writer is `main/session-state-push.js` → `POST /api/channels/sessions`, fired
 * when the pill projection's digest moves (NOT a heartbeat).
 *
 * ⚠ The empty answer means "no live sessions being reported", never "you have
 * no sessions" — an asleep, signed-out, or older-build machine reports nothing.
 *
 * ⚠ AND THE SAME CAVEAT NOW APPLIES ROW BY ROW (2026-08-22). A row is a REPORT,
 * not an observation: nothing on the server watches the machine, so a desktop
 * that CRASHED leaves its last push standing and this op read it back as a live
 * `working` forever. `channel-session-render.ts` hedges any row quiet longer
 * than `SESSION_STALE_WINDOW_MS` into "last reported <state>" and the legend
 * says what that means. The stamp is NOT a heartbeat, so the hedge is a hedge
 * and never a claim the agent stopped.
 *
 * ⚠ THE TELEMETRY IS OPERATOR-ONLY, and this op is entitled to it because the
 * server read is own-scoped — `GET /api/channels/sessions` maps through
 * `collab-dto.ts › mapOwnSessionStateRow`. A peer's session reaches no surface
 * in this file.
 */
export declare function opReadSessions(client: DoplClient, ref?: string, format?: ResponseFormat): Promise<ToolResponse>;
export declare function opListThreads(client: DoplClient, ref: string, selfUserId?: string | null): Promise<ToolResponse>;
/**
 * The channel ROSTER. Read-only; the private per-member preference (agent tool
 * profile) is scrubbed server-side for everyone but the caller and not rendered.
 *
 * ⚠ `callerIsAdmin` gates member EMAIL — a public channel is enumerable by an
 * agent that was never invited, so `formatMemberLine` shows email only for a
 * workspace admin or the caller's own row.
 */
export declare function opMembers(client: DoplClient, ref: string, selfUserId?: string | null, callerIsAdmin?: boolean): Promise<ToolResponse>;
