/**
 * SESSION TYPES — what a member's agent run looks like from the SERVER's side,
 * and the operator-only telemetry that rides beside it.
 *
 * ⚠ SPLIT OUT OF `types.ts` ON 2026-08-22, at the 500-line cap (that file
 * measured 586 with the telemetry wave in it). `types.ts` re-exports every name
 * here, so every existing import path is unchanged and there is no second path
 * to a symbol — the arrangement `schema.ts` / `schema-sessions.ts` already use.
 *
 * ⚠ THE ONE RULE THIS FILE IS ORGANIZED AROUND: **two audiences, two shapes.**
 * {@link ChannelSessionState} is what a PEER may see; {@link ChannelSessionStateOwn}
 * adds what only the operator may. The enforcement is
 * `server/collab-dto.ts › mapPeerSessionStateRow`, which BUILDS the narrow object
 * rather than scrubbing a wide one.
 */

// ⚠ TYPE-ONLY, and it is the DESKTOP's wire shape rather than a UI import — see
// `SessionDetailKey`, which is derived from it so the six-key vocabulary has one
// declaration across both trees.
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/**
 * SESSION RUN STATE. The three states desktop `session-summary.js` reduces
 * every engine phase/activity to, and the ONLY vocabulary session state is ever
 * reported in — over IPC to the **Agents tab** (`components/channels-v2/
 * agents-tab.tsx`, INVARIANTS §5), over MCP to an external agent. ⚠ The TYPE
 * name is still `SessionPillState` and the desktop reducer's is still
 * `pillState`: the web's session PILLS were deleted in wiring plan Phase 5
 * (2026-08-18) and the names outlived them on the desktop side.
 *
 * ⚠ No `thinking` state, and the REASON CHANGED on 2026-08-20 — re-read it
 * before quoting it, because both earlier reasons are now retired. It was never
 * that streaming is off (F-146 corrected that in four places). Nor is it still
 * "pillState cannot see what has been RENDERED this turn": the desktop lifted
 * that fact at the engine's dispatch funnel, and
 * `dopl-desktop-app/main/session-detail.js` derives a six-valued `detail` from
 * it today.
 *
 * What keeps THIS type at three values is that it is the SERVER's vocabulary and
 * a wire contract with three enforcers — `channel_sessions.state`'s CHECK, the
 * `z.enum` in `schema-sessions.ts`, and the membership set the MCP renderer
 * splices through (`channel-ops-read.ts`). The write path validates the ARRAY, so
 * a single row carrying a fourth value 400s the desktop's whole push
 * unretryably and silently stops every later one for that workspace.
 *
 * ⚠ THE FINER SIGNAL IS NO LONGER LOCAL-ONLY, AND THIS BLOCK SAID IT WAS UNTIL
 * 2026-08-22. `DesktopSessionSummary["detail"]` now CROSSES as
 * `channel_sessions.detail` (migration `20260822150000`), because an
 * orchestrator reading `read_sessions` over MCP is not on the machine and had
 * no way to tell "working" apart from "working on the third of four files".
 * **What did NOT change is this ENUM**: `detail` is a free-text line beside the
 * state, never a fourth state, precisely so the three-enforcer contract above
 * keeps holding.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * One live (or just-ended) session, as answered by
 * `dopl_channel(op="read_sessions")`. Server-visible projection of desktop
 * `session-summary.list()` — ⚠ the SAME derivation the pills use, lifted, never
 * a second one (F-142).
 *
 * Delivery: desktop pushes ON STATE CHANGE (not heartbeat) into
 * `channel_sessions`; the read is scoped to the caller's own sessions. See
 * `session-state-service.ts`.
 */
