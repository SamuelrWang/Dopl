"use client";

/**
 * THE one detector for the bundled-SPA bridge, shared by every web-tree SPA-mode
 * guard (api-client transport, realtime no-ops, identity hooks, app origin).
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS. `window.dopl` is NOT unique to the
 * bundled SPA: the LEGACY desktop wrapper (every pre-1.8 install, reachable via
 * DOPL_UI=remote) loads this live web app and exposes `window.dopl` with NO
 * apiRequest. A truthiness check bricked the wrapper with `bridge.apiRequest is
 * not a function`. Identify the SPA by the capability about to be used.
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

export interface SpaBridgeSurface {
  apiRequest(
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      workspaceId?: string;
      expectedUpdatedAt?: string;
    }
  ): Promise<{ status: number; statusText: string; hasBody: boolean; body?: unknown }>;
  getAuthState(): Promise<{ signedIn: boolean; userId: string | null }>;
  onAuthState?(cb: (s: { signedIn: boolean; userId: string | null }) => void): () => void;
  openExternal(url: string): Promise<{ ok: boolean }>;
  /** Remote image → `data:` URI, proxied by main (null = refused/failed).
   *  ⚠ Mirrored in `apps/desktop-ui/src/lib/dopl-bridge.ts`. Optional — an older
   *  main has no handler and the caller falls back to initials. */
  avatarDataUri?(url: string): Promise<string | null>;
  appOrigin?: string;
  syncWatch?(workspaceId: string | null): Promise<unknown>;
  onSyncEvent?(cb: (e: { workspaceId: string; table: string }) => void): () => void;
  /** THE OPERATOR'S OWN AGENTS.
   *  ⚠ "SHARED BY BOTH PRELOADS" / "SPA-ONLY" IS RETIRED (2026-08-20): the remote
   *  preload is deleted and orphaned, so there is only one preload left and
   *  nothing for these to be narrower than. **The inventory is
   *  `test/preload-parity.test.mjs › APP_OPS`**, executed against a fake
   *  `electron` rather than grepped, and it fails on ADD as well as REMOVE.
   *  ⚠ ALL feature-detected at the call site — an older main has none and the
   *  Agents tab says the surface is desktop-only, same as a plain browser.
   *  ⚠ THREE PLACES MUST STAY IN SYNC: this type, the runtime contract
   *  `renderer/app-preload.js`, and `apps/desktop-ui/src/lib/dopl-bridge.ts` —
   *  plus that pin (INVARIANTS §11).
   *
   *  ⚠ `pause` / `end` ARE OWN-AGENTS-ONLY, and that is structural rather than
   *  checked: main resolves the (channel, thread) pair against ITS OWN session
   *  registry, which holds nothing but this operator's sessions on this machine.
   *  Nobody pauses another member's agent, and a peer's paused agent reads as
   *  inactive PRESENCE on their side, never as a stalled thread. */
  sessions?: {
    /** ⚠ `segment` is OPTIONAL and joined 2026-08-20: a live WINDOWLESS session
     *  reopens as the AGENT WINDOW, whose landing is a router path. */
    reopen(
      channelId: string,
      taskId: string,
      segment?: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /**
     * THE AGENT WINDOW (F-212's closure) — a second window on this bundle
     * showing one of MY agents: its live work, what it sent, and a composer.
     * ⚠ ASKS FOR A WINDOW; DOES NOT GET ONE. No handle comes back — main creates
     * and registers it (`main/app-windows.js`), which is what makes the widened
     * sender binding safe.
     */
    openAgentWindow?(
      segment: string,
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /**
     * ⚠ THE ONE OP ON THIS BRIDGE THAT STARTS A TURN. The operator speaking to
     * their OWN agent, out of band — never a channel post, and the agent is told
     * so.
     *
     * ⚠ IT STARTS A **PRIVATE TURN** (2026-08-22, Samuel's ruling), and that is
     * ENFORCED, not merely framed. For the duration of the turn main WITHDRAWS
     * AXIS B's outbound widening, so any `dopl_channel` post or milestone the
     * agent attempts reaches the OUTBOUND CONSENT GATE instead of auto-sending —
     * whatever the channel's auto-send setting says. An accidental public answer
     * to a private question is therefore impossible; a post the operator ASKED
     * for is still possible, held for their approval. Reads are untouched.
     * The reply arrives on the narration feed as `private-reply`, and the
     * operator's own message as `private-in`. Main resolves (channel, thread) against its own registry (own-agents-
     * only, structurally), delimits the text with that session's nonce carrying
     * OPERATOR authority, and dispatches the same `steer` the session window's
     * composer always did. It grants no tool, widens no posture, reaches no
     * other machine, and cannot post without the outbound gate.
     */
    message?(
      channelId: string,
      taskId: string,
      text: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /**
     * Move a LIVE session's permission posture. Applies from the very next gate
     * decision — `session-io.js › grantArgs` reads both axes off the reducer
     * state at CALL time, so moving that state IS the change.
     *
     * ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT: the axes decide whether the
     * operator is ASKED; the profile decides what is reachable at all, is
     * checked first, and no posture can widen it. The answer carries MAIN's own
     * post-dispatch values, never an echo of the request — the reducer coerces
     * fail-closed and a renderer that stamped its own ask would show a posture
     * nothing is enforcing.
     */
    setMode?(
      channelId: string,
      taskId: string,
      axis: "tools" | "messages",
      mode: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string; tools?: string; messages?: string }>;
    /** The agent's WORK RING — its own text, its tool calls with names, their
     *  results, what it posted. Read once on mount, then listen; a push-only
     *  surface leaves a freshly opened window blank until the next event. */
    narration?(
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ entries: DesktopNarrationEntry[] }>;
    /** ⚠ Frames are keyed by `sessionKey` and fan out to EVERY app window — the
     *  reader filters. Main tracks no subscriptions, so the two sides cannot go
     *  out of step. */
    onNarration?(
      cb: (e: { sessionKey: string; entries: DesktopNarrationEntry[] }) => void
    ): () => void;
    summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
    onSummaries?(cb: (e: { sessions: DesktopSessionSummary[] }) => void): () => void;
    /**
     * NEW AGENT on a thread, windowless. The click IS the consent — own agent,
     * own thread, no consent row — and MAIN owns the posture
     * (`session-ipc-ops.js › sessions:launch`, the ONE consumer of the channel's
     * durable launch posture).
     *
     * ⚠ IT RETURNS AN ADDRESS (2026-08-21, ruling 3): `agentId` is the identity
     * of the agent just created, and it is what every other op here takes to
     * name it. Call it twice and you have two agents on that thread, each with
     * its own id; there is no `busy` refusal any more.
     * ⚠ IT STARTS NOTHING. The agent is registered IDLE with prepared context
     * and NO first SDK turn — no `claude` child runs until the first message for
     * that agent lands in the thread, which then launches it with the full
     * framing plus that message. Ordinary idle timers apply from the spawn.
     * ⚠ `counterpartyId` is OPTIONAL now: it labels the outbound consent card
     * and no longer fences which messages reach the session (that is the thread,
     * `main/session-dispatch.js`).
     */
    launch?(payload: {
      channelId: string;
      /**
       * ⚠ NULLABLE SINCE 2026-08-21 (Samuel's CHANNEL-LEVEL AGENT ruling). A thread id
       * attaches the agent to that exchange; `null` attaches it to the CHANNEL, where its
       * feed is the MAIN ROOM (untagged posts) and its replies are main-room posts. Both
       * are the same three-part session key — the channel-level one just carries an empty
       * middle segment (`<channelId>::<agentId>`).
       *
       * ⚠ PASS `null`, NOT `""`, FOR A CHANNEL-LEVEL AGENT. Main accepts both and they land
       * on the same scope, but `""` is the LEGACY wire value for a responder whose exchange
       * never became a first-class thread — keeping them spelled apart is what lets a later
       * reader tell "attached to the room on purpose" from "never got a thread".
       */
      taskId: string | null;
      workspaceId?: string;
      channelName?: string;
      threadTitle?: string | null;
      counterpartyId?: string | null;
      direct?: boolean;
    }): Promise<{
      ok: boolean;
      agentId?: string;
      sessionId?: string | null;
      reason?: string;
    }>;
    /** Interrupt the turn in flight, from the Agents tab. The session stays live,
     *  resumable and named. ⚠ Name the `agentId` when a thread holds more than
     *  one agent — omitted, this pauses the OLDEST live one. */
    pause?(
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** End the AGENT. Terminal for the session, and it touches NO thread: a
     *  thread has no finished state (INVARIANTS §5).
     *  ⚠ ENDED IS DEAD (2026-08-22): the agent leaves main's registry, so every later
     *  `message` / `pause` / `setMode` / `reopen` naming it answers
     *  `{ ok: false, reason: "no-session" }`, and a thread message @-mentioning its id is
     *  neither fed nor queued. Its CARD survives 7 days as a read-only history. */
    end?(
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /**
     * ⚠ CALL THIS AFTER A THREAD DELETE SUCCEEDS (2026-08-22). Main cannot observe the
     * server's delete cascade, so without it an ended agent's frozen history outlives its
     * thread by up to seven days and renders a card with a stale title over a window whose
     * exchange is gone.
     * ⚠ IT DELETES A LOCAL VIEW, NEVER A CONVERSATION — `channel_messages` are the server's
     * and are unreachable from here. It also cannot touch a LIVE session; end those first.
     */
    forgetThread?(
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; forgotten?: number }>;
  };
}

/** The bundled-SPA bridge, or null — including on the legacy wrapper,
 *  whose partial `window.dopl` must never be mistaken for it. */
export function getSpaBridge(): SpaBridgeSurface | null {
  if (typeof window === "undefined") return null;
  const b = (window as { dopl?: Partial<SpaBridgeSurface> }).dopl;
  // ⚠ `apiRequest` alone is the SPA marker — the legacy wrapper's partial
  // window.dopl never has it. Optional members stay feature-detected at their
  // call sites.
  if (b && typeof b.apiRequest === "function") {
    return b as SpaBridgeSurface;
  }
  return null;
}

/** True only in the bundled SPA renderer. */
export function isSpaRenderer(): boolean {
  return getSpaBridge() !== null;
}
