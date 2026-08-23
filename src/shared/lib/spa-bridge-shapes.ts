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
  state: "working" | "idle" | "ended";
  /**
   * WHAT IT IS DOING RIGHT NOW, one step finer than the pill (2026-08-20).
   * Derived by `dopl-desktop-app/main/session-detail.js › detailFor` from the
   * reducer event that last moved the session, and LOCAL-ONLY — it never reaches
   * `channel_sessions` (`session-state-push.js › reportRow` picks its columns by
   * name), so a peer's card never sees it.
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
   *  degrades to "Running a command" rather than to a blank. */
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
   * ⚠ LOCAL-ONLY: it never reaches `channel_sessions` (`session-state-push.js ›
   * reportRow` picks its columns by name), so a PEER's card never carries it.
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
  // ── THE AGENT-VIEW NUMBERS (wiring plan Phase 5, 2026-08-18) ───────────────
  // Runtime metrics the SERVER STORES NONE OF: `session-state-push.js › rowFor`
  // picks its columns by name, so widening this wire shape did not widen
  // `channel_sessions`. They exist only while the desktop that measured them is
  // running, which is exactly the scope of the Agents tab.
  //
  // ⚠ `null` IS A REAL ANSWER EVERYWHERE BELOW and never means zero — an older
  // main omits the field entirely, a model this build has no window for has no
  // denominator, and nothing is measured before the first turn reports usage.
  // Render the absence; do not default it to 0 (INVARIANTS §11 — UNKNOWN is not
  // EMPTY).
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
   *
   * ⚠ RENDER AN UNKNOWN KIND AS NOTHING, never as a fallback bubble: main's vocabulary can
   * gain a member before this build knows it, and a mystery line in a work lane is worse than
   * a missing one.
   */
  kind:
    | "thinking"
    | "assistant"
    | "operator"
    | "private"
    | "tool"
    | "result"
    | "post"
    | "status";
  /**
   * ⚠ WHO CAN SEE THIS LINE — **and it OUTRANKS `kind`** (2026-08-22). Audience is a fact, not
   * something a renderer should infer from a word:
   * - `"operator"` the operator said it, 1:1. Private.
   * - `"private"`  the agent said it, 1:1, to the operator. Private.
   * - `"channel"`  it LEFT THE MACHINE — the other member has it.
   *
   * A kind can be renamed, aliased or added; this cannot drift into meaning something else, so
   * a future rename can neither leak a private reply into a public-looking face nor dress a
   * real channel post as private (which would hide that it was shared).
   * ⚠ **ABSENT on the narration kinds** (`thinking` / `assistant` / `tool` / `result` /
   * `status`) — deliberately: they went nowhere and have no audience to be wrong about. Absent
   * is not `"channel"`.
   */
  lane?: "operator" | "private" | "channel";
  /** On `tool` and `result` — what joins a result to the call it answers. */
  toolUseId?: string;
  /** The RAW tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  /**
   * The line itself, already bounded main-side: **300 chars for every caption**, a `tool`
   * entry's input summary capped at 140 before that, and **1000 for a `post`** — that one is a
   * MESSAGE rather than a line about one, and a reply truncated at 300 makes the echo useless.
   * ⚠ **Truncate further in the UI** — these caps exist so the IPC frame stays small (the ring
   * is 200 deep and multiplied by the concurrent-session ceiling), not because they are display
   * lengths.
   */
  text?: string;
}
