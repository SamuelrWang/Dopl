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
  /**
   * THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) — may another
   * agent cause THIS MACHINE to spawn a session, with no click?
   *
   * ⚠ IT IS THE STANDING CONSENT FOR THE WHOLE `channel_launch_directives` LANE, and Samuel
   * ruled it as the replacement for "the click IS that human" there: a directive arrives with
   * no human attending, so the operator's prior decision on this machine has to BE the human.
   * Default **FALSE**. With it off, `main/launch-directives.js` reads a directive addressed to
   * this operator and ignores it SILENTLY — the row then expires server-side, visibly to the
   * orchestrator, which is a better answer than a refusal this machine has to be trusted to
   * send.
   *
   * ⚠ IT LIVES OUTSIDE THE SERVER ENTIRELY AND THAT IS THE SECURITY CONTENT, not a storage
   * detail. It is an `electron-store` boolean written by ONE `appWindowOnly` IPC pair
   * (`main/channel-dir-ipc.js › orchestrator:get/setLaunchEnabled`, storage
   * `main/channel-prefs.js › get/setOrchestratorLaunch`). **There is no route, no MCP op and no
   * `workspace_settings` column for it, deliberately.** A spawned session runs with `Bash` and
   * this operator's device token is on disk (§6), so any server-stored version of this flag
   * could be flipped by an agent holding the operator's own credential — arming every machine
   * they own. Never add a remotely-addressable writer.
   *
   * ⚠ IT DECIDES WHO MAY PRESS, NEVER WHAT IS ALLOWED. A directive-driven launch is exactly as
   * contained as a Launch-button one: the channel's durable posture still supplies both
   * permission axes, the channel's tool profile still bounds what is reachable, and
   * `session-profiles.js › SESSION_HARD_DENY` is unconditional either way.
   *
   * ⚠ FEATURE-DETECT BOTH MEMBERS, and read an absent bridge as OFF — an older main has no
   * toggle and a plain browser has no bridge, and in both cases the lane is not running.
   * ⚠ `set` ANSWERS MAIN'S OWN VALUE: `{ ok: false }` means the store did not end up holding
   * what was asked for, so an optimistic switch must REVERT rather than render a state nothing
   * is enforcing. Same rule `sessions.setMode` / `setModel` follow.
   */
  orchestratorLaunch?: {
    get(): Promise<{ enabled: boolean }>;
    set(enabled: boolean): Promise<{ ok: boolean; reason?: string; enabled?: boolean }>;
  };
  /**
   * SIGN THIS MAC IN TO CLAUDE CODE (2026-08-25) — the ONE entry into the auth
   * recovery flow, and the reason the "waiting for you to sign in" banner is now
   * answerable rather than merely true.
   *
   * ⚠ A SESSION RIDES A THIRD CREDENTIAL. Not the Dopl login and not the Claude
   * app login: the Claude Code credential held by THIS Mac. When it is missing or
   * expired the engine HOLDS the session instead of burning it
   * (`main/session-auth.js`), and until this op existed nothing could ever enter
   * the remedy — re-posting was refused with `auth-hold` forever.
   *
   * ⚠ ITS OWN NAMESPACE, because it takes no session and no channel: one
   * operator, one Mac, one credential.
   * ⚠ NO CREDENTIAL CROSSES THIS BRIDGE, and none is typed into a Dopl surface —
   * main opens the OAuth page in the SYSTEM BROWSER and collects the pasted code
   * in its own local window.
   * ⚠ `ok` REPORTS THE CREDENTIAL, NOT THE FLOW: it is true when this Mac can run
   * a session afterwards, whichever tier finished. A declined dialog, a failed
   * sign-in and a call from an unbound sender all answer `{ ok: false }` alike.
   * ⚠ ON SUCCESS MAIN HAS ALREADY RELEASED every session it was holding
   * (`session-auth.js › resumeHeldSessions`), so the next post reaches a live
   * agent with no second call from here.
   * ⚠ FEATURE-DETECT IT at the call site — an older main has no handler and a
   * plain browser has no bridge; the button must be ABSENT, never inert.
   */
  claude?: {
    signIn(): Promise<{ ok: boolean; resumed?: number }>;
  };
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
    /**
     * RENAME ONE AGENT — display only (2026-08-25). An EMPTY name CLEARS it, which is how the
     * operator goes back to `Agent #<id>`.
     *
     * ⚠ THE ANSWER CARRIES MAIN'S OWN STORED VALUE, never an echo of the ask: a refused name
     * (too long, or carrying control / zero-width / bidi characters) comes back `ok: false` so
     * the field can revert rather than paint a name the machine did not take. Same rule
     * `setMode` / `setModel` follow.
     * ⚠ Feature-detect it — an older main has no handler.
     */
    rename?(
      agentId: string,
      name: string
    ): Promise<{ ok: boolean; reason?: string; displayName?: string | null }>;
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
      /**
       * ⚠ AN ID, NEVER A SNAPSHOT (2026-08-22, agent templates). The SPA names the
       * identity it wants; **MAIN resolves the CONTENT** over
       * `GET /api/agent-templates/{id}/resolve`, under the operator's own credential,
       * at spawn (`main/template-resolve.js`). A renderer-supplied
       * `{name, instructions}` would be renderer-authored text landing in a prompt and
       * main could not tell a real template from a fabricated one — F-267 with PROMPT
       * TEXT as the thing forged. It also keeps the knowledge-base viewer filter on the
       * OPERATOR's credential, and reads the row fresh.
       *
       * ⚠ ABSENT / `null` / `""` ALL MEAN A BLANK AGENT, byte-identically to a launch
       * from before templates existed: no resolve, no round trip, no role block.
       * ⚠ A PRESENT BUT MALFORMED ID IS A REFUSAL, not a silent blank launch.
       */
      templateId?: string | null;
      /**
       * THIS SPAWN's ephemeral re-points, from the launch sheet. Never written back to
       * the template.
       *
       * ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE", on both keys — so an untouched
       * sheet and a plain row click produce identical launches.
       * ⚠ `fields` REPLACES the template's own set; it is never merged.
       * ⚠ MAIN RE-VALIDATES ALL OF IT (F-281): `@/shared/lib/safe-label` imports zod, so
       * no renderer surface can hold `SAFE_LABEL_RE` and this side enforces only the
       * numbers. `main/template-resolve.js › narrowOverrides` applies the charset rule
       * and DROPS a row that fails it.
       */
      overrides?: {
        model?: string | null;
        fields?: { key: string; value: string }[];
      };
    }): Promise<{
      ok: boolean;
      agentId?: string;
      sessionId?: string | null;
      /**
       * ⚠ `template-approval` IS A QUESTION, NOT A FAILURE (2026-08-22, OQ-3). The first
       * time a FOREIGN template (one this operator did not write) launches on this
       * machine, main refuses and hands back the name and instructions it resolved so the
       * SPA can show them verbatim. Answer it with `approveTemplate` and relaunch.
       * ⚠ `no-template` means the picked template did not resolve for this operator —
       * deleted, or not visible to them. One word for both, because the endpoint is
       * 404-never-403 and the difference is deliberately not observable.
       */
      reason?: string;
      /** Present ONLY with `reason: "template-approval"` — the text to show. */
      template?: { name?: string | null; instructions?: string | null } | null;
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
     * RECORD THIS MACHINE'S FIRST-USE APPROVAL of another member's agent template
     * (2026-08-22, OQ-3). Call it after the operator has read that template's instructions
     * in the approval sheet, then relaunch.
     *
     * ⚠ IT GRANTS NOTHING BUT THE PROMPT. No tool, no permission axis, no delivery lane and
     * no working folder: it decides only whether that template's TEXT may become an agent's
     * role on this Mac. A launch from an approved template is contained exactly like any
     * other launch.
     * ⚠ MACHINE-LOCAL AND NEVER SERVER-REACHABLE, and that is the security content rather
     * than a storage detail: a spawned session has `Bash` and the operator's credential is
     * on disk, so a server-stored approval would let a credential-holding agent pre-approve
     * itself across every machine they own. Same store, same rule and the same argument as
     * the launch-over-MCP toggle (`main/channel-prefs.js`).
     * ⚠ PER TEMPLATE, NOT PER AUTHOR: what the operator read and consented to was one body
     * of instructions.
     * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED. An approval main did not store means the
     * next launch asks again, which reads as a broken modal unless this side can say so.
     */
    approveTemplate?(templateId: string): Promise<{ ok: boolean; reason?: string }>;
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
