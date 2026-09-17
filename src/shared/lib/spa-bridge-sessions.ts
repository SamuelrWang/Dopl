"use client";

/**
 * THE OPERATOR'S OWN AGENTS, as ops on the bundled-SPA bridge.
 *
 * ⚠ SPLIT OUT OF `./spa-bridge.ts` ON 2026-09-17, at the 500-line §1 cap, when the held-gate
 * approval op (`answerPermission`) had nowhere to be declared. The seam is REASON-TO-CHANGE and
 * not the line count that forced the question: `spa-bridge.ts` is the BRIDGE — the capability
 * detector, the request transport, the app-wide toggles — and moves when the bridge does. This
 * is the AGENT SURFACE, which gains a member every time that surface does, and has gained
 * several in a month (launch, message, setMode, setModel, rename, describe, mintAgentId,
 * delete, answerPermission).
 *
 * ⚠ IT IS RE-EXPORTED FROM `./spa-bridge` AND THAT IS THE IMPORT PATH OF RECORD. A second
 * canonical path for one type is how two trees come to disagree — the rule
 * `./spa-bridge-shapes` already states for `DesktopSessionSummary`.
 *
 * ⚠ EVERY MEMBER IS OPTIONAL AND EVERY CALLER FEATURE-DETECTS THE MEMBER IT IS ABOUT TO USE,
 * on the bridge object rather than on a wrapper (INVARIANTS §11). The type describes the
 * CONTRACT a current main keeps; the two trees ship separately, so the `typeof` gate at the call
 * site is the real fence and the declaration never replaces it.
 *
 * ⚠ THREE PLACES MUST STAY IN SYNC: this type, the runtime contract
 * `dopl-desktop-app/renderer/app-preload.js`, and `apps/desktop-ui/src/lib/dopl-bridge.ts` —
 * plus the pin that executes the preload against a fake `electron`
 * (`dopl-desktop-app/test/preload-parity.test.mjs › APP_OPS`), which fails on ADD as well as on
 * REMOVE.
 *
 * ⚠ `pause` / `end` ARE OWN-AGENTS-ONLY, and that is structural rather than checked: main
 * resolves the (channel, thread) pair against ITS OWN session registry, which holds nothing but
 * this operator's sessions on this machine. Nobody pauses another member's agent, and a peer's
 * paused agent reads as inactive PRESENCE on their side, never as a stalled thread.
 */

import type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";

