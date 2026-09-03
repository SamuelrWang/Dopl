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
 *
 * ⚠ **{@link DirectionRefusalReason} IS DECLARED IN `@dopl/contracts ›
 * directives.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice A13). It had a
 * byte-equal twin in `packages/dopl-client/src/direction-types.ts` and no script
 * between the two. No import path changed; `@/features/channels/types` (which
 * re-exports this file) is still the one path to the name. ⚠ The DATABASE states
 * the same set a third time as a column CHECK, which is why the docblock over
 * there still says a sixth reason is a schema change in both trees.
 */
import type { DirectionRefusalReason } from "@dopl/contracts";

export type { DirectionRefusalReason };

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
  /**
   * 🔒 **WHICH of the operator's own agents FILED this — a LABEL, and an
   * UNVERIFIED one (F-376a, 2026-08-31).**
   *
   * ⚠ **NOTHING MAY GATE, ROUTE, FILTER OR AUTHORIZE ON THIS FIELD**, and the
   * reason is not caution, it is mechanics: the server derives it from the third
   * segment of `X-Dopl-Session-Id`, a documented NON-authorization signal
   * (INVARIANTS §10 — "nothing may be GRANTED on it") that anything holding the
   * operator's device token can set. It is exactly as trustworthy as
   * `metadata.session_id`, which is to say: useful for telling two of your own
   * agents apart on your own screen, and worth nothing as a claim.
   * ⚠ **THE FENCE IS `operatorUserId`, AND IT IS UNCHANGED.** Sender and
   * recipient are the SAME operator's agents by construction, so this discloses
   * nothing the row's only legitimate reader did not already own.
   *
   * `null` is the ORDINARY case, not a defect: an external orchestrator (Claude
   * Desktop, Claude Code, any MCP client that is not a spawned desktop session)
   * sends no session stamp and has no agent id to send. Render it as "your
   * agent" — the sentence the surface used before this field existed.
   */
  senderAgentId: string | null;
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