/**
 * WHICH OF SIX SITUATIONS A LIVE SESSION IS IN — the CLOSED key vocabulary
 * `dopl-desktop-app/main/session-detail.js › detailFor` derives, and the ONLY
 * finer-than-`state` signal that crosses machines (2026-08-22).
 *
 * ⚠ **DERIVED FROM THE BRIDGE SHAPE, NEVER RESTATED.** A second literal union of
 * these six words is how the desktop ships a seventh and one tree keeps
 * rejecting it. `spa-bridge-shapes.ts › DesktopSessionSummary.detail` is the
 * authority because that is where the desktop's own wire shape is declared.
 *
 * ⚠ **A KEY, NOT A SENTENCE, AND THAT IS WHAT MAKES IT PEER-SAFE.** The whole
 * argument for letting `detail` cross to a PEER while every other refinement
 * stays operator-only is that it is one of six fixed words, each already deemed
 * safe to show a counterparty — it says what CLASS of work is happening, never
 * which tool, which model, or what it cost. **Free-form prose in this field
 * would be operator-only material leaking to peers**; see
 * `collab-dto.ts › narrowSessionDetail`, which is what stops one.
 *
 * ⚠ The COPY for each key is written on the reader's side
 * (`components/channels-v2/agents-model.ts › agentDetailLabel`), never carried
 * on the wire — a copy change must not need a desktop release.
 */
export type SessionDetailKey = NonNullable<DesktopSessionSummary["detail"]>;

export type ChannelSessionState = {
  channelId: string;
  threadId: string | null;
  /** Friendly handle (flint / onyx / …) the pills show. */
  name: string;
  state: SessionPillState;
  /**
   * WHICH OF SIX SITUATIONS this session is in — see {@link SessionDetailKey}.
   *
   * ⚠ **OPTIONAL AND NULLABLE, AND BOTH ARE LOAD-BEARING.** ABSENT means this
   * projection does not carry the field (an older server, an older desktop);
   * `null` means the machine reported no refinement. Neither means "doing
   * nothing". ⚠ It had to be OPTIONAL rather than required so that adding it was
   * genuinely ADDITIVE — every existing construction site of this type keeps
   * compiling, which is the rule `spa-bridge-shapes.ts` states for the same
   * wire.
   * ⚠ Structurally assignable to `DesktopSessionSummary["detail"]` ON PURPOSE,
   * so a peer session goes on flowing into `agents-model.ts › agentLiveness`
   * and `agentDetailLabel` with no adapter.
   * ⚠ It only ever REFINES `working`; it never contradicts the state.
   */
  detail?: SessionDetailKey | null;
  /** ⚠ Counterparty-influenced display text — neutralized before storage. */
  channelName: string | null;
  threadTitle: string | null;
  /**
   * THE OPERATOR-GIVEN AGENT NAME ("Bug Reviewer") — **PEER-VISIBLE BY DESIGN**
   * (2026-08-31, Samuel's ruling; migration 20260905120000). ⚠ OPTIONAL AND
   * NULLABLE on `detail`'s two grounds: ABSENT = an older server/desktop does
   * not carry the field; `null` = never named. Renders fall back to `#<name>`.
   */
  displayName?: string | null;
  updatedAt: string;
};

