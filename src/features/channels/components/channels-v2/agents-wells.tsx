"use client";

/**
 * THE AGENTS TAB'S FOUR GRAY WELLS — **Recent / Last 7 days / Last 30 days /
 * Earlier**, holding the white agent cards that were created or last active
 * inside each span.
 *
 * ⚠ **THE MACHINERY IS `recency-wells.tsx` SINCE 2026-09-13, AND THIS FILE IS A
 * THIN CONSUMER OF IT.** The four spans, `wellFor`, the persisted open state, the
 * animated `.collapse-grid` box and the rotating chevron all live there, with
 * Samuel's rulings; the Threads tab is the second surface (*"for the threads
 * page/tab, I want you to add the same gray backgrounds that we added to the
 * Agents tab"*) and a second copy of a collapse would have been two places for
 * one geometry to move. **WHAT IS AGENTS-SPECIFIC AND STAYS HERE: the two
 * expressions that DATE an agent row, and this tab's `localStorage` key.**
 *
 * 🔒 **SAMUEL, 2026-09-13, verbatim, over a flat column of agent cards:** *"On the
 * overview page we see that gray background thing. I like that gray background
 * right behind the white pane. I want us to apply that gray background on top of
 * that Agents page. Each one will have a header that says Recent. Inside that
 * little area we're going to have all the agents that were active in the last 24
 * hours or were just created in the last 24 hours. … They might be idle but they
 * just show up there. … Below that would be another one … last seven days … and
 * then under that would be like last thirty days … And then one more that says
 * like earlier … any agents that were active like over thirty days … a lot of
 * these would be ended agents. So basically if it's an ended agent but they were
 * active last thirty days … that should be in … the respective gray boxes."*
 *
 * ⚠ **A BUCKET IS ABOUT TIME, NEVER ABOUT STATE.** Ended, idle, waiting and
 * working agents sit together in whichever well their last activity falls in —
 * that is the whole of *"if it's an ended agent but they were active last thirty
 * days … the respective gray boxes"*. Nothing here reads `state`, and nothing here
 * may start to: liveness is already said on the card (`agents-model.ts ›
 * agentLiveness`) and saying it twice, once as a heading, is how the two come to
 * disagree.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import {
  RECENCY_WELLS,
  RecencyWell,
  RecencyWells,
  useRecencyWells,
  type RecencyWellId,
  type RecencyWellItem,
} from "./recency-wells";

// ⚠ THE SPANS, THE BUCKETING FUNCTION, THE COLLAPSE TIMER AND THE WELL COMPONENT
// ARE RE-EXPORTED UNDER THIS TAB'S OWN NAMES, not re-implemented — `agents-tab.tsx`
// and this file's suite name them, and the Threads tab reads the generic module
// directly. A renamed export here would be a second vocabulary for one recipe.
export { wellFor, WELL_COLLAPSE_MS } from "./recency-wells";

/** The four wells, in the order Samuel dictated them. ⚠ ONE ARRAY, SHARED — the
 *  Threads tab groups by the same spans, so a fifth span is one edit. */
export const AGENT_WELLS = RECENCY_WELLS;
export type AgentWellId = RecencyWellId;
/** One agent card, with the stamp that files it. */
export type AgentWellItem = RecencyWellItem;
/** ⚠ RE-EXPORTED, NOT WRAPPED, AND UNDER THE NAME IT HAD — a surface that needs
 *  ONE well mounts the same component the generic module declares. */
export const AgentWell = RecencyWell;

/**
 * WHEN THIS AGENT LAST MATTERED — `max(startedAt, lastActivityAt ?? endedAt)`,
 * epoch ms, or `null` when this build measured none of them.
 *
 * ⚠ **THESE ARE THE FIELDS THAT EXIST, MEASURED RATHER THAN ASSUMED.**
 * `spa-bridge-shapes.ts › DesktopSessionSummary` carries `startedAt` (*"when the
 * desktop created this session object"* — there is no `createdAt` on this wire),
 * `lastActivityAt` (*"epoch ms of the last engine state change"*) and `endedAt`.
 * `startedAt` IS the creation stamp Samuel's *"or were just created in the last 24
 * hours"* asks for, and the MAX is what makes that clause an OR rather than a
 * second pass.
 *
 * ⚠ **EVERY ONE OF THE THREE IS OPTIONAL AND NULLABLE, AND `null` IS NEVER ZERO**
 * (INVARIANTS §11) — an older main omits them, and `Math.max` over a coerced
 * `null` would date every such agent to 1970 and file it under **Earlier**, which
 * is a fabricated fact about when it ran. The reduce therefore skips non-finite
 * values and answers `null` when nothing survived.
 */
export function agentActivityAt(
  session: DesktopSessionSummary & { endedAt?: number | null }
): number | null {
  const stamps = [session.startedAt, session.lastActivityAt ?? session.endedAt];
  let best: number | null = null;
  for (const s of stamps) {
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    if (best === null || s > best) best = s;
  }
  return best;
}

/**
 * THE SAME QUESTION FOR A PEER ROW, AND IT HAS EXACTLY ONE STAMP TO ANSWER WITH.
 * `types-sessions.ts › ChannelSessionState` is the COARSE cross-machine projection
 * — no `startedAt`, no `lastActivityAt`, no `endedAt`, by design (those are
 * operator-only, §5) — so `updatedAt` is the whole of what a peer card knows.
 *
 * ⚠ **IT IS NOT A HEARTBEAT AND THIS IS NOT A LIVENESS READ.** `updated_at` moves
 * on a projection CHANGE (`agents-model.ts › peerRowStale` says so at length), and
 * using it to decide which gray box a card sits in is a much weaker claim than
 * using it to decide whether the card exists — which remains forbidden.
 * ⚠ **UNPARSEABLE READS AS UNKNOWN**, not as old: see `recency-wells.tsx ›
 * wellFor`.
 */
export function peerActivityAt(peer: Pick<ChannelPeerSession, "updatedAt">): number | null {
  const ts = peer.updatedAt ? new Date(peer.updatedAt).getTime() : NaN;
  return Number.isNaN(ts) ? null : ts;
}

/**
 * THIS TAB'S PERSISTED OPEN STATE. ⚠ **ITS OWN KEY, NOT SHARED WITH THE THREADS
 * TAB's `dopl.threads.wells`** — collapsing **Earlier** over agents is not a
 * statement about threads.
 */
export const AGENT_WELLS_STORAGE_KEY = "dopl.agents.wells";

/** ⚠ THE HOOK KEEPS ITS NAME so this tab reads its own key once, in one place. */
export function useAgentWells(): {
  isOpen: (id: AgentWellId) => boolean;
  toggle: (id: AgentWellId) => void;
} {
  return useRecencyWells(AGENT_WELLS_STORAGE_KEY);
}

/**
 * THE FOUR WELLS OVER ONE ORDERED LIST OF AGENT CARDS.
 *
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL** — own-agents-first (§5) and
 * the feed's own thread grouping (`agents-model.ts › agentsForChannel`) reach each
 * box intact. Nothing here sorts.
 * ⚠ **IT ADDS EXACTLY ONE FACT TO `RecencyWells`: the key.** `now` is passed
 * through so a test can state an age; the render passes nothing.
 */
export function AgentWells({
  items,
  now,
}: {
  items: readonly AgentWellItem[];
  now?: number;
}) {
  return (
    <RecencyWells items={items} storageKey={AGENT_WELLS_STORAGE_KEY} now={now} />
  );
}
