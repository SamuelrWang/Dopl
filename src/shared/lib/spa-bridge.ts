"use client";

import type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";

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
 * ⚠ THE TWO WIRE SHAPES MOVED TO `./spa-bridge-shapes` ON 2026-08-22 (the 500-line cap;
 * `DesktopSessionSummary` and `DesktopNarrationEntry` were 230 lines of FIELD prose in a file
 * about the bridge's OPS). They are RE-EXPORTED here because this is the IMPORT PATH OF RECORD —
 * the web tree and the `apps/desktop-ui` mirror both take them from `@/shared/lib/spa-bridge`, and
 * a second canonical path for one type is how two trees come to disagree.
 */
export type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";


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
    /**
     * SWITCH A LIVE SESSION'S MODEL (2026-08-22, Samuel's model-selection ruling).
     *
     * ⚠ IT REALLY SWITCHES, rather than deferring to the next launch: the bundled
     * SDK exposes `Query.setModel`, documented as available in STREAMING INPUT
     * MODE, and every session in this tree runs in that mode by construction. The
     * change applies from the agent's next response. Main also RECORDS the pick,
     * so a park/resume, a crash resume or the post-sign-in relaunch keeps it — a
     * switch that only told the SDK would silently revert.
     *
     * `model` is one of FOUR ids: `"claude-fable-5"`, `"claude-opus-5"`,
     * `"claude-sonnet-5"`, `"claude-haiku-4-5-20251001"`. ⚠ ANYTHING ELSE — a
     * typo, an empty string, a model this desktop build has not heard of — CLEARS
     * the override rather than being refused, because "let the CLI choose" is a
     * legitimate thing to ask for and is what an unset channel already does. So
     * the answer is `{ ok: true }` with `model` reporting what main actually
     * applied, which will be `"default"` in that case: **render MAIN's value,
     * never an echo of the request.**
     *
     * ⚠ IT IS NOT `channels.setLaunchPosture`, whose `model` field governs the
     * NEXT spawn. Different facts, and both exist for the same reason the two
     * permission axes do: a session can be moved off what it launched on.
     * ⚠ It grants nothing, gates nothing and reaches no tool decision — the
     * permission table never reads a model.
     */
    setModel?(
      channelId: string,
      taskId: string,
      model: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string; model?: string }>;
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
