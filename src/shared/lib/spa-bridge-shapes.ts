/**
 * THE WIRE SHAPES MAIN EMITS — one live session, and one line of an agent's work.
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
 * ⚠ ADDITIVE-ONLY, both of them. An older main omits fields it has not shipped yet, so every
 * optional member's absence has to have an honest fallback stated at the member itself. That rule
 * is why so much of this file is prose rather than declarations.
 */

/**
 * ONE LIVE SESSION as the desktop projects it — wire shape emitted by
 * `dopl-desktop-app/main/session-summary.js`. **The AGENTS TAB renders from
 * these** (`components/channels-v2/agents-tab.tsx` over `› agents-model.ts`,
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
   * THE LIVE PERMISSION POSTURE (2026-08-20) — what this RUNNING session is
   * actually on, so the agent view's controls can show the value they set.
   *
   * ⚠ THE REDUCER'S STATE, NOT THE CHANNEL'S STORED LAUNCH POSTURE. Different
   * facts: the launch posture governs the next spawn, this is where the session
   * has been moved to since. A control that read the stored one would go wrong
   * the moment either is changed without the other — which is the normal case,
   * since the whole point of these controls is to move a session off what it
   * launched on.
   * ⚠ `null` on an ENDED session (nothing to change), absent on an older main.
   */
  toolMode?: "manual" | "accept_edits" | "auto" | "bypass" | null;
  messageMode?: "ask" | "auto_inbound" | "auto_outbound" | "auto_both" | null;
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
  threadTitle: string | null;
  /**
   * The AGENT TEMPLATE this session was launched as, by NAME (2026-08-22).
   *
   * ⚠ A DENORMALIZED SNAPSHOT, never a pointer, and it can never change: the
   * template is resolved ONCE at spawn (`main/template-resolve.js`) and the
   * session keeps what it RAN AS even after that template is renamed or deleted.
   * Frozen with the rest of the identity when the agent ends.
   * ⚠ THE NAME, NEVER THE ID. An id here would be ownership information on a
   * surface that only ever wanted a label.
   * ⚠ `null` IS A REAL ANSWER — a blank agent has no template — and optional
   * because an older main omits the field entirely. Absent and `null` mean the
   * same thing.
   * ⚠ ON THE SERVER SIDE THE SAME FACT IS OPERATOR-ONLY. `channel_sessions
   * .template_name` never reaches a peer's projection: a private template's name
   * on a colleague's card is an existence oracle, which is exactly what
   * 404-not-403 and the deliberate absence of name uniqueness both exist to
   * close. This field is the OPERATOR's own view of their OWN machine, which is
   * a different question.
   */
  templateName?: string | null;
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

/**
 * ONE LINE OF AN AGENT'S WORK — the wire shape
 * `dopl-desktop-app/main/session-narration.js › entryFor` emits.
 *
 * ⚠ EVERY FIELD IS ALREADY-SUMMARIZED DISPLAY TEXT, bounded on the main side.
 * `inputFull` deliberately never enters a ring entry: it is unbounded by
 * construction (it can carry an entire file), and this feed crosses to a
 * renderer.
 */
