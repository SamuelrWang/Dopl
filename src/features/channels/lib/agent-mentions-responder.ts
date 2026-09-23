/** The default-responder lane: who answers a post that addressed nobody, and the word saying why. Re-exported from `agent-mentions.ts`. */
import type { AgentMentionCandidate } from "./agent-mentions";

/**
 * Why this agent answered: a closed set, stored in `metadata.wake_reason` and rendered by both
 * trees.
 */
export type ResponderReason =
  // Retired (the room-wide responder pin); kept so stored rows still render. Nothing produces it.
  | "default"
  /** Exactly one agent is live in the room. */
  | "only agent"
  /** Several are live; this one the ASKING PERSON addressed most recently. */
  | "most recent"
  // Retired (F-705: a launch-order guess that wandered); kept so stored rows still render.
  | "most recently launched";

/**
 * Who answers this person's unaddressed messages: per user, not per room, and a rule rather than
 * a pinned agent (agents are ephemeral, so a pinned handle decays into naming nothing).
 */
export type UnaddressedResponderSetting =
  /** Nobody answers this person's untagged messages. No agent is woken. */
  | "none"
  /** The agent this person addressed most recently in this room, if it is still live. */
  | "last_addressed";

/** `last_addressed`: a forgotten `@` must never stall a conversation (B1). `"none"` is a deliberate act. */
export const UNADDRESSED_RESPONDER_DEFAULT: UnaddressedResponderSetting = "last_addressed";

/** ⚠ Junk lands on the default, not on `"none"`: an unreadable value must not silence a member. */
export function normalizeUnaddressedResponder(
  raw: unknown
): UnaddressedResponderSetting {
  return raw === "none" || raw === "last_addressed"
    ? raw
    : UNADDRESSED_RESPONDER_DEFAULT;
}

export interface ResponderChoice {
  agentId: string;
  reason: ResponderReason;
}

/**
 * The default responder, one pure rule shared by the server (`service-wake-verdict-resilience.ts ›
 * defaultResponder`) and the composer's recipient line. In order: `"none"` → nobody; one live
 * agent → it; the live agent the asker addressed most recently → it; else nobody (F-705: never a
 * guess that wanders). `null` means nobody is woken (`verdict=none`).
 * Nothing here orders candidates or filters them for freshness; the caller decides what "live" is.
 */
export function resolveDefaultResponder(
  /** The asker's coerced setting; "could not read it" must arrive as the default, never `"none"`. */
  setting: UnaddressedResponderSetting,
  candidates: readonly AgentMentionCandidate[],
  /** Agent ids the asker addressed in this room, most recent first
   *  (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`). Unbounded in time: intersecting with
   *  the live candidates is what ends the stickiness when an agent ends. */
  recentAgentIds: readonly string[] = []
): ResponderChoice | null {
  // First line, so no arm below can fire with `"none"` set.
  if (setting === "none") return null;
  const ids = [...new Set(candidates.map((c) => c.agentId))];
  if (ids.length === 0) return null;
  if (ids.length === 1) return { agentId: ids[0], reason: "only agent" };
  for (const id of recentAgentIds) {
    if (ids.includes(id)) return { agentId: id, reason: "most recent" };
  }
  return null;
}
