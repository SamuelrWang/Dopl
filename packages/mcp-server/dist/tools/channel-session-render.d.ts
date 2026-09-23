/**
 * Session vocabulary and the one-line session form, shared by `op="status"`, `channel-session-table.ts`
 * and `status-render.ts`. A row is a report the desktop pushes on change, not an observation: past the
 * stale window it is hedged, and `null` telemetry is unknown, never zero.
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
import type { ChannelSessionState, ChannelSessionStateOwn, SessionDetailKey } from "@dopl/client";
/** Peer-influenced display text, neutralized — never an empty span. */
export declare const NO_TITLE = "(untitled)";
/** `state` is spliced into server narration, so it must pass membership (a newline could forge a block). */
export declare const SESSION_STATES: ReadonlySet<string>;
export declare const UNKNOWN_STATE = "(unrecognized state)";
/**
 * Past this, a row stops asserting a live state. Deliberate duplicate of
 * `src/features/channels/constants.ts › PRESENCE_ONLINE_WINDOW_MS`, pinned by `channel-session-staleness.test.ts`.
 */
export declare const SESSION_STALE_WINDOW_MS = 120000;
export declare function detailPhrase(detail: SessionDetailKey | null | undefined): string | null;
/** An absent or unparseable `updatedAt` reads as stale. */
export declare function sessionIsStale(session: Pick<ChannelSessionState, "updatedAt">, now?: number, windowMs?: number): boolean;
/**
 * A model id for a glance: only a trailing `-YYYYMMDD` stamp is dropped (no vendor-prefix strip), and
 * characters `neutralizeInline` would blank are joined with `-` so one id never renders as two names (F-293).
 */
export declare function shortModelLabel(model: string): string;
export interface SessionRenderOpts {
    telemetry?: boolean;
    now?: number;
    /** The caller's own machine's presence, not this session's; `undefined` (not reported) takes the `false` branch. */
    operatorOnline?: boolean;
    /** Own rows only: an agent id is a wake token (INVARIANTS §11), so this is not tied to `telemetry`. */
    handle?: boolean;
    /** Emit the leading `- ` bullet (default true). */
    bullet?: boolean;
}
/** A stale row under a live operator heartbeat is quiet, not gone (F-294); an unreadable `updatedAt` never is. */
export declare function rowIsQuietNotGone(age: number | null, stale: boolean, operatorOnline: boolean | undefined): boolean;
/** One session row, all peer-influenced text neutralized; `telemetry` adds the operator-only clauses. */
export declare function formatSessionLine(s: ChannelSessionState | ChannelSessionStateOwn, opts?: SessionRenderOpts): string;
/** The legend under a set of session lines; branches on the same quiet/stale fact the rows did (F-294). */
export declare function sessionLegend(anyStale: boolean, operatorOnline?: boolean): string;
