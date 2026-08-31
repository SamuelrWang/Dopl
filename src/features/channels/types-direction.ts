/**
 * THE PRIVATE DIRECT LANE — an operator's external agent steering that
 * operator's OWN running agent session, privately (Samuel's ruling, 2026-08-31).
 *
 * ⚠ SPLIT OUT OF `types.ts` at the 500-line cap, `types-launch.ts`'s
 * arrangement; re-exported from there, so there is no second path to a symbol.
 *
 * ⚠ **IT IS THE LAUNCH MAILBOX'S SIBLING, NOT ITS SUBTYPE.** A launch asks for a
 * PROCESS; a direction asks an EXISTING one to hear something. They share a
 * transport shape and nothing else — different refusal vocabularies, a required
 * `agentId` where a launch has none, and a `reply` a launch could never carry.
 */

/**
 * WHY A DESKTOP SAID NO TO A DIRECTION — **exactly five words, and the closed set
 * is the wire contract both trees code against.**
 *
 * ⚠ **A KEY, NEVER A SENTENCE**, for {@link LaunchRefusalReason}'s reason: prose
 * on the wire needs a desktop release to reword, and desktop-authored text
 * rendered into an MCP result is text nobody neutralized.
 *
 *  - `no-session` — **the one that actually happens.** No live session on that
 *                   machine with that `(channel, thread, agent)` key: the agent
 *                   ended, was deleted, or was never there. It is the honest
 *                   answer and the only authoritative one, because whether an
 *                   agent is alive is knowable only on the machine running it.
 *  - `auth-hold`  — the desktop is signed out or its credential is held, so the
 *                   session has no query to feed and the words would vanish.
 *  - `busy`       — the machine declined for now. Genuinely temporary.
 *  - `blocked`    — the desktop is below the version floor and is refusing every
 *                   turn-starting op until it updates.
 *  - `no-bridge`  — **the operator's direct-over-MCP toggle is OFF.** Kept in the
 *                   set for the same reason the launch lane keeps it, and written
 *                   by nothing today: a machine that has not opted in ignores the
 *                   row SILENTLY, because a refusal would itself admit the machine
 *                   is listening. It exists so an older or future producer has a
 *                   word, and so the reader has a sentence if one ever arrives.
 *
 * ⚠ A SIXTH REASON IS A SCHEMA CHANGE IN BOTH TREES, deliberately: the column
 * carries the same CHECK, so an unknown value cannot be stored and cannot reach a
 * render as raw text.
 */
export type DirectionRefusalReason =
  | "no-session"
  | "auth-hold"
  | "busy"
  | "blocked"
  | "no-bridge";

/**
 * ONE PRIVATE DIRECTION from an operator's external agent to that operator's own
 * desktop, aimed at one agent session.
 *
 * ⚠ **NOT A MESSAGE, AND DELIBERATELY OFF `channel_messages`** — INVARIANTS §5,
 * and here a third reason joins the launch mailbox's two: **the lane is PRIVATE
 * BY DEFINITION**, so putting it in the shared transcript is not a design trade
 * but the feature's negation. The consequence to know is the same: **a direction
 * has no `seq` and can never end an `await`.**
 *
 * ⚠ `status` is the REPORTED one, expiry already applied. It may differ from the
 * stored column — expiry is lazy and there is no cron.
 */
export type AgentDirection = {
  id: string;
  /**
   * The operator whose machine this asks to deliver — **always the reader's own
   * id, never anyone else's**, exactly as {@link LaunchDirective.operatorUserId}.
   *
   * ⚠ NOT A DISCLOSURE: every read that produces this DTO is fenced on
   * `operator_user_id = ctx.userId` in `server/repository-directions.ts`, so the
   * field can only echo the caller back to itself. It is here for the DESKTOP's
   * local ownership re-check (F-284's lesson), which is the one consumer that
   * cannot take the fence on trust — the same function also receives RAW realtime
   * rows, which arrive under a subscription rather than a per-row auth answer.
   */
  operatorUserId: string;
  channelId: string;
  /** Thread the agent is on, or null for a channel-level agent. */
  threadId: string | null;
  /**
   * THE AGENT INSTANCE THIS IS AIMED AT — **required, and there is no fallback.**
   *
   * ⚠ Every other op in this family resolves to the OLDEST live agent on a thread
   * when none is named. For a lane that reaches a PRIVATE TURN that would steer a
   * different agent than the orchestrator addressed, with nothing reporting the
   * swap — the argument `sessions:delete` already makes for a destructive verb,
   * applied to an authority-bearing one.
   */
  agentId: string;
  /** What to say to it. Never posted anywhere. */
  body: string;
  status: "pending" | "claimed" | "delivered" | "refused" | "expired";
  /** Set iff `status` is `refused`. */
  refusalReason: DirectionRefusalReason | null;
  /**
   * 🔒 THE DIRECTED TURN'S FINAL TEXT — **the one place private-lane text leaves a
   * machine, and the rule is that it may not be generalised.**
   *
   * A direction that arrived from off-machine gets an answer that goes back
   * off-machine. NOTHING else in the private lane ever does: not the narration
   * ring, not thinking frames, not tool calls, not any other turn, and never
   * anything the OPERATOR typed into their own panel.
   *
   * ⚠ **`null` MEANS "NOT REPORTED", NEVER "THE AGENT SAID NOTHING".** A turn
   * whose final text was empty and an older desktop that delivers without
   * reporting are both honest `delivered`s, which is why the column's CHECK does
   * not require it. The render must say which it cannot tell.
   */
  reply: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
