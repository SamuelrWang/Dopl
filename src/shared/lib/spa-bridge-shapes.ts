/**
 * The wire shapes main emits: one live session (`main/session-summary.js`) and one narration line.
 * Import them from `./spa-bridge`, the import path of record. Optional fields: absent = not reported.
 */

export type { DesktopNarrationEntry } from "./spa-bridge-narration";

/**
 * One live session as the desktop projects it; the Agents tab renders from these.
 * ⚠ `state` is three-valued because it is filed as `channel_sessions.state` (CHECK + zod enum admit
 * exactly these; one bad row 400s the whole push). The finer signal is {@link detail}.
 * `taskId` is the wire spelling of thread; `""` is real (a responder session with no thread).
 */
export interface DesktopSessionSummary {
  /** Opaque and not stable across park/recreate: a React key, never an address. */
  sessionId: string;
  channelId: string;
  taskId: string;
  /**
   * The agent instance's address, `^[a-z][a-z0-9]{7}$` (`main/agent-id.js`): the third coordinate of
   * every session op, and what `@<agentId>` names (parsed on the desktop, never by the server).
   */
  agentId?: string;
  /** The agent id; filed as `channel_sessions.name`. */
  name: string;
  /**
   * The operator's own label for this agent (`main/agent-names.js`); `null` is ordinary and falls
   * back to `Agent #<id>`. It names, never addresses. Local only: never reaches `channel_sessions`.
   */
  displayName?: string | null;
  state: "working" | "idle" | "ended";
  /**
   * What it is doing now, finer than the pill (`main/session-detail.js › detailFor`); `null` unless
   * `working`. ⚠ Crosses as a PEER-visible column only because this union is closed: free-form text
   * would be operator-only. The server narrows unknown keys to `null` (`narrowSessionDetail`).
   */
  detail?:
    | "thinking"
    | "tool"
    | "posting"
    | "permission"
    | "awaiting_peer"
    | "awaiting_inbound"
    | null;
  /** The tool in flight, under `detail: "tool"`. Crosses operator-only: free-form, so no peer reads it. */
  toolLabel?: string | null;
  /**
   * Why this session cannot work, or `null` (F-692, `main/mcp-connect-guard.js › failVisibly`).
   * Beside `state`, never instead of it. Local only; survives the session (`agent-history.js`).
   */
  diag?: string | null;
  /**
   * The running session's own posture (the reducer's state, not the channel's stored launch
   * posture); `null` when ended. Axis A is in the session runtime's words ({@link runtimeId}).
   */
  toolMode?: string | null;
  messageMode?: "ask" | "auto_inbound" | "auto_outbound" | "auto_both" | null;
  /**
   * The runtime stamped at spawn, never re-chosen: running-agent surfaces read this runtime's
   * descriptor, never the channel's pick. `''` = the default adapter.
   */
  runtimeId?: string;
  /**
   * The effective model: the SDK-reported id first, then the pick, else `null` (spawn-idle, ended).
   * Free-form (dated ids, `[1m]` variants): render it, never match it against a list. Crosses
   * operator-only (`server/collab-dto.ts › mapPeerSessionStateRow` never names it).
   */
  model?: string | null;
  /**
   * Splits `idle`: `true` = query alive between turns ("Waiting", a message is answered at once);
   * `false` = torn down ("Idle", a message relaunches it). Local only; peers keep saying "Idle".
   */
  listening?: boolean;
  /**
   * Epoch ms this agent ended, `null` while live. An ended card is a read-only tombstone kept seven
   * days (`main/agent-history.js`); every wake path refuses it.
   */
  endedAt?: number | null;
  channelName: string | null;
  /**
   * The channel's workspace id. ⚠ `null` = unknown, never "mine" (INVARIANTS §11); an id, never a
   * segment (the renderer resolves id → segment).
   */
  workspaceId?: string | null;
  threadTitle: string | null;
  /**
   * The identity this session launched as, by name: a snapshot resolved once at spawn
   * (`main/identity-resolve.js`), never an id. Server-side the same fact is operator-only (a private
   * identity's name on a peer card is an existence oracle).
   */
  identityName?: string | null;
  /**
   * The colour key this agent ASKED for. The server resolves per-channel uniqueness and may
   * substitute (`channels/server/session-colors.ts › resolveReportedColors`), so the peer projection
   * outranks this wherever both exist. A string narrowed by the reader (`src/shared/` may not
   * import `features/channels`). `null` = not reported, never "no colour".
   */
  color?: string | null;
  // Agent-view numbers. ⚠ Operator-only on the server (`mapPeerSessionStateRow` never names them).
  // Times are epoch ms here and ISO `TIMESTAMPTZ` on the wire; the desktop converts. `null` is
  // unknown, never zero (INVARIANTS §11).
  /** Tokens occupying the context window (occupancy, not spend; falls after a compaction). */
  contextUsed?: number | null;
  /** That model's window size, or null when this build has no row for it. */
  contextWindow?: number | null;
  /** Lifetime tokens billed, output included; monotonic across park/resume. */
  tokensSpent?: number | null;
  startedAt?: number | null;
  lastActivityAt?: number | null;
}
