/**
 * AGENT ENGAGEMENT — will this agent act on my next UNTAGGED message?
 *
 * Status (`summoned` / `active` / `parked` / `dismissed`) says what an agent's
 * LIFECYCLE is. Engagement says something else and more immediately useful:
 * whether a human has addressed it recently enough that it will act on UNTAGGED
 * messages in this channel. An idle agent is perfectly healthy; it just isn't
 * listening, and until now the chips bar had no way to say so, which is how you
 * end up typing at an agent that will never answer.
 *
 * `ChannelAgent.engagedAt` is a FACT (the moment a human last addressed it),
 * never a boolean, and the server deliberately never expires it — see
 * `constants.ts#ENGAGEMENT_TTL_MS`, whose doc is the authority. Reading it
 * therefore ALWAYS means applying the TTL, which is the one thing this module
 * exists to keep in one place: the desktop applies the same window before it
 * treats an untagged human message as its own, so a chip that lit on a
 * non-null stamp alone would promise behavior the desktop would refuse.
 *
 * THREE TREATMENTS, FOUR STATES. A live stamp is necessary for the agent to act
 * but it is NOT sufficient: the process can be suspended (`parked`) and the
 * machine it runs on can be gone (its owner's desktop is offline). Both of those
 * are HELD, not idle — the engagement is intact and resumes on its own — so
 * they get their own treatment and their own sentence rather than being
 * flattened into either neighbour. Only {@link isListening} answers the
 * question in the first line of this doc with a yes.
 *
 * TIME IS AN INPUT, so a reader that renders once goes stale on its own. Every
 * derivation here takes `now`, and {@link nextEngagementExpiry} exists so the
 * surface can schedule its own re-read instead of lying until the next
 * unrelated re-render.
 *
 * DEFENSIVE despite the typed field: this renders rows served by whatever build
 * the deployment is on. A missing or unparseable stamp reads IDLE, because
 * engaged is the claim that needs evidence.
 */

import { ENGAGEMENT_TTL_MS } from "../constants";
import type { ChannelAgent, ChannelMember } from "../types";
import { isAgentOwner } from "./agent-display";

export { ENGAGEMENT_TTL_MS };

/**
 * What the chip presents.
 *
 * - `engaged` — acting on untagged human messages here, right now.
 * - `engaged-offline` — engaged, but its owner's desktop is not connected, so
 *   nothing runs until it is. The engagement itself survives the disconnect.
 * - `engaged-parked` — engaged, but its process is suspended by its owner.
 * - `idle` — present, tag it.
 */
export type AgentEngagement =
  | "engaged"
  | "engaged-offline"
  | "engaged-parked"
  | "idle";

/**
 * The only thing engagement needs from the owner's roster row: whether their
 * desktop heartbeat is inside the presence window (`ChannelMember.agentOnline`,
 * the same field the composer's offline hint reads).
 *
 * `undefined` / `null` means WE DO NOT KNOW (roster still loading, or the owner
 * is not on this channel's roster at all) and is deliberately NOT treated as
 * offline: "their machine is gone" is a claim, and a claim needs evidence just
 * as much as "engaged" does.
 */
export type AgentOwnerPresence =
  | Pick<ChannelMember, "agentOnline">
  | null
  | undefined;

