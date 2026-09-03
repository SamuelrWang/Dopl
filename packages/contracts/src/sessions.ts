/**
 * SESSION CLOSED SETS AND THE TWO OPERATOR-ONLY HALVES — the run state an agent
 * is reported in, what it COSTS, and whether it is GETTING ANYWHERE.
 *
 * ⚠ **THE HAND MIRRORS THESE REPLACE.** `ChannelSessionHealth` alone was
 * declared four times (`src/features/channels/types-sessions.ts`, the zod block
 * in `schema-sessions.ts`, `packages/dopl-client/src/session-health-types.ts`
 * and that package's committed `dist/`) and `check-session-health-drift.ts`
 * existed only to hold them together. The two TypeScript declarations are now
 * ONE and both trees re-export it.
 *
 * ⚠ **THE GATE DID NOT GO AWAY, AND MUST NOT.** Two sites remain outside the
 * compiler's reach and both still fail SILENTLY: the zod half
 * (`schema-sessions.ts › SessionStateEntrySchema` — a field the server does not
 * ACCEPT is a field the desktop reports into a strip) and the migration's own
 * columns (`20260909120000_channel_sessions_health.sql` — a field with no column
 * is one the upsert drops). `check-session-health-drift.ts` now compares this
 * file against exactly those two.
 *
 * ⚠ **WHAT IS DELIBERATELY NOT HERE: `SessionDetailKey` AND THE SESSION ROW
 * ITSELF.** The server DERIVES the six-key `detail` vocabulary from
 * `shared/lib/spa-bridge-shapes.ts › DesktopSessionSummary["detail"]`, because
 * that is where the DESKTOP's own wire shape is declared, and moving the
 * declaration here would invert a derivation the desktop tree owns — trading one
 * mirror for a worse one. `ChannelSessionState` / `…Own` reference it and stay
 * with it.
 */

/**
 * SESSION RUN STATE — the three states desktop `session-summary.js` reduces
 * every engine phase/activity to, and the ONLY vocabulary session state is ever
 * reported in.
 *
 * ⚠ No `thinking` state, and the reason is that this is a WIRE CONTRACT WITH
 * THREE ENFORCERS: `channel_sessions.state`'s CHECK, the `z.enum` in
 * `schema-sessions.ts`, and the membership set the MCP renderer splices through
 * (`channel-ops-read.ts`). The write path validates the ARRAY, so a single row
 * carrying a fourth value 400s the desktop's whole push unretryably and silently
 * stops every later one for that workspace. The finer signal crosses as
 * `detail` — a free-text line BESIDE the state, never a fourth state.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * THE OPERATOR-ONLY COST HALF OF A SESSION (Samuel's ruling, 2026-08-22;
 * extended 2026-08-23).
 *
 * ⚠ **THE NAME SAYS "TELEMETRY" AND THE TYPE IS ABOUT AN AUDIENCE.** Seven of
 * its eight fields are measurements; `templateName` is an identity snapshot and
 * is here because it reaches the same one reader. The name is kept because it is
 * cited from four files across three trees and a rename buys a word.
 *
 * ⚠ EVERY MEASURED FIELD'S `null` MEANS **UNKNOWN**, NEVER ZERO AND NEVER
 * "NONE". A desktop that reports no `tokensSpent` has not reported that its
 * agent spent nothing, and a render that prints `0` for an absent number is
 * asserting something no machine said. The columns are NULLABLE with no defaults
 * for exactly this reason.
 *
 * ⚠ IT REACHES ONE AUDIENCE: the member whose machine is running the session.
 * `channels/server/collab-dto.ts › mapPeerSessionStateRow` cannot emit these
 * fields, because it BUILDS its object rather than scrubbing one.
 */
export type ChannelSessionTelemetry = {
  /** Model id/label the session is running on, as the desktop reports it. */
  model: string | null;
  /** The tool the session is running RIGHT NOW ("Bash", "Edit"). */
  toolLabel: string | null;
  /** Context tokens in use, and the window they are in use against. */
  contextUsed: number | null;
  contextWindow: number | null;
  /** Total tokens billed to this session so far. */
  tokensSpent: number | null;
  /** When the session started, and when it last did anything. */
  startedAt: string | null;
  lastActivityAt: string | null;
  /**
   * THE AGENT TEMPLATE THIS SESSION WAS LAUNCHED FROM, BY NAME, AS OF SPAWN.
   *
   * ⚠ **A SNAPSHOT, NOT A POINTER.** The column is TEXT and deliberately not an
   * FK (`20260823130000_channel_sessions_template_name.sql`): a session keeps
   * its spawn-time template content for its whole life, so it must go on
   * reporting what it RAN AS after the template is renamed or deleted. A stale
   * name here is CORRECT, not drift.
   *
   * ⚠ **OPERATOR-ONLY, on two independent arguments** (Samuel, OQ-5). It is
   * operator-authored free text, which is the exact condition `20260822150000`
   * states for a field going private; and a private template's name on a peer's
   * screen is an existence oracle for a row that carries no name uniqueness
   * precisely so it cannot be probed. ⚠ There is deliberately **no
   * `hasTemplate` boolean** on the peer projection — a smaller oracle is still
   * one.
   *
   * `null` = this session was not launched from a template, OR the desktop
   * reporting it predates the field. The two are not distinguished.
   */
  templateName: string | null;
};

