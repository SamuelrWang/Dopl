/**
 * THE WIRE SHAPES MAIN EMITS — one live session, and (re-exported from `./spa-bridge-narration`
 * at the 500-line cap) one line of an agent's work.
 *
 * ⚠ SPLIT OUT OF `./spa-bridge` ON 2026-08-22, under the 500-line cap, and the seam is a real one
 * rather than a line budget. `spa-bridge.ts` answers "what does the bundled-SPA bridge OFFER, and
 * how do I know I am in it" — a CAPABILITY question that changes when an op is added. This file
 * answers "what does the desktop SEND" — a DATA question that changes when
 * `dopl-desktop-app/main/session-summary.js` or `› session-narration.js` grows a field. Those two
 * move on different clocks, and the ops surface was carrying 230 lines of field prose it never
 * reads.
 *
 * ⚠ BOTH TYPES ARE RE-EXPORTED FROM `./spa-bridge`, WHICH IS THE IMPORT PATH OF RECORD. Every
 * existing importer — the web tree and `apps/desktop-ui/src/lib/dopl-bridge.ts`'s mirror alike —
 * keeps working unchanged, and new code should keep using it: a second canonical import path for
 * one type is how two trees come to disagree about which one is authoritative.
 *
 * ⚠ ADDITIVE-ONLY. An older main omits fields it has not shipped yet, so every
 * optional member's absence has to have an honest fallback stated at the member itself. That rule
 * is why so much of this file is prose rather than declarations.
 */

export type { DesktopNarrationEntry } from "./spa-bridge-narration";

/**
 * ONE LIVE SESSION as the desktop projects it — wire shape emitted by
 * `dopl-desktop-app/main/session-summary.js`. **The AGENTS TAB renders from
 * these** (`channels/components/agents-tab.tsx` over `› agents-model.ts`,
 * INVARIANTS §5). ⚠ It used to be the channel pane's session pills; those and
 * `channel-pane.tsx` were deleted in wiring plan Phase 5 / the Phase 12 cutover.
 *
 * ⚠ `state` IS THREE-VALUED BECAUSE THE SERVER'S VOCABULARY IS — corrected
 * 2026-08-20. This docblock used to say "thinking needs `includePartialMessages`,
 * which is off, so it can never be derived", which was already the wrong reason
 * when F-146 corrected it in four other places (the session window derived a
 * Thinking chip with no stream). The live reason is that `state` is handed
 * straight to `channel_sessions.state`, whose CHECK and whose zod enum both admit
 * exactly working/idle/ended — and zod validates the ARRAY, so one row carrying a
 * fourth value 400s the whole push unretryably. The finer signal is {@link
 * DesktopSessionSummary.detail}, which rides BESIDE the pill and never reaches
 * the server.
 *
 * `taskId` is the wire spelling of THREAD, and `""` is a real value — a responder
 * session with no first-class thread.
 */