export interface SpaBridgeSessions {
  /** ⚠ `segment` is OPTIONAL and joined 2026-08-20: a live WINDOWLESS session
   *  reopens as the AGENT WINDOW, whose landing is a router path. */
  reopen(
    channelId: string,
    taskId: string,
    segment?: string,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * THE AGENT WINDOW (F-212's closure) — a second window on this bundle showing one of MY
   * agents: its live work, what it sent, and a composer. ⚠ ASKS FOR A WINDOW; DOES NOT GET ONE.
   * No handle comes back — main creates and registers it (`main/app-windows.js`), which is what
   * makes the widened sender binding safe.
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
   * Move a LIVE session's permission posture. Applies from the very next gate decision —
   * `session-io.js › grantArgs` reads both axes off the reducer state at CALL time, so moving
   * that state IS the change.
   *
   * ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT: the axes decide whether the operator is ASKED;
   * the profile decides what is reachable at all, is checked first, and no posture can widen
   * it. The answer carries MAIN's own post-dispatch values, never an echo of the request — the
   * reducer coerces fail-closed and a renderer that stamped its own ask would show a posture
   * nothing is enforcing. ⚠ **IT DESCRIBES `setMode` BELOW — AN ORPHAN.** A 2026-09-13 reflow
   * merged it into `rename`'s and left a literal `/ /**` mid-comment; re-split 2026-09-14.
   */
  /**
   * RENAME ONE AGENT — display only (2026-08-25). An EMPTY name CLEARS it, which is how the
   * operator goes back to `Agent #<id>`.
   *
   * ⚠ THE ANSWER CARRIES MAIN'S OWN STORED VALUE, never an echo of the ask: a refused name (too
   * long, or carrying control / zero-width / bidi characters) comes back `ok: false` so the
   * field can revert rather than paint a name the machine did not take. Same rule `setMode` /
   * `setModel` follow. ⚠ Feature-detect it — an older main has no handler.
   */
  rename?(
    agentId: string,
    name: string
  ): Promise<{ ok: boolean; reason?: string; displayName?: string | null }>;
  /**
   * WHAT THE AGENT IS FOR — `rename`'s twin (2026-08-27, Samuel's launch-panel ruling).
   *
   * ⚠ EVERY SENTENCE OF `rename`'s CONTRACT APPLIES: machine-local, keyed by the instance
   * address, display-only (it DESCRIBES, it never addresses), and an EMPTY string clears it.
   * The answer is main's OWN stored value, so a refusal reverts rather than paints.
   * ⚠ Feature-detect it — an older main has no handler.
   */
  describe?(
    agentId: string,
    description: string
  ): Promise<{ ok: boolean; reason?: string; description?: string | null }>;
  /**
   * ONE FRESH INSTANCE ID, BELONGING TO NOBODY YET (2026-08-27, Samuel's launch-panel ruling).
   *
   * The composer's launch panel shows the operator the agent's ID while they are still filling
   * the form, so it is minted BEFORE the spawn and handed back through `launch`'s `agentId`.
   *
   * ⚠ ITS PRESENCE IS THE CAPABILITY GATE FOR THAT WHOLE FEATURE, and it is the only honest
   * one available: a build older than the forward in `main/session-launch-op.js` still has
   * `launch`, still accepts the field, and silently mints its own id instead — so detecting
   * `launch` proves nothing. Detect THIS (INVARIANTS §11) and fall back to filling the id in
   * after the launch, rather than showing an address the agent will never have.
   * ⚠ IT RESERVES NOTHING: a pure CSPRNG draw (`main/agent-id.js`), with nothing to release
   * when the operator closes the panel without launching.
   */
  mintAgentId?(): Promise<{ ok: boolean; agentId?: string }>;
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
    /**
     * THE INSTANCE ID THIS AGENT SHOULD WEAR, pre-assigned by the caller (2026-08-27).
     *
     * ⚠ ABSENT IS THE ORDINARY CASE and main mints its own — every launch that is not the
     * composer's launch panel says nothing here, and gets exactly the behaviour it always had.
     * ⚠ IT IS ACCEPTED, NOT TRUSTED: main re-checks `main/agent-id.js › isAgentId` and mints a
     * fresh one when the shape fails, so a renderer cannot invent an id SHAPE. An id addresses;
     * it grants nothing.
     * ⚠ ONLY HONOURED BY A BUILD THAT EXPOSES {@link mintAgentId} — see that member. An older
     * main accepts this field and drops it on the floor, which is why the gate is the op's
     * presence and never this field's.
     */
    agentId?: string;
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
     * THIS SPAWN's ephemeral re-points, from the launch sheet. Never written back to the template.
     *
     * ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE", on both keys — so an untouched sheet and a
     * plain row click produce identical launches. ⚠ `fields` REPLACES the template's own set; it
     * is never merged. ⚠ MAIN RE-VALIDATES ALL OF IT (F-281): `@/shared/lib/safe-label` imports
     * zod, so no renderer surface can hold `SAFE_LABEL_RE` and this side enforces only the
     * numbers. `main/template-resolve.js › narrowOverrides` applies the charset rule and DROPS a
     * row that fails it.
     */
    overrides?: {
      model?: string | null;
      fields?: { key: string; value: string }[];
    };
    /** THIS SPAWN's runtime, and THIS AGENT's COLOUR. Same contract: forwarded raw, re-narrowed
     *  in `main/` (`session-launch-op.js`), absence means the machine/server decides. Argument +
     *  absence rule for both: `channels/components/agents-controls.ts › launchAgentOnThread`. ⚠ `color` is
     *  a STRING, not the key union — `main/` cannot import it. */
    runtime?: string;
    color?: string;
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
  /**
   * ANSWER ONE TOOL CALL THIS MACHINE IS HOLDING AT THE GATE — the agent panel's inline
   * Approve / Deny (2026-09-17, Samuel: *"i dont see like a surface where I can approve the
   * permission either inline"*).
   *
   * ⚠ IT IS THE SURFACE THE RETIRED SESSION WINDOW TOOK WITH IT. A gated tool on a windowless
   * session HOLDS (`main/session-windowless.js`'s tool-gate bridge) and the only way to answer
   * was a native notification the operator gets once and cannot go back to. The card is drawn
   * from `DesktopSessionSummary.heldGates`; this answers one of its entries.
   *
   * ⚠ ALLOW-ONCE. `allow: true` resolves THIS call and mints no standing grant — a compact
   * inline card is too small a surface to hand a session-wide power from, the same bound the
   * notification's Allow button has. Repeat calls re-prompt.
   *
   * ⚠ IT DECIDES NOTHING AND WIDENS NOTHING. The gate already ruled "hold and ask"; this
   * carries a human's answer to a resolver already parked in main. It moves neither permission
   * axis, starts no turn and cannot make a call succeed that the tool PROFILE refused — a
   * `deny` verdict parks no resolver, so there is nothing to answer for one.
   *
   * ⚠ THE VERDICT IS RETURNED, NEVER SWALLOWED, and `{ ok: false }` is a REAL outcome here
   * rather than a rare error: `unknown-request` (already answered, or expired against main's
   * 10-minute TTL), `already-decided` (a park fail-closed the resolver between the state push
   * this card was drawn from and the click), `no-session`. Main answers `ok: true` only when a
   * live resolver really took it.
   *
   * ⚠ NAME THE `agentId`. Every card is drawn from ONE agent's row, and an omitted id resolves
   * to the OLDEST live agent on the thread — a different agent's question.
   */
  answerPermission?(
    channelId: string,
    taskId: string,
    requestId: string,
    allow: boolean,
    agentId?: string
  ): Promise<{ ok: boolean; reason?: string; decision?: string }>;
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
   * DELETE THE AGENT (2026-08-25, Samuel's ruling) — the Agents-tab card's trash icon.
   *
   * ⚠ IT IS `end` PLUS AN ERASE, AND THE STOP HALF IS THE SAME ONE. A live session is
   * ended through the reducer event `end` dispatches, reaching the same teardown — one
   * stop path, never two (INVARIANTS §11). Then every LOCAL trace goes: the frozen
   * narration history, the durable record, the resume map, the retained ended card, the
   * queued-notice guard, the display name, and any window open onto it. `ended: true`
   * says this call is what stopped a session that was still running.
   *
   * ⚠ **DELETION IS LOCAL. THE CHANNEL RECORD IS IMMUTABLE BY IT.** Everything the agent
   * POSTED stays in the channel, attributed exactly as before — the id rides the MESSAGE
   * (`channels/components/agents-model.ts › parseAgentPostStamp`, off `client_msg_id`), never a
   * local table, so a deleted agent's messages keep reading `Agent #<id>`. The only
   * server-side effect is the one `end` already has: the session projects as `ended`.
   *
   * ⚠ `agentId` IS REQUIRED, uniquely on this namespace. Everywhere else an omitted id
   * resolves to the OLDEST live agent on the thread; for a DESTRUCTIVE verb that is a
   * DIFFERENT agent than the card that was clicked, and nothing would report the swap.
   * ⚠ `reason: "no-agent"` means the address named nothing this machine can find.
   * ⚠ Feature-detect it — an older main has no handler, and the trash must be ABSENT
   * rather than inert.
   */
  delete?(
    channelId: string,
    taskId: string,
    agentId: string
  ): Promise<{ ok: boolean; reason?: string; ended?: boolean }>;
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
}