/**
 * THE OPERATOR-ONLY HALF OF A SESSION (Samuel's ruling, 2026-08-22; extended
 * 2026-08-23).
 *
 * ⚠ **THE NAME SAYS "TELEMETRY" AND THE TYPE IS ABOUT AN AUDIENCE.** Seven of
 * its eight fields are measurements; `templateName` is an identity snapshot and
 * is here because it reaches the same one reader, not because anybody measured
 * it. The name is kept because it is cited from four files across three trees and
 * a rename buys a word — see {@link ChannelSessionTelemetry.templateName} for why
 * that field is operator-only on its own two arguments.
 *
 * ⚠ EVERY MEASURED FIELD'S `null` MEANS **UNKNOWN**, NEVER ZERO AND NEVER "NONE". A
 * desktop that reports no `tokensSpent` has not reported that its agent spent
 * nothing, and a render that prints `0` for an absent number is asserting
 * something no machine said. The columns are NULLABLE with no defaults for
 * exactly this reason.
 *
 * ⚠ IT REACHES ONE AUDIENCE: the member whose machine is running the session.
 * `collab-dto.ts › mapPeerSessionStateRow` cannot emit these fields, because it
 * BUILDS its object rather than scrubbing one — see that function's docblock for
 * why construction is the fence and the column GRANT is only the belt.
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
   * operator-authored free text, which is the exact condition
   * `20260822150000` states for a field going private; and a private template's
   * name on a peer's screen is an existence oracle for a row that carries no
   * name uniqueness precisely so it cannot be probed. ⚠ There is deliberately
   * **no `hasTemplate` boolean** on the peer projection — a smaller oracle is
   * still one.
   *
   * `null` = this session was not launched from a template, OR the desktop
   * reporting it predates the field. The two are not distinguished and the
   * render treats them the same.
   */
  templateName: string | null;
};

/**
 * THE HEALTH HALF OF A SESSION — "is this agent GETTING ANYWHERE", as the seven
 * facts `dopl-desktop-app/main/session-health.js` derives (2026-09-01,
 * migration `20260909120000`).
 *
 * ⚠ **A SIBLING INTERFACE RATHER THAN SEVEN MORE FIELDS ON
 * {@link ChannelSessionTelemetry}, AND THE REASON IS THAT FILE'S OWN COMPLAINT.**
 * That type's docblock already apologizes for its name — "THE NAME SAYS
 * TELEMETRY AND THE TYPE IS ABOUT AN AUDIENCE" — because `templateName` had to
 * be squeezed in beside seven measurements. Adding seven MORE fields that are
 * not telemetry either would make the name wrong for eight of fifteen and give
 * the type two reasons to change (what an agent COSTS, and whether it is
 * PROGRESSING; the desktop split those into two modules for exactly this
 * reason). They share ONE property — the audience — and the audience is
 * enforced by `server/collab-dto.ts › OPERATOR_ONLY_SESSION_FIELDS`, not by
 * living in one interface. So: two names, one intersection below.
 *
 * ⚠ **EVERY FIELD IS OPTIONAL *AND* NULLABLE, AND THE TWO HALVES SAY DIFFERENT
 * THINGS.** ABSENT = this projection does not carry the field at all (an older
 * server — INVARIANTS §13, and the shape `detail` / `displayName` already use);
 * `null` = the row carries it and nothing has measured it. Neither is a zero and
 * neither is a `false`. ⚠ It is optional on the SERVER side too, even though
 * `mapOwnSessionStateRow` always emits these, so that this declaration and its
 * hand-mirror in `@dopl/client › session-health-types.ts` are the SAME shape —
 * there is no drift gate between them, and a type that differs in one tree is
 * the drift.
 *
 * ⚠ EVERY `null` MEANS **UNKNOWN**, and six of the seven are counts, so the
 * `null`-is-not-zero rule bites harder here than it does on cost: a `0` for
 * {@link ChannelSessionHealth.deniedCalls} reports that nothing has been refused
 * to an agent whose every shell call may be being refused silently.
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
   * staleness from `updatedAt`
   * (`packages/mcp-server/src/tools/channel-session-render.ts ›
   * sessionIsStale`), and that one is about the REPORT — "nobody has said
   * anything", which includes the desktop having died. This one is about the
   * SESSION — a live process getting nowhere. A live-but-quiet agent is the
   * second without the first; a crashed machine is the first without the
   * second. The wire name is the desktop's and is deliberately NOT renamed on
   * this side; the render keeps them apart instead
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

/** The caller's OWN session — coarse projection, plus the two operator-only
 *  halves: what it COSTS and whether it is GETTING ANYWHERE. */
export type ChannelSessionStateOwn = ChannelSessionState &
  ChannelSessionTelemetry &
  ChannelSessionHealth;
