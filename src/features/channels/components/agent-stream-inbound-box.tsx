"use client";

/**
 * **WHAT WOKE IT** — the message that ARRIVED for this agent, at the place in its stream where it
 * landed (Samuel, 2026-10-10, #3081): main's `inbound` narration frame
 * (`main/session-narration.js`, and `› noteLaunchMessage`), so the operator reads both sides of an
 * exchange.
 *
 * ⚠ IT WEARS THE SENT BOX'S CARD (`agent-stream-card.tsx`): the two are the halves of one exchange.
 * The edge says who wrote it — black for a person, the agent's own colour for an agent.
 *
 * ⚠ **IT IS THE DIRECTED BOX'S RELATIVE WITHOUT BEING THE DIRECTED BOX.** A direction is 1:1 between
 * two of the operator's OWN agents over a mailbox no peer can read (`agent-stream-directed.tsx`), so
 * its label may only ever name the relation — *"your agent"*. This message is in the CHANNEL, it can
 * come from any member, and main resolves its sender, so this label can and does name the sender.
 */

import type { IdentityFacts } from "@/shared/ui/identity-face";
import { agentColorVar } from "../lib/agent-colors";
import { agentNameHandle } from "../lib/agent-mentions";
import type { AgentColorKey } from "../types";
import { StreamCard } from "./agent-stream-card";
import { StreamProse } from "./agent-stream-prose";

/**
 * WHAT THE LABEL SAYS WITH NO SENDER. ⚠ A complete sentence, not a gap: an older main stamps no
 * sender, and the frame still guarantees a message arrived. No em dashes, no invented certainty —
 * "X says" would put words in a member's mouth, "New message" would claim a recency the row loses
 * once it has scrolled.
 */
export const INBOUND_ANON_LABEL = "Message received";

/**
 * 🔴 **WHEN THE OPERATOR TYPED IT, THE LABEL SAYS "you"** (release review, 2026-10-11): main stamps
 * `fromOperator` so the face can say "you" where it is the operator's own channel post, instead of
 * reading their own display name back at them. ⚠ Not a privacy claim and it does not move the lane.
 */
export const INBOUND_OPERATOR_LABEL = "Received from you";

/**
 * 🔴 **"you" IS ONLY FOR WORDS THE OPERATOR TYPED — THEIR OWN AGENTS ARE NAMED AS AGENTS**
 * (Samuel, 2026-10-12; INVARIANTS §11). Ruling 2 folds the operator's own agents into `fromOperator`,
 * which still answers *whose ACCOUNT spoke* everywhere it gates; this label asks *who wrote it*.
 *
 * ⚠ **`authorKind` DECIDES, AND IT IS SERVER-DERIVED FROM THE AUTHOR'S CREDENTIAL**
 * (`StreamItem.authorKind`) — never recovered from *"'s agent"* inside the peer-typed `sender`.
 * ⚠ **AN AGENT IS NAMED BY ITS OWN HANDLE** (`@cleanup-orchestrator`), the slug the picker inserts
 * and the mention resolver accepts, and it degrades through the facts it has: no agent name ⇒ the
 * resolved label, no label either ⇒ {@link INBOUND_ANON_LABEL}. Never a blank, and never an id.
 */
export function inboundLabel(
  sender: string | null | undefined,
  fromOperator?: boolean,
  authorKind?: "user" | "agent",
  senderAgentName?: string | null
): string {
  const name = typeof sender === "string" ? sender.trim() : "";
  if (authorKind === "agent") {
    const agent = typeof senderAgentName === "string" ? senderAgentName.trim() : "";
    const handle = agentNameHandle(agent);
    if (handle) return `Received from @${handle}`;
    // A name the slug would eat still names somebody: print it as given.
    if (agent) return `Received from ${agent}`;
    return name ? `Received from ${name}` : INBOUND_ANON_LABEL;
  }
  if (fromOperator === true) return INBOUND_OPERATOR_LABEL;
  return name ? `Received from ${name}` : INBOUND_ANON_LABEL;
}

