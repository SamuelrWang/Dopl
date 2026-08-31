/**
 * STRUCTURED ESCALATION types — their own module (2026-08-31), for the reason
 * `launch-types.ts` is one: `channel-types.ts` is at the 500-line cap, and these
 * describe a payload rather than a channel.
 *
 * ⚠ THEY ARE A HAND MIRROR of `src/features/channels/escalation.ts`, which is
 * where the shape, the caps and every rule about them are STATED. Nothing here
 * may restate a rule — a rule in two places drifts in one of them, and you
 * cannot tell which from the outside.
 */

/** One choice an escalation offers, and what taking it costs. */
export interface ChannelEscalationOption {
  label: string;
  consequence: string;
}

/**
 * What an agent sends as `ChannelMessageInput.escalation`.
 *
 * ⚠ **2-6 OPTIONS, BOTH ENDS ENFORCED SERVER-SIDE.** One option is a statement
 * rather than a question; seven is the prose wall this shape exists to replace.
 * ⚠ `recommendation.index` must be inside `options` or the whole post is a 400 —
 * never a dropped field, which would render a card recommending nothing over an
 * agent that believes it recommended something.
 */
export interface ChannelEscalationInput {
  /** One line, <=200. The card's title. */
  issue: string;
  /** <=2000. The one field where newlines are legal. */
  context: string;
  options: ChannelEscalationOption[];
  recommendation?: { index: number; why: string } | null;
}

/** What a human's client sends as `ChannelMessageInput.escalationAnswer`. */
export interface ChannelEscalationAnswerInput {
  escalationMessageId: string;
  optionIndex: number;
}

/**
 * The two fields `ChannelMessageInput` carries for this feature.
 *
 * ⚠ TOP-LEVEL VALIDATED FIELDS, NOT `metadata`. The server strips
 * `metadata.escalation` / `metadata.escalationAnswer` from caller input
 * unconditionally and re-stamps them only from these, because the card they
 * render carries option buttons that write back and WAKE AN AGENT — so a
 * caller-settable key would let any member hang a working control, and a wake
 * behind it, off any words at all.
 *
 * ⚠ `body` MUST STILL CARRY THE HUMAN-READABLE RENDER of the same four fields
 * (`@dopl/mcp-server`'s `tools/channel-escalate-render.ts › escalationBody`).
 * That is what makes the card DEGRADE to readable prose on every surface that
 * does not know the key — `op="read"`, a plain browser, the pop-out thread
 * window, and every desktop build older than the card.
 */
export interface ChannelEscalationFields {
  escalation?: ChannelEscalationInput;
  /**
   * ⚠ NO `agentId`, DELIBERATELY. Which agent gets woken is derived server-side
   * off the ESCALATION's own stamp, so an answer can never aim a wake at an
   * agent that asked nothing. Refused 403 unless the caller is a member the
   * escalation tagged (or, when it tagged nobody, its author); 409 when it
   * already has an answer.
   */
  escalationAnswer?: ChannelEscalationAnswerInput;
}
