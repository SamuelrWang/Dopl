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
  /** Friendly handle ("flint"). Per channel, stable across park/resume. */
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
  kind: "assistant" | "tool" | "result" | "post" | "status";
  /** On `tool` and `result` — what joins a result to the call it answers. */
  toolUseId?: string;
  /** The RAW tool name on a `tool` entry; the renderer shortens it. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
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
  /** THE OPERATOR'S OWN AGENTS. `reopen` is SHARED by both preloads (one reopen
   *  path in main); `summaries` / `onSummaries` / `pause` / `end` are SPA-ONLY.
   *  ⚠ ALL feature-detected at the call site — an older main has none and the
   *  Agents tab says the surface is desktop-only, same as a plain browser.
   *  ⚠ THREE PLACES MUST STAY IN SYNC: this type, the runtime contract
   *  `renderer/app-preload.js`, and `apps/desktop-ui/src/lib/dopl-bridge.ts` —
   *  plus `test/preload-parity.test.mjs`, which fails on ADD (INVARIANTS §11).
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
      segment?: string
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
      taskId: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /**
     * ⚠ THE ONE OP ON THIS BRIDGE THAT STARTS A TURN. The operator speaking to
     * their OWN agent, out of band — never a channel post, and the agent is told
     * so. Main resolves (channel, thread) against its own registry (own-agents-
     * only, structurally), delimits the text with that session's nonce carrying
     * OPERATOR authority, and dispatches the same `steer` the session window's
     * composer always did. It grants no tool, widens no posture, reaches no
     * other machine, and cannot post without the outbound gate.
     */
    message?(
      channelId: string,
      taskId: string,
      text: string
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
      mode: string
    ): Promise<{ ok: boolean; reason?: string; tools?: string; messages?: string }>;
    /** The agent's WORK RING — its own text, its tool calls with names, their
     *  results, what it posted. Read once on mount, then listen; a push-only
     *  surface leaves a freshly opened window blank until the next event. */
    narration?(
      channelId: string,
      taskId: string
    ): Promise<{ entries: DesktopNarrationEntry[] }>;
    /** ⚠ Frames are keyed by `sessionKey` and fan out to EVERY app window — the
     *  reader filters. Main tracks no subscriptions, so the two sides cannot go
     *  out of step. */
    onNarration?(
      cb: (e: { sessionKey: string; entries: DesktopNarrationEntry[] }) => void
    ): () => void;
    summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
    onSummaries?(cb: (e: { sessions: DesktopSessionSummary[] }) => void): () => void;
    /** Attach MY OWN agent to a thread, windowless (2026-08-20). The click IS the
     *  consent — own agent, own thread, no consent row — and MAIN owns the
     *  posture (`channel-dir-ipc.js › sessions:launch`, the ONE consumer of the
     *  channel's durable launch posture). */
    launch?(payload: {
      channelId: string;
      taskId: string;
      workspaceId: string;
      channelName: string;
      threadTitle: string | null;
      counterpartyId: string | null;
      direct: boolean;
    }): Promise<{ ok: boolean; sessionId?: string; reason?: string }>;
    /** Interrupt the turn in flight, from the Agents tab. The session stays live,
     *  resumable and named. */
    pause?(channelId: string, taskId: string): Promise<{ ok: boolean; reason?: string }>;
    /** End the AGENT. Terminal for the session, and it touches NO thread: a
     *  thread has no finished state (INVARIANTS §5). */
    end?(channelId: string, taskId: string): Promise<{ ok: boolean; reason?: string }>;
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