export interface DesktopSessionSummary {
  /** ⚠ Opaque and NOT stable across park/recreate — a React key, never an
   *  address. `reopen` takes the (channelId, taskId) pair. */
  sessionId: string;
  channelId: string;
  taskId: string;
  /**
   * THE AGENT INSTANCE'S ADDRESS — 8 chars, `^[a-z][a-z0-9]{7}$`
   * (`dopl-desktop-app/main/agent-id.js`). ⚠ THE THIRD COORDINATE OF EVERY
   * SESSION OP since 2026-08-21: `(channelId, taskId)` names a GROUP of the
   * operator's agents on one thread, not one session, so `pause` / `end` /
   * `setMode` / `message` / `narration` / `reopen` / `openAgentWindow` all take
   * this to say WHICH. It is also the token a human types as `@<agentId>` in the
   * thread body to address one agent among several — parsed on the desktop
   * (`main/session-dispatch.js`), never by the server's mention resolver, which
   * correctly fails closed on ids that are not channel members.
   * ⚠ Optional: an older main omits it, and the ops degrade to the oldest live
   * agent on the thread.
   */
  agentId?: string;
  /**
   * The handle the pill shows. ⚠ IT IS THE AGENT ID as of 2026-08-21 — the
   * curated stone-name pool ("flint", "onyx") is DELETED in both trees along
   * with its parity test. A pool handle was released and re-issued the moment
   * its session left, which under multiplayer means `@flint` in a transcript
   * could name a different agent than the one it was typed at. This is the
   * value the desktop files as `channel_sessions.name`.
   */
  name: string;
  /**
   * WHAT THE OPERATOR CALLS THIS AGENT (2026-08-25, Samuel's rename ruling) — their own words,
   * stored on THEIR machine (`main/agent-names.js`, keyed by `agentId`) and projected here.
   *
   * ⚠ NULL IS THE ORDINARY ANSWER, not a gap: most agents are never renamed and the display
   * falls back to the canonical `Agent #<id>` (`agents-model.ts › agentDisplayName`).
   * ⚠ IT NAMES, IT NEVER ADDRESSES. `@<agentId>` and every session op still take the id, so a
   * rename can never re-point a running instruction.
   * ⚠ LOCAL TO THE MACHINE THAT RAN IT. `session-state-push.js › reportRow` picks its columns
   * by name, so this never reaches `channel_sessions` — a PEER's card shows what their own
   * machine reports. ⚠ Optional: an older main omits it.
   */
  displayName?: string | null;
  state: "working" | "idle" | "ended";
  /**
   * WHAT IT IS DOING RIGHT NOW, one step finer than the pill (2026-08-20).
   * Derived by `dopl-desktop-app/main/session-detail.js › detailFor` from the
   * reducer event that last moved the session.
   *
   * ⚠ **IT IS NO LONGER LOCAL-ONLY, AND THIS BLOCK SAID IT WAS UNTIL
   * 2026-08-22.** It now CROSSES as `channel_sessions.detail` (migration
   * `20260822150000`), so a PEER's card does see it — an orchestrator reading
   * `read_sessions` from another machine could not tell a session blocked on an
   * approval apart from one grinding through a tool, and neither could the
   * Agents tab's peer half.
   * ⚠ **IT CROSSES ONLY BECAUSE THIS UNION IS CLOSED**, and that is the
   * condition on the permission rather than a description of it. Six fixed
   * coarse words say what CLASS of work is happening and never which tool, which
   * model, or what it cost. **Widening this member to free-form text would make
   * it operator-only material on a peer-visible column** — if that is ever
   * wanted, the value goes on the operator-only side beside `model` and the
   * metrics, and `server/collab-dto.ts › mapPeerSessionStateRow` stops emitting
   * it in the same change. The server narrows anything off this list to `null`
   * (`narrowSessionDetail`), so a SEVENTH key added here stores and renders as
   * nothing until the server learns it — it never 400s a push and never reaches
   * a reader raw.
   *
   * ⚠ NULL OVER ANY PILL BUT `working`, by construction: it REFINES the pill and
   * never contradicts it. A card showing "Idle" and "Thinking…" at once is the
   * two-readers-one-fact defect in miniature.
   * ⚠ Optional: an older main omits it, exactly like the five metrics below.
   */
  detail?:
    | "thinking"
    | "tool"
    | "posting"
    | "permission"
    | "awaiting_peer"
    | "awaiting_inbound"
    | null;
  /** The short name of the tool in flight, bounded. Meaningful only under
   *  `detail: "tool"`; `null` when the tool could not be named, which the copy
   *  degrades to "Running a command" rather than to a blank.
   *  ⚠ IT CROSSES as `channel_sessions.tool_label` (2026-08-22) and is
   *  **OPERATOR-ONLY** on the far side — unlike `detail` beside it, this is a
   *  free-form name out of the tool registry, which is exactly the class of
   *  value a peer may not read. `mapPeerSessionStateRow` never names it. */
  toolLabel?: string | null;
  /**
   * **WHY THIS SESSION CANNOT WORK, IN THE OPERATOR'S OWN WORDS** — `null` in the
   * ordinary case (2026-09-13, F-692).
   *
   * Set by `dopl-desktop-app/main/mcp-connect-guard.js › failVisibly` when the Dopl
   * MCP server never connected — the incident that bought this field: a cold
   * `/api/mcp` answered past the CLI's 5s connect budget, the child abandoned the
   * server, and every `mcp__dopl__*` call came back "No such tool available" for the
   * whole run while the pill read `working`.
   *
   * ⚠ **IT RIDES BESIDE `state`, NEVER INSTEAD OF IT** — `detail`'s rule exactly.
   * A fourth pill value is impossible: `state` is the SERVER's three-value
   * vocabulary and one row carrying a fourth 400s the whole push, unretryably
   * (`session-pill.js`'s header).
   * ⚠ **LOCAL-ONLY, STRUCTURALLY.** `session-state-push.js › reportRow` picks its
   * fields by name, so this never reaches `channel_sessions` and no peer can read
   * it. Do not plumb it into `PeerCards`.
   * ⚠ It SURVIVES the session: `agent-history.js › durableHistory` freezes it, so an
   * ended card can still say why.
   */
  diag?: string | null;
  /**
   * THE LIVE PERMISSION POSTURE (2026-08-20) — what this RUNNING session is
   * actually on, so the agent view's controls can show the value they set.
   *
   * ⚠ THE REDUCER'S STATE, NOT THE CHANNEL'S STORED LAUNCH POSTURE. Different
   * facts: the launch posture governs the next spawn, this is where the session
   * has been moved to since. A control that read the stored one would go wrong
   * the moment either is changed without the other — which is the normal case,
   * since the whole point of these controls is to move a session off what it
   * launched on.
   * ⚠ `null` on an ENDED session (nothing to change). Axis A is in the session's runtime's
   * own words ({@link runtimeId}).
   */
  toolMode?: string | null;
  messageMode?: "ask" | "auto_inbound" | "auto_outbound" | "auto_both" | null;
  /**
   * WHICH RUNTIME DRIVES THIS SESSION — the spawn stamp (`main/session-engine.js`), never
   * re-chosen. Every running-agent surface reads its vocabulary, catalog, sign-in and interrupt
   * copy from THIS runtime's descriptor, never the channel's current pick. {@link toolMode} is in
   * its words. `''` reads as the default adapter.
   */
  runtimeId?: string;
  /**
   * WHICH MODEL IS REALLY ANSWERING (2026-08-22, Samuel's model-selection ruling).
   *
   * ⚠ IT IS THE EFFECTIVE MODEL, NOT THE PICK, AND THE PRECEDENCE IS DELIBERATE:
   * the SDK's own reported id first (main stamps it from `system/init` and from
   * every assistant message, so a mid-session `sessions.setModel` shows up here
   * with no second wiring), then the operator's pick, then `null`. A card that
   * showed the PICK would go wrong the moment the two differed — which is the
   * normal case, because the default pick means "whatever the CLI chose" and the
   * CLI is the one that knows.
   *
   * ⚠ `null` IS A REAL ANSWER AND MUST RENDER AS ONE: a SPAWN-IDLE agent has
   * started no query, so nothing has reported a model and nothing was picked. It
   * is also `null` on an ENDED agent — the model is a control's current value and
   * there is no control over a dead agent, unlike the five metrics beside it,
   * which ARE frozen at settle because the operator wants to read what the run
   * cost.
   *
   * ⚠ FREE-FORM BY CONSTRUCTION. What arrives is whatever the CLI reported (a
   * dated id like `claude-opus-4-5-20251101`, or a `[1m]` long-context variant),
   * NOT necessarily a member of the four ids `sessions.setModel` accepts. Render
   * it; do not match it against that list.
   * ⚠ **IT CROSSES, AND IT IS OPERATOR-ONLY ON THE FAR SIDE** — this block said
   * "LOCAL-ONLY: it never reaches `channel_sessions`" until 2026-08-22, and the
   * column exists now (`20260822150000`). What kept a peer from seeing it was
   * the absence of anywhere to put it; what keeps a peer from seeing it now is
   * `server/collab-dto.ts › mapPeerSessionStateRow`, which BUILDS the coarse
   * projection and never names this field. A PEER's card still carries no model.
   * ⚠ Optional: an older main omits it.
   */
  model?: string | null;
  /**
   * IS THIS SESSION STILL LISTENING? (2026-08-22, Samuel's ruling.) It SPLITS the `idle`
   * pill, which covers two states an operator cannot tell apart and must:
   *   `true`   the SDK query is ALIVE and between turns. A message is PUSHED onto the open
   *            prompt iterator and answered at once. **Label it "Waiting".**
   *   `false`  the query is torn down — parked by the idle timer, spawn-idle never woken, or
   *            held on sign-in. A message must RELAUNCH it. **Label it "Idle".**
   * Seconds versus a cold start, and the operator's next move differs.
   *
   * ⚠ IT REFINES `state`, NEVER CONTRADICTS IT — the rule {@link DesktopSessionSummary.detail}
   * follows. It says nothing new under `working` (always true) or `ended` (always false).
   * ⚠ LOCAL-ONLY: it never reaches `channel_sessions`. The cross-machine vocabulary stays the
   * three coarse values, so a PEER card cannot show this distinction and should keep saying
   * "Idle" — a peer cannot act on it, the operator can.
   * ⚠ Optional: an older main omits it, and the honest fallback is today's label, "Idle".
   */
  listening?: boolean;
  /**
   * Epoch ms this agent ENDED, or `null` while it is live (2026-08-22).
   *
   * ⚠ AN ENDED AGENT KEEPS ITS CARD FOR SEVEN DAYS and this is the clock behind it. Retention
   * is DURABLE (`dopl-desktop-app/main/agent-history.js` — it survives a restart, which the
   * old in-memory `MAX_ENDED` set did not) and UNIVERSAL (every end, not only the
   * abandonment). At `endedAt + 7d` the desktop sweeps the history and the row simply stops
   * being reported, so the card disappears on its own.
   * ⚠ THE CARD IS A TOMBSTONE, NOT A HANDLE. An ended agent is gone from main's registry, so
   * every wake path refuses it: it cannot be fed, messaged, @-mentioned into life, resumed or
   * reopened as a session. What it opens is a READ-ONLY history.
   * ⚠ Optional: an older main omits it. Absent means "no end recorded", not "ended long ago".
   */
  endedAt?: number | null;
  channelName: string | null;
  /**
   * **WHICH WORKSPACE THIS SESSION'S CHANNEL BELONGS TO** (2026-09-14).
   *
   * ⚠ **THE DEFECT IT CLOSES IS A ROUTE BUILT OUT OF THE WRONG HALF.** The agent window's rail
   * lists RUNNING agents across every channel on this machine, and a click asks main to open
   * that agent's tab — but the route is `#/w/<segment>/…` and the only segment the window had
   * was its OWN. A rail row for an agent in another workspace therefore routed into the
   * CURRENT workspace's segment: the page loads, the channel is not there, and the operator
   * gets a not-found for an agent that is running.
   *
   * ⚠ **`null` IS "THIS MAIN DOES NOT REPORT IT", AND EVERY READER MUST TREAT IT AS UNKNOWN
   * RATHER THAN AS "MINE"** (INVARIANTS §11). A caller resolving a segment falls back to its
   * own window's only when the two are known-equal; guessing the current one on an absence is
   * the bug restated.
   * ⚠ **AN ID, NEVER A SEGMENT.** The slug is a workspace's display-ish name and it can be
   * renamed; the id is what the roster read (`GET /api/workspaces`) keys on, and resolving
   * id → segment is the RENDERER's job with a list it already has.
   */
  workspaceId?: string | null;
  threadTitle: string | null;
  /**
   * The AGENT IDENTITY this session was launched as, by NAME (2026-08-22).
   *
   * ⚠ A DENORMALIZED SNAPSHOT, never a pointer, and it can never change: the
   * identity is resolved ONCE at spawn (`main/identity-resolve.js`) and the
   * session keeps what it RAN AS even after that identity is renamed or deleted.
   * Frozen with the rest of the identity when the agent ends.
   * ⚠ THE NAME, NEVER THE ID. An id here would be ownership information on a
   * surface that only ever wanted a label.
   * ⚠ `null` IS A REAL ANSWER — a blank agent has no identity — and optional
   * because an older main omits the field entirely. Absent and `null` mean the
   * same thing.
   * ⚠ ON THE SERVER SIDE THE SAME FACT IS OPERATOR-ONLY. `channel_sessions
   * .identity_name` never reaches a peer's projection: a private identity's name
   * on a colleague's card is an existence oracle, which is exactly what
   * 404-not-403 and the deliberate absence of name uniqueness both exist to
   * close. This field is the OPERATOR's own view of their OWN machine, which is
   * a different question.
   */
  identityName?: string | null;
  /**
   * **THIS AGENT'S COLOUR IN ITS CHANNEL — the key it ASKED FOR** (2026-09-13;
   * docs/specs/agent-colors.md), emitted by `main/session-summary.js › liveSummary`.
   *
   * ⚠ **AN ASK, NOT THE ASSIGNMENT, AND THE DIFFERENCE IS THE WHOLE FIELD.** Uniqueness is per
   * channel across EVERY member, which no machine can evaluate — two desktops cannot see each
   * other's registries — so the SERVER resolves it (`channels/server/session-colors.ts ›
   * resolveReportedColors`) and may have substituted the next free key. What this carries is what
   * this machine requested at launch and has held since.
   * ⚠ **SO THE PEER PROJECTION OUTRANKS IT WHEREVER BOTH EXIST**, which is the precedence
   * `channels/lib/live-agents.ts › liveAgentsKey` already states and enforces. The one place this
   * value is read alone is the agent window's own New-agent popup, which reads NO projection at
   * all: an advisory taken set there beats no taken set, and the server's 409 is the correction.
   * ⚠ **A STRING, NARROWED BY THE READER** (`channels/lib/agent-colors.ts › agentColorOrNull`),
   * not the closed union: `src/shared/` may not import `features/channels`, and a union here would
   * also let a newer desktop's seventeenth key typecheck its way past the one membership test.
   * ⚠ `null`/absent IS "no colour reported" and NEVER "no colour": an older main omits it, and the
   * push cannot erase a stored key by omission.
   */
  color?: string | null;
  // ── THE AGENT-VIEW NUMBERS (wiring plan Phase 5, 2026-08-18) ───────────────
  //
  // ⚠ **"Runtime metrics the SERVER STORES NONE OF" IS WHAT THIS BLOCK SAID
  // UNTIL 2026-08-22, AND IT IS NOW FALSE.** `channel_sessions` grew a column
  // per number in migration `20260822150000` (`context_used`, `context_window`,
  // `tokens_spent`, `started_at`, `last_activity_at`), because an orchestrator
  // driving agents over MCP is not on the machine that measured them and had no
  // way to ask. The sentence was true when it was written — the wire shape had
  // been widened and the push had not — and it stopped being true when the push
  // was.
  //
  // ⚠ THEY ARE **OPERATOR-ONLY** ON THE FAR SIDE. What used to keep them off a
  // peer's card was that they were nowhere to read; what keeps them off it now
  // is `server/collab-dto.ts › mapPeerSessionStateRow`, which builds the coarse
  // projection and never names them (the column GRANT in that migration is the
  // belt, not the fence — every server read runs on the admin client). A peer
  // sees a handle and a state; never what an agent costs its operator.
  //
  // ⚠ UNITS DO NOT SURVIVE THE CROSSING UNCHANGED, and this is the one thing to
  // get right on the push side: `startedAt` / `lastActivityAt` are EPOCH MS
  // here, and the columns are `TIMESTAMPTZ` with an ISO-8601 wire schema
  // (`schema-sessions.ts`). The desktop converts; a raw epoch number sent as
  // either field is a zod failure that 400s the whole report.
  //
  // ⚠ `null` IS A REAL ANSWER EVERYWHERE BELOW and never means zero — an older
  // main omits the field entirely, a model this build has no window for has no
  // denominator, and nothing is measured before the first turn reports usage.
  // Render the absence; do not default it to 0 (INVARIANTS §11 — UNKNOWN is not
  // EMPTY). The columns are NULLABLE WITH NO DEFAULTS for exactly this reason,
  // and the migration's assertion block aborts if one acquires a default.
  /** Tokens occupying the context window: the prompt the model LAST saw. Falls
   *  after a compaction — this is occupancy, not spend. */
  contextUsed?: number | null;
  /** That model's window size, or null when this build has no row for it. */
  contextWindow?: number | null;
  /** LIFETIME tokens billed, output included — a different question from
   *  `contextUsed`, and monotonic across park/resume. */
  tokensSpent?: number | null;
  /** Epoch ms. When the desktop created this session object. */
  startedAt?: number | null;
  /** Epoch ms of the last engine state change. */
  lastActivityAt?: number | null;
}