/**
 * THE HEALTH HALF OF A SESSION — "is this agent GETTING ANYWHERE", as the seven
 * facts `dopl-desktop-app/main/session-health.js` derives (2026-09-01,
 * migration `20260909120000`).
 *
 * ⚠ **A SIBLING TYPE RATHER THAN SEVEN MORE FIELDS ON
 * {@link ChannelSessionTelemetry}**, whose docblock already apologizes for its
 * name. Seven MORE fields that are not telemetry either would give the type two
 * reasons to change (what an agent COSTS, and whether it is PROGRESSING; the
 * desktop split those into two modules for exactly this reason). They share ONE
 * property — the audience — and the audience is enforced by
 * `channels/server/collab-dto.ts › OPERATOR_ONLY_SESSION_FIELDS`, not by living
 * in one type.
 *
 * ⚠ **EVERY FIELD IS OPTIONAL *AND* NULLABLE, AND THE TWO HALVES SAY DIFFERENT
 * THINGS.** ABSENT = this projection does not carry the field at all (an older
 * server — INVARIANTS §13); `null` = the row carries it and nothing has measured
 * it. Neither is a zero and neither is a `false`. ⚠ It is optional on the SERVER
 * side too, even though `mapOwnSessionStateRow` always emits these — the
 * optionality is the wire contract, not a projection detail.
 *
 * ⚠ EVERY `null` MEANS **UNKNOWN**, and six of the seven are counts, so the
 * `null`-is-not-zero rule bites harder here than it does on cost: a `0` for
 * {@link ChannelSessionHealth.deniedCalls} reports that nothing has been refused
 * to an agent whose every shell call may be being refused silently. Render
 * nothing for an absent field.
 */
export type ChannelSessionHealth = {
  /** Turns this session has taken (`main/session-io.js › applyCoreEvents`
   *  counts a `result` event as one). ⚠ Deliberately NOT quantized on the wire —
   *  the difference between 1 turn and 4 is the signal. */
  turns?: number | null;
  /**
   * TOKENS BURNED SINCE THIS SESSION LAST **POSTED** TO ITS CHANNEL.
   *
   * ⚠ **NOT "PER TURN", AND NOT "SINCE THE LAST PUSH".** The baseline is
   * `main/session-outbound-tag.js › nextOwnPostId`, i.e. the last thing an
   * orchestrator actually SAW from this agent — see `main/session-health.js`'s
   * "SINCE LAST REPORT" block for why measuring against the row push instead
   * would answer "tokens spent in the last few seconds", which nobody can act
   * on. A session that has never posted reports its whole spend.
   * ⚠ Quantized to `tokensSpent`'s own bucket, so the two move together.
   */
  tokensDelta?: number | null;
  /**
   * THE MACHINE'S OWN WEDGED FLAG: `working` **and** silent past ten minutes
   * **and** still spending — all three, because either of the first two alone
   * describes a perfectly healthy agent.
   *
   * ⚠ 🔒 **THIS IS NOT THE OTHER "STALE".** The MCP render derives a DIFFERENT
   * staleness from `updatedAt` (`packages/mcp-server/src/tools/
   * channel-session-render.ts › sessionIsStale`), and that one is about the
   * REPORT — "nobody has said anything", which includes the desktop having died.
   * This one is about the SESSION — a live process getting nowhere. A
   * live-but-quiet agent is the second without the first; a crashed machine is
   * the first without the second. The wire name is the desktop's and is
   * deliberately NOT renamed; the render keeps them apart instead
   * (`tools/channel-session-health.ts`).
   * ⚠ `null` = nothing evaluated it (a desktop older than the field), which is
   * NOT the same claim as `false`.
   */
  stale?: boolean | null;
  /** Tool calls REFUSED to this session, and the last tool that was
   *  (`main/session-windowless.js › noteDenied`). ⚠ THE T25 SIGNAL: a windowless
   *  session at the `auto` tool floor has every shell call denied SILENTLY, and
   *  this pair is the only evidence of it that crosses machines. `null` means
   *  nothing counted — never that nothing was denied. */
  deniedCalls?: number | null;
  lastDeniedTool?: string | null;
  /**
   * THE LAST WAKE THIS MACHINE **ENQUEUED** FOR THE SESSION — the `seq` it was
   * carrying, and when (`main/session-gate.js › enqueue`).
   *
   * ⚠ **A REPORT OF WHAT THE MACHINE DID. NOT A DELIVERY GUARANTEE.** It is
   * stamped at the moment a wake is QUEUED; nothing here says the agent read it,
   * acted on it, or is still running. An orchestrator uses it to answer "did my
   * redirect reach the machine at all", which is strictly weaker than "did it
   * land", and the render says so in those words.
   */
  lastWakeSeq?: number | null;
  lastWakeAt?: string | null;
};
