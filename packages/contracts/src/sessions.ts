/**
 * Session closed sets and the two operator-only halves (cost, health). The zod half
 * (`schema-sessions.ts`) and the migration's columns are outside the compiler's reach, so
 * `scripts/check-session-health-drift.ts` compares them against this file. `SessionDetailKey` stays
 * with the desktop's wire shape (`shared/lib/spa-bridge-shapes.ts`), which the server derives from.
 */

/**
 * The only session run states. Three enforcers (the column CHECK, the zod enum, the MCP renderer's
 * set): one row with a fourth value 400s the desktop's whole push, so finer signal rides `detail`.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * The operator-only cost half of a session (plus the spawn-time identity name). Every `null` means
 * unknown, never zero. The peer projection (`collab-dto.ts › mapPeerSessionStateRow`) builds its
 * object and cannot emit these fields.
 */
export type ChannelSessionTelemetry = {
  model: string | null;
  /** The tool running right now, e.g. the shell tool. */
  toolLabel: string | null;
  contextUsed: number | null;
  contextWindow: number | null;
  tokensSpent: number | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  /**
   * The identity launched from, as of spawn — a snapshot (TEXT, not an FK), so a stale name after a
   * rename is correct. Operator-only: a private identity's name on a peer's screen is an existence
   * oracle. `null` = no identity, or a desktop older than the field (not distinguished).
   */
  identityName: string | null;
};

/**
 * The health half — is this agent getting anywhere (`dopl-desktop-app/main/session-health.js`). Every
 * field is optional (absent = an older server, INVARIANTS §13) AND nullable (`null` = not measured);
 * neither is a zero or `false`, so render nothing for an absent field. Operator-only via
 * `collab-dto.ts › OPERATOR_ONLY_SESSION_FIELDS`.
 */
export type ChannelSessionHealth = {
  /** Turns taken (a `result` event is one). Not quantized: 1 vs 4 is the signal. */
  turns?: number | null;
  /** Tokens spent since this session last POSTED to its channel (what an orchestrator last saw), not
   *  per turn or per push; quantized like `tokensSpent`. */
  tokensDelta?: number | null;
  /**
   * The machine's wedged flag: working AND silent past ten minutes AND still spending. Not the MCP
   * render's report-staleness (`channel-session-render.ts › sessionIsStale`), which is about the
   * report; this is about the session. `null` = not evaluated, not `false`.
   */
  stale?: boolean | null;
  /** Tool calls refused to this session, and the last one refused — the only cross-machine evidence
   *  of a windowless session whose calls are denied silently. `null` = not counted. */
  deniedCalls?: number | null;
  lastDeniedTool?: string | null;
  /** The last wake this machine ENQUEUED for the session (`main/session-gate.js › enqueue`): a
   *  report of what the machine did, not a delivery guarantee. */
  lastWakeSeq?: number | null;
  lastWakeAt?: string | null;
};

/**
 * An agent's colour in a channel: a KEY, never a paint value (the paint lives in
 * `--agent-color-01…16`, `globals.css` + the SPA's `tokens.css`). Spelled out rather than a
 * template-literal type; also stated by `lib/agent-colors.ts › AGENT_COLOR_KEYS` and two column
 * CHECKs (`agent-color-schema.test.ts` holds the SQL pair). A marker, never a status. Unique among a
 * channel's live sessions across members; `null` is ordinary (older desktop, or all sixteen out).
 */
export type AgentColorKey =
  | "agent-01"
  | "agent-02"
  | "agent-03"
  | "agent-04"
  | "agent-05"
  | "agent-06"
  | "agent-07"
  | "agent-08"
  | "agent-09"
  | "agent-10"
  | "agent-11"
  | "agent-12"
  | "agent-13"
  | "agent-14"
  | "agent-15"
  | "agent-16";
