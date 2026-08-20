"use client";

/**
 * "ANTHONY'S AGENT IS WORKING…" — the peer-activity row above the composer
 * (2026-08-20).
 *
 * ⚠ IT SAYS "WORKING", NOT "THINKING", AND THAT IS A DESIGN DECISION RATHER THAN
 * A LIMITATION WE ARE APOLOGISING FOR. The operator's own cards carry the finer
 * word (`agents-model.ts › agentDetailLabel` over the desktop's local `detail`
 * signal), and the cross-machine wire deliberately does not: `channel_sessions`
 * carries `working | idle | ended` and nothing else. Widening THAT vocabulary
 * costs a migration, a zod enum, a duplicated SDK type with tracked `dist`, the
 * MCP renderer's membership set and its description prose, and a one-way
 * ship-order gate whose failure mode is a 400 that unretryably kills every later
 * push for the workspace (INVARIANTS §11) — to buy a distinction a PEER cannot
 * act on. Fine-grained activity is LOCAL; coarse state is CROSS-MACHINE.
 *
 * ⚠ LIVENESS IS THE ROW'S OWN ARITHMETIC, over `updatedAt`, and it fails toward
 * SILENCE. `channel_sessions` rows outlive the process that wrote them —
 * `session-state-push.js` says so in its own header ("rows outlive the process
 * that wrote them… NOT covered: signing out"). A crashed desktop therefore
 * leaves a row reading `working` forever, and an indicator that believes it is
 * strictly worse than no indicator: the reader waits for a reply from a machine
 * that is gone. So a row older than the window renders NOTHING.
 *
 * ⚠ THE WINDOW IS THE PRESENCE ONE, DELIBERATELY REUSED. `PRESENCE_ONLINE_WINDOW_MS`
 * already answers "is this member's machine alive" for the roster dots
 * (`view-model.ts › isPresent`, INVARIANTS §7). A second staleness number would
 * let the roster call a member offline while this row says their agent is
 * working — two surfaces, two clocks, one visible contradiction.
 */

import { Avatar } from "@/shared/ui/avatar";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import type { ChannelMember } from "../../types";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { memberPerson, shortName } from "./view-model";

/**
 * OTHER members' agents live on THIS thread, right now. Pure and exported for
 * the test.
 *
 * ⚠ FOUR PREDICATES AND EVERY ONE FAILS CLOSED. Not mine (my own agent is on the
 * Agents tab with far better data); `working` only (an `idle` peer agent is not
 * doing anything a reader should wait for); this thread only; and fresh only.
 * An unparseable or absent `updatedAt` reads as STALE rather than as fresh —
 * `Number.isNaN` on the parse is the whole guard, and it points the safe way.
 */
export function peerWorkingOn(
  peers: readonly ChannelPeerSession[],
  currentUserId: string | null,
  threadId: string | null,
  now: number = Date.now(),
  windowMs: number = PRESENCE_ONLINE_WINDOW_MS
): ChannelPeerSession[] {
  if (!threadId) return [];
  return peers.filter((p) => {
    if (p.userId === currentUserId) return false;
    if (p.state !== "working") return false;
    if (p.threadId !== threadId) return false;
    const ts = p.updatedAt ? new Date(p.updatedAt).getTime() : NaN;
    if (Number.isNaN(ts)) return false;
    return now - ts < windowMs;
  });
}

/**
 * The sentence, from the live rows and the roster. Pure and exported so the
 * plural boundary is testable without a DOM.
 *
 * ⚠ A NAME WE DO NOT HAVE IS NOT A BLANK. The roster read and the session read
 * are separate requests, so a peer's row can arrive before their member row
 * does. "Someone's agent" is true and stays true; an empty possessive reads as
 * a rendering bug.
 */
export function peerActivityText(
  peers: readonly ChannelPeerSession[],
  byUser: ReadonlyMap<string, ChannelMember>,
  currentUserId: string
): string | null {
  if (peers.length === 0) return null;
  if (peers.length === 1) {
    const owner = byUser.get(peers[0].userId);
    // ⚠ `shortName` is the roster's own display rule (first name, with the
    // blank-field fallbacks its docblock earned) — the byline and this row must
    // not shorten one member two different ways.
    const who = owner ? shortName(memberPerson(owner), currentUserId) : "Someone";
    return `${who}'s agent is working…`;
  }
  // Above one, the names stop earning their width — the row is a caption beside
  // a composer, not a roster.
  return `${peers.length} agents are working…`;
}

/**
 * The row itself. Renders NOTHING when nobody is working, rather than an empty
 * reserved strip: this sits directly above the composer, and a permanent blank
 * band there is chrome the surface has to pay for on every thread.
 */
export function PeerActivityRow({
  peers,
  byUser,
  currentUserId,
}: {
  /** Already filtered by {@link peerWorkingOn} — this component does not decide. */
  peers: readonly ChannelPeerSession[];
  byUser: ReadonlyMap<string, ChannelMember>;
  currentUserId: string;
}) {
  const text = peerActivityText(peers, byUser, currentUserId);
  if (!text) return null;
  const owner = peers.length === 1 ? byUser.get(peers[0].userId) : null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-8 py-1.5"
    >
      {owner && <Avatar person={memberPerson(owner)} size="xs" />}
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none"
      />
      <span className="min-w-0 truncate text-caption text-text-secondary">{text}</span>
    </div>
  );
}
