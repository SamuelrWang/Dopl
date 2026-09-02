/**
 * THE SESSION PROJECTION — what `dopl_channel(op="read_sessions")` and the Agents
 * tab see of a member's live agents.
 *
 * ⚠ **HAND-MAINTAINED MIRRORS of `src/features/channels/types-sessions.ts`**,
 * which is the original and carries the argument for every field; this package
 * cannot import that tree (INVARIANTS §13). The HEALTH seven are one more file
 * along (`session-health-types.ts`) and are pinned across four sites by
 * `scripts/check-session-health-drift.ts`.
 *
 * ⚠ **ITS OWN FILE (§1 split, 2026-09-02)** because `channel-types.ts` reached the
 * 500-line cap. The seam is real rather than arithmetic: this changes when the
 * session projection changes, and it is a different contract from a channel's.
 */
import type { ChannelSessionHealth } from "./session-health-types.js";
/**
 * ⚠ **`SessionPillState` AND `ChannelSessionTelemetry` ARE DECLARED IN
 * `@dopl/contracts` AND RE-EXPORTED HERE** (2026-09-02, A13 × A9). A9 split this
 * projection out of `channel-types.ts` under §1's 500-line cap; A13 had already
 * moved the closed set and the operator-only telemetry shape to the one
 * type-only package both trees can name. Re-typing either here would put back
 * exactly the hand-mirror A13 deleted — `canonical-sets.test.ts` is the gate
 * that says so, and the docblocks that argued for each field now live there.
 */
import type { SessionPillState, ChannelSessionTelemetry } from "@dopl/contracts";
export type { SessionPillState, ChannelSessionTelemetry };
/**
 * ONE of a member's live (or just-ended) sessions, from
 * `dopl_channel(op="read_sessions")`. Server-visible projection of the
 * desktop's `session-summary.list()`.
 */
/**
 * WHICH OF SIX SITUATIONS a live session is in — one step finer than
 * {@link SessionPillState} and the only refinement that crosses machines.
 *
 * ⚠ **A CLOSED KEY VOCABULARY, NOT PROSE, AND THAT IS WHY IT MAY BE SEEN BY A
 * PEER.** Six fixed words, each coarse enough to show a counterparty: they say
 * what CLASS of work is happening and never which tool, which model, or what it
 * cost. Anything free-form belongs on the operator-only side
 * ({@link ChannelSessionTelemetry}).
 *
 * ⚠ A DELIBERATE COPY of `src/features/channels/types.ts › SessionDetailKey`
 * (itself derived from the desktop's own `DesktopSessionSummary["detail"]`) —
 * this package cannot import across the tree boundary. `channel-session-
 * staleness.test.ts` pins the two against that file's text.
 * ⚠ AN UNKNOWN KEY NEVER ARRIVES: the server narrows anything outside this set
 * to `null` before it reaches the wire, so a newer desktop's seventh key reads
 * as "no refinement" rather than as raw text in a rendered result.
 */
export type SessionDetailKey = "thinking" | "tool" | "posting" | "permission" | "awaiting_peer" | "awaiting_inbound";
export interface ChannelSessionState {
    channelId: string;
    /** Thread (task) this session is on, or null. */
    threadId: string | null;
    /** Friendly handle the pills show (flint / onyx / …). */
    name: string;
    state: SessionPillState;
    /**
     * WHICH OF SIX SITUATIONS this session is in — see {@link SessionDetailKey}.
     * ⚠ OPTIONAL **and** nullable: ABSENT means this projection does not carry the
     * field (an older server), `null` means the machine reported no refinement.
     * Neither means "doing nothing". ⚠ It only ever REFINES `working`.
     */
    detail?: SessionDetailKey | null;
    channelName: string | null;
    threadTitle: string | null;
    updatedAt: string;
}
/** The caller's OWN session — coarse projection plus the operator-only halves. */
export type ChannelSessionStateOwn = ChannelSessionState & ChannelSessionTelemetry & ChannelSessionHealth;
/**
 * `listChannelSessions`' whole answer — the rows AND whether the machine that
 * would have written them is still heartbeating (2026-08-23, F-294).
 *
 * ⚠ **THE SECOND FIELD IS NOT ABOUT ANY ONE SESSION AND MUST NOT BE FOLDED INTO
 * ONE.** `agent_presence` is per-(user, workspace): it says a listener of this
 * operator's heartbeat recently, which is why it lives on the ENVELOPE rather
 * than repeated onto every row as if each machine had answered separately.
 * ⚠ **OPTIONAL, AND IT STAYS OPTIONAL** — INVARIANTS §13, an older deployment is
 * a supported peer. Absent = NOT REPORTED, and a render must treat that exactly
 * as it treats `false`: a fact nobody reported is not evidence of life.
 * ⚠ It is a BOOLEAN and never a stamp, deliberately: the freshness window is the
 * server's (`PRESENCE_ONLINE_WINDOW_MS`), and a stamp on the wire invites a
 * client to re-derive it against a second number.
 * ⚠ Precedent for the envelope shape is `ChannelThreadPage`, for the same reason
 * — one fact about the PAGE that is not a fact about any row on it.
 */
export interface ChannelSessionsPage {
    sessions: ChannelSessionStateOwn[];
    operatorOnline?: boolean;
}