/**
 * **WHO WROTE IT, AS AN EDGE** (Samuel, 2026-10-12): a HUMAN member's message is black
 * (`--surface-cta`, the one black this tree has); an AGENT's wears that agent's identity colour.
 * ⚠ **`null` IS THE NEUTRAL EDGE AND IT IS LOAD-BEARING**: an unknown kind, or an agent whose colour
 * did not resolve. An agent is never painted black as a fallback, because black claims a PERSON
 * wrote the words.
 */
function inboundEdge(
  authorKind: "user" | "agent" | undefined,
  senderColor: AgentColorKey | null
): string | null {
  if (authorKind === "user") return "var(--surface-cta)";
  if (authorKind === "agent" && senderColor) return agentColorVar(senderColor);
  return null;
}

/**
 * WHOSE FACE THE CARD WEARS, off the same server-derived facts as its label. The frame carries no
 * sender id, so only the operator has a photo (their own words, or their own agent in its ring);
 * anyone else is initials off the resolved name. An unknown kind draws no face.
 */
export function inboundFace(
  facts: {
    authorKind?: "user" | "agent";
    fromOperator?: boolean;
    senderName?: string;
    senderAgentName?: string;
    senderColor?: AgentColorKey | null;
  },
  viewerPhoto: string | null
): IdentityFacts | null {
  const photo = facts.fromOperator === true ? viewerPhoto : null;
  if (facts.authorKind === "user") return { photo, name: facts.senderName ?? null };
  if (facts.authorKind === "agent") {
    return {
      photo,
      name: facts.senderAgentName ?? facts.senderName ?? null,
      ring: facts.senderColor ?? "neutral",
    };
  }
  return null;
}

/**
 * ONE ARRIVING CHANNEL MESSAGE. The body goes through `StreamProse` like every other message face:
 * the same string the message pane renders as markdown one view over.
 */
export function InboundBox({
  text,
  sender,
  fromOperator,
  authorKind,
  senderAgentName,
  senderColor = null,
  face = null,
  at,
}: {
  text: string;
  /**
   * WHO SENT IT, **already resolved to words by main** (`main/session-dispatch.js › authorLabel`).
   * 🔒 **PEER-TYPED AND UNVERIFIED**: nothing gates on it, and it renders as a React TEXT CHILD on a
   * single `truncate` line, so markup cannot render and newlines cannot forge a second row.
   */
  sender?: string | null;
  /** THE OPERATOR'S OWN ACCOUNT SENT IT (`StreamItem.fromOperator`) — only `true` counts. */
  fromOperator?: boolean;
  /** `"user"` paints the black edge, `"agent"` the agent's colour; absent is unknown and paints
   *  nothing, which is also what every frame from an older main carries. */
  authorKind?: "user" | "agent";
  /** The agent's own name when `authorKind` is `"agent"`. ⚠ Peer-typed; a text child like `sender`. */
  senderAgentName?: string | null;
  /** The sending agent's colour key (`StreamItem.senderColor`, already narrowed to one of the
   *  sixteen); `null` is the neutral edge, never black. */
  senderColor?: AgentColorKey | null;
  /** The sender's face, when the host can say who it is; absent draws none. */
  face?: IdentityFacts | null;
  /** Epoch ms; `0` drops the stamp. */
  at?: number;
}) {
  const edge = inboundEdge(authorKind, senderColor);
  return (
    <StreamCard
      edge={edge}
      face={face}
      label={inboundLabel(sender, fromOperator, authorKind, senderAgentName)}
      at={at}
      data-stream-inbound=""
      // The test vocabulary for "which weight did this card draw" — read, never styled on.
      data-stream-inbound-paint={edge ? (authorKind === "agent" ? "agent" : "human") : "neutral"}
    >
      <StreamProse text={text} className="px-3 py-[9px]" />
    </StreamCard>
  );
}