/** The raw stamp, or null. Never throws on a shape the wire didn't promise. */
export function readAgentEngagedAt(agent: ChannelAgent): string | null {
  const raw: unknown = agent.engagedAt;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The human who engaged it, or null. Display + the server's second gate. */
export function readAgentEngagedBy(agent: ChannelAgent): string | null {
  const raw: unknown = agent.engagedBy;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** The stamp as epoch ms, or null when absent / unparseable. */
function engagedAtMs(agent: ChannelAgent): number | null {
  const stamp = readAgentEngagedAt(agent);
  if (!stamp) return null;
  const at = Date.parse(stamp);
  return Number.isNaN(at) ? null : at;
}

/**
 * Is the STAMP live? The time question alone, with no reference to the process
 * or the machine.
 *
 * The window is exclusive on both ends and BOUNDED IN BOTH DIRECTIONS. Past:
 * `age < TTL`, so a stamp exactly one TTL old reads idle. Future: `age > -TTL`.
 * A stamp slightly ahead of us is ordinary clock skew and stays engaged, but the
 * tolerance is not infinite — an unbounded future branch means a client whose
 * clock is grossly wrong reads EVERY stamp as future and shows EVERY agent
 * engaged forever, which is the one failure that no amount of waiting corrects.
 *
 * A dismissed agent is never engaged whatever its stamp says: it is retired, and
 * a lit chip for a retired agent is a lie the operator would act on.
 */
function hasLiveEngagementStamp(agent: ChannelAgent, now: number): boolean {
  if (agent.status === "dismissed") return false;
  const at = engagedAtMs(agent);
  if (at === null) return false;
  const age = now - at;
  return age > -ENGAGEMENT_TTL_MS && age < ENGAGEMENT_TTL_MS;
}

/**
 * The chip's state: a live stamp, then the two things that HOLD it.
 *
 * Order matters. `parked` outranks the presence check because it is the more
 * specific and more actionable fact (its owner suspended it deliberately, and
 * resuming it is a click, not a reconnect); a parked agent whose owner is also
 * offline still reads "parked", which is the thing to undo first.
 *
 * `owner` is optional so the callers that only ask a TIME question
 * ({@link canDisengageAgent}, {@link nextEngagementExpiry}) cannot accidentally
 * make presence part of an answer that has nothing to do with it.
 */
export function deriveAgentEngagement(
  agent: ChannelAgent,
  now: number = Date.now(),
  owner?: AgentOwnerPresence
): AgentEngagement {
  if (!hasLiveEngagementStamp(agent, now)) return "idle";
  if (agent.status === "parked") return "engaged-parked";
  if (owner && !owner.agentOnline) return "engaged-offline";
  return "engaged";
}

/**
 * THE QUESTION THE BAR EXISTS TO ANSWER: will this agent act on the next
 * untagged message? True for exactly one state, on purpose.
 */
export function isListening(engagement: AgentEngagement): boolean {
  return engagement === "engaged";
}

/**
 * True when the engagement STAMP is live, whether or not the agent can act on
 * it this second. This is the question the Disengage affordance asks (there is
 * something to clear) and the question "who engaged it" answers.
 */
export function isEngaged(engagement: AgentEngagement): boolean {
  return engagement !== "idle";
}

/**
 * WHEN DOES THIS BAR GO STALE — the epoch ms at which the soonest-expiring
 * engaged agent falls out of the window, or null when nothing is engaged.
 *
 * Extracted because "when should this re-render" is the logic a ticking surface
 * gets wrong, and a scheduler that lives inside an effect cannot be tested. A
 * caller schedules ONE timer at this instant and re-asks afterwards; null means
 * schedule nothing, so a channel with no engaged agent never wakes.
 *
 * TIME ONLY. Presence and lifecycle changes arrive over realtime and re-render
 * the bar on their own; they are not events the clock can predict, so a parked
 * or offline agent still contributes its expiry here (its chip does change at
 * that instant, from held to idle).
 *
 * Already-expired and unparseable stamps contribute nothing: they cannot cause a
 * future transition, and returning a past instant would spin the caller.
 */
export function nextEngagementExpiry(
  agents: readonly ChannelAgent[],
  now: number = Date.now()
): number | null {
  let soonest: number | null = null;
  for (const agent of agents) {
    if (!hasLiveEngagementStamp(agent, now)) continue;
    const at = engagedAtMs(agent);
    if (at === null) continue;
    const expiry = at + ENGAGEMENT_TTL_MS;
    if (expiry <= now) continue;
    if (soonest === null || expiry < soonest) soonest = expiry;
  }
  return soonest;
}

/**
 * Floor on a scheduled wake, so an expiry that is already upon us cannot spin a
 * caller in a zero-delay render loop.
 */
export const MIN_ENGAGEMENT_TICK_MS = 250;

/**
 * `setTimeout` stores its delay in a signed 32-bit int; a larger one overflows
 * and fires IMMEDIATELY. The TTL is an hour, so this only ever guards a
 * pathological future stamp — but an overflow there is exactly the render loop
 * the floor above exists to prevent.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * How long to sleep before re-reading the bar, given {@link nextEngagementExpiry}
 * and the current instant. Clamped at both ends, extracted from the effect for
 * the same reason the expiry itself was: a clamp that lives inside a `useEffect`
 * is a clamp nothing can assert on.
 */
export function engagementTickDelay(expiry: number, now: number): number {
  return Math.min(
    Math.max(expiry - now, MIN_ENGAGEMENT_TICK_MS),
    MAX_TIMEOUT_MS
  );
}

/**
 * The chip's full phrase, used wherever there is room for it (the chip's
 * `title`, the popover). NOT color alone: the words are always rendered.
 */
export const AGENT_ENGAGEMENT_LABEL: Record<AgentEngagement, string> = {
  engaged: "Engaged",
  "engaged-offline": "Engaged, owner offline",
  "engaged-parked": "Engaged, parked",
  idle: "Idle",
};

/**
 * The one word that rides INSIDE the chip, where "Engaged, owner offline" would
 * be wider than the handle it describes. Each state gets a different word, so
 * the tag alone still separates the three treatments; the full phrase is one
 * hover or one click away.
 */
export const AGENT_ENGAGEMENT_TAG: Record<AgentEngagement, string> = {
  engaged: "Engaged",
  "engaged-offline": "Offline",
  "engaged-parked": "Parked",
  idle: "Idle",
};

/**
 * The one line the chip's tooltip / popover states, so the difference is
 * actionable rather than decorative. Each held state says WHAT TO EXPECT (it
 * resumes by itself / somebody has to resume it), because "it is engaged but
 * nothing is happening" is exactly the state a user would otherwise sit in.
 * Copy rule: no em dashes.
 */
export function agentEngagementHint(
  engagement: AgentEngagement,
  handle: string
): string {
  switch (engagement) {
    case "engaged":
      return "Listening to this channel; you can talk without tagging.";
    case "engaged-offline":
      return "Still engaged, but its owner's desktop is offline. Nothing runs here until they reconnect.";
    case "engaged-parked":
      return "Still engaged, but parked. Nothing runs here until its owner resumes it.";
    default:
      return `Tag @${handle} to bring it in.`;
  }
}

/**
 * WHO ENGAGED IT, in one sentence, or null when that is not a fact worth
 * stating (nothing is engaged, or the row carries no `engaged_by`).
 *
 * This exists because a peer who engaged a TEAMMATE'S agent had neither a path
 * nor an explanation: the web's Disengage is owner-only (see
 * {@link canDisengageAgent}) while the server also admits `engaged_by`, so the
 * one person most likely to want the button is the one it is hidden from. Say
 * so rather than leaving them to conclude the chip is broken.
 */
export function agentEngagedByLabel(
  agent: ChannelAgent,
  memberNames: ReadonlyMap<string, string>,
  viewerUserId: string | undefined,
  now: number = Date.now()
): string | null {
  if (!isEngaged(deriveAgentEngagement(agent, now))) return null;
  const by = readAgentEngagedBy(agent);
  if (!by) return null;
  if (viewerUserId && by === viewerUserId) {
    return isAgentOwner(agent, viewerUserId)
      ? "You engaged it."
      : "You engaged it. Only its owner can disengage it here.";
  }
  const name = memberNames.get(by);
  return name ? `${name} engaged it.` : "A teammate engaged it.";
}

/**
 * Chip surface per engagement, in design tokens only.
 *
 * ENGAGED is LIT: raised elevated surface, strong hairline, primary ink.
 * HELD is SOLID BUT FLAT: the strong hairline stays (the engagement is intact)
 * over the inset fill (nothing is running) — legible as "not idle, not acting".
 * IDLE is HOLLOW: flat inset surface, a DASHED subtle hairline, secondary ink.
 * The dash carries the state without color, and the label says the word too, so
 * nothing here is the sole signal.
 *
 * THE HOVER IS PART OF THE STATE. A resting engaged chip is `bg-bg-elevated`,
 * so hovering anything else onto `bg-bg-elevated-hover` made an idle chip
 * impersonate an engaged one under the cursor. Everything that is not engaged
 * hovers to a raised TINT instead, which reads as "hovered" without ever
 * reading as "lit".
 */
export function agentEngagementChipClass(engagement: AgentEngagement): string {
  switch (engagement) {
    case "engaged":
      return "border-border-strong bg-bg-elevated text-text-primary hover:bg-bg-elevated-hover";
    case "engaged-offline":
    case "engaged-parked":
      return "border-border-strong bg-bg-inset text-text-secondary hover:bg-surface-raised-2";
    default:
      return "border-dashed border-border-default bg-bg-inset text-text-secondary hover:bg-surface-raised-2";
  }
}

/** The engagement tag's ink: live, held, or faint. Tokens only. */
export function agentEngagementTagClass(engagement: AgentEngagement): string {
  switch (engagement) {
    case "engaged":
      return "text-success";
    case "idle":
      return "text-text-muted";
    default:
      return "text-warning";
  }
}

/**
 * Who the WEB offers Disengage to: the OWNER of an agent that currently carries
 * a live engagement. Same "mine" check every other write affordance on the chip
 * uses, which is why it calls {@link isAgentOwner} rather than restating it —
 * THE OWNER RULE lives in one place.
 *
 * A HELD agent still qualifies: parked or owner-offline, the stamp is there and
 * clearing it is exactly what the button does. Refusing here would mean an owner
 * could not disengage an agent until they had first resumed it.
 *
 * DELIBERATELY NARROWER THAN THE SERVER. `server/service-agents.ts#disengageAgent`
 * also admits `engaged_by` (the human who engaged it, who may not own it), on
 * the reasoning that ending an agent's attention to YOUR messages is not the
 * same act as parking someone else's process. This gate keeps the chip menu's
 * existing owner-only shape; widening it is a product call, not a refactor, and
 * the server is the authority either way (it re-checks and 403s). The peer who
 * engaged a teammate's agent is at least TOLD as much now, by
 * {@link agentEngagedByLabel}.
 *
 * Also refuses when there is nothing to disengage FROM — an idle agent offering
 * "Disengage" teaches that idle means engaged.
 */
export function canDisengageAgent(
  agent: ChannelAgent,
  viewerUserId: string | undefined,
  now: number = Date.now()
): boolean {
  if (!isAgentOwner(agent, viewerUserId)) return false;
  if (agent.status === "dismissed") return false;
  return isEngaged(deriveAgentEngagement(agent, now));
}