export interface DesktopNarrationEntry {
  /** Epoch ms. */
  at: number;
  /**
   * ⚠ THE VOCABULARY IS CLOSED, AND THREE KINDS JOINED IT ON 2026-08-22. Read it as FOUR
   * AUDIENCES rather than four stylings — collapsing any pair makes the view claim something
   * was shared when it was not, or the reverse:
   *
   * - `thinking`      the model's own reasoning for this step. Addressed to nobody. **Collapse
   *                   it by default** — it is the longest and least load-bearing kind.
   * - `assistant`     the agent narrating a PUBLIC turn (one worked from a channel message).
   * - `operator`      the OPERATOR spoke to this agent 1:1, over `sessions.message`. It was
   *                   never posted anywhere and nobody else can see it. `text` is what they
   *                   TYPED, not the framed prompt the model received. Carries
   *                   `lane: "operator"`.
   * - `private`       the agent's answer to a PRIVATE turn — the turn's final text, for the
   *                   operator alone; `lane: "private"`. ⚠ Never posted: while a private turn
   *                   is active main withdraws the auto-send widening, so a post would have to
   *                   pass the outbound consent gate first (INVARIANTS §11).
   * - `tool`          a tool call, with its RAW name and a bounded input summary.
   * - `result`        how that call came back.
   * - `post`          the agent SENT a message into the channel or thread; `lane: "channel"`.
   *                   ⚠ This one LEFT THE MACHINE — the other member has it. A `post` inside a
   *                   private turn is still a `post`, deliberately: it is the one thing that
   *                   did not stay private, and re-labelling it would hide that. Treat it as a
   *                   LOCAL ECHO and dedupe it against the real transcript row once that
   *                   exists; it covers the window before the transcript has loaded.
   * - `status`        a phase move worth a line (paused, ended, waiting on a permission).
   * - `directed`      **ANOTHER OF THIS OPERATOR'S AGENTS spoke to this one, 1:1** (2026-08-31,
   *                   the private direct lane). It arrives on the same `steer` an operator turn
   *                   does and is NOT one — rendering it as `operator` puts words in the
   *                   operator's mouth on their own screen, wearing their avatar. Carries
   *                   `lane: "directed"`.
   * - `directed-reply` this agent's ANSWER to that direction — `retagDirected` narrows a
   *                   `private` line, so it is private traffic with one extra fact attached:
   *                   whose question it answers. Carries `lane: "directed"` too.
   *
   * ⚠ RENDER AN UNKNOWN KIND AS NOTHING, never as a fallback bubble: main's vocabulary can
   * gain a member before this build knows it, and a mystery line in a work lane is worse than
   * a missing one.
   *
   * ⚠ **NEITHER DIRECTED KIND CARRIES THE COUNTERPARTY'S IDENTITY, AND NOTHING UPSTREAM HOLDS
   * ONE** (measured 2026-08-31 — F-376). `channel_agent_directions.agent_id` is the ADDRESSEE;
   * the row has no sender column, `DirectionCreateSchema` has no sender field, and
   * `agent-direction-wire.js › directionFrom` therefore has nothing to carry. So the SPA's
   * face names the RELATION ("your agent") rather than an agent, and the name slot stays empty
   * until a sender identity exists end to end.
   */
  kind:
    | "thinking"
    | "assistant"
    | "operator"
    | "private"
    | "tool"
    | "result"
    | "post"
    | "status"
    | "directed"
    | "directed-reply";
  /**
   * ⚠ WHO CAN SEE THIS LINE — **and it OUTRANKS `kind`** (2026-08-22). Audience is a fact, not
   * something a renderer should infer from a word:
   * - `"operator"` the operator said it, 1:1. Private.
   * - `"private"`  the agent said it, 1:1, to the operator. Private.
   * - `"channel"`  it LEFT THE MACHINE — the other member has it.
   * - `"directed"` **the private direct lane** (2026-08-31): one of the operator's OTHER agents
   *   said it, or this agent answered it. Private, like `operator`/`private`, and marked apart
   *   from them because the VOICE is neither the operator's nor an unprompted turn.
   *
   * ⚠ **`"directed"` NAMES THE LANE, NOT THE DIRECTION** — inbound and outbound share it, and
   * only `kind` (`directed` vs `directed-reply`) says which. That does not weaken the rule
   * below: the two kinds differ in SPEAKER, never in AUDIENCE, so a kind rename can still not
   * change who could see the line. `channels-v2/agent-stream-model.ts › frameLane` is the one
   * reader that splits them.
   *
   * A kind can be renamed, aliased or added; this cannot drift into meaning something else, so
   * a future rename can neither leak a private reply into a public-looking face nor dress a
   * real channel post as private (which would hide that it was shared).
   * ⚠ **ABSENT on the narration kinds** (`thinking` / `assistant` / `tool` / `result` /
   * `status`) — deliberately: they went nowhere and have no audience to be wrong about. Absent
   * is not `"channel"`.
   */
  lane?: "operator" | "private" | "channel" | "directed";
  /** On `tool` and `result` — what joins a result to the call it answers. */
  toolUseId?: string;
  /** The RAW tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  /**
   * The line itself, already bounded main-side, and the bound is THREE numbers because they are
   * three kinds of string (`main/session-narration.js`): **300 for a CAPTION** (a tool's input
   * or result summary — the input already 140 before that — and the status lines), **1000 for a
   * `post`** (a MESSAGE, but one the transcript is the real record of, and the UI dedupes it),
   * and **8000 for the agent's own PROSE** — `assistant` / `thinking` / the operator's 1:1 text,
   * where this ring is the only copy that exists anywhere.
   * ⚠ **8000 IS THE UI's OWN EXPANDED CEILING** (`channels-v2/agent-stream-log.tsx ›
   * EXPANDED_CHARS`), and that is the point of the number: prose was capped at 300 until
   * 2026-08-27, so "Show more" raised a display clamp over a string main had already cut
   * mid-word, with nothing saying so. **A cap below what the UI will show is a silent lie.**
   * (2000 until 2026-08-31; it is `main/session-directed.js › REPLY_CAP`'s 8000 now, so the
   * panel never shows the operator LESS of a private reply than the MCP mailbox carries away.)
   * ⚠ **Truncate further in the UI** — these caps exist so the IPC frame stays small (the ring
   * is 200 deep and multiplied by the concurrent-session ceiling), not because they are display
   * lengths.
   */
  text?: string;
  /**
   * ⚠ ON THE PROSE KINDS ONLY — **main CUT this line at its own cap, and the tail exists
   * nowhere** (2026-08-31, Samuel's cutoff report). The prose cap deliberately EQUALS the UI's
   * expanded ceiling, so the renderer's own `length > EXPANDED_CHARS` clip check is false on
   * every line main shortened — this flag is the only way the reader can ever be told, and for
   * prose there is no second copy to go read (INVARIANTS §9: a clipped read says so).
   *
   * ⚠ **ABSENT MEANS "ARRIVED WHOLE", NOT "UNKNOWN"** — the same discipline `pending` states:
   * only an explicit `true` counts, every main that predates the field emits nothing, and a
   * renderer must treat `truncated !== true` as an uncut line.
   */
  truncated?: boolean;
  /**
   * ⚠ ON `directed` ONLY — **WHICH of this operator's agents filed the direction** (F-376a,
   * 2026-08-31). An 8-char agent instance id (`main/agent-id.js › AGENT_ID_RE`), shape-gated
   * twice on the way here, which the renderer resolves to a display name exactly as it does for
   * any other agent id on this surface.
   *
   * 🔒 **IT IS A CAPTION AND IT IS UNVERIFIED. NOTHING MAY GATE, ROUTE, FILTER OR AUTHORIZE ON
   * IT.** The server derives it from the third segment of `X-Dopl-Session-Id` — a documented
   * NON-authorization header (INVARIANTS §10: *"nothing may be GRANTED on it"*) that anything
   * holding the operator's device token can set. It is exactly as trustworthy as
   * `metadata.session_id`: good enough to tell two of your OWN agents apart on your OWN screen,
   * worth nothing as a claim. The fence on this lane is `operatorUserId`, compared in
   * `main/session-reopen.js › messageByTask`, and it is untouched by this field's presence.
   *
   * ⚠ **ABSENT MEANS "AN EXTERNAL ORCHESTRATOR", WHICH IS THE ORDINARY CASE** — Claude Desktop,
   * Claude Code and every other MCP client that is not a spawned desktop session sends no
   * session stamp and has no agent id to send. It is ALSO what an older main and an older server
   * emit, and both read correctly as the same thing. **The fallback is the sentence this surface
   * showed before the field existed — "your agent" — never a placeholder id and never blank.**
   */
  senderAgentId?: string;
  /**
   * ⚠ ON `post` ONLY — **this post has NOT left the machine** (2026-08-25, Samuel's
   * outbound-review ruling). The outbound consent gate is holding it and a human has to press
   * Post before it goes (INVARIANTS §6). `session-io.js › sdkRenderEvents` stamps it from
   * `willGatePost` at the moment the agent CALLS the tool, which is long before any row settles.
   *
   * ⚠ **ABSENT MEANS "NOT GATED", NOT "UNKNOWN"** — every main that predates this field emits a
   * `post` frame only for a post it was free to send, so an older build reads correctly as
   * `undefined`. A renderer must therefore treat `pending !== true` as SENT, never as a third
   * state.
   *
   * ⚠ IT IS NOT A STATUS AND IT NEVER CLEARS. The ring entry is written once and main does not
   * revisit it, so a frame stays `pending` after the operator posts — the SERVER's record is what
   * says it landed (`agent-stream-model.ts` dedupes a pending frame against the real transcript
   * row, exactly as it does an ordinary echo).
   */
  pending?: boolean;
}
