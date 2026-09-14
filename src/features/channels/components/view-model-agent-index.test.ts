/**
 * 🔒 THE AGENT INDEX'S IDENTITY IS A FUNCTION OF ITS CONTENT (2026-08-28).
 *
 * ⚠ THE COLLISION THIS PINS. The 2026-08-27 rename wave routed the desktop session feed into
 * `AuthorIndex.agents` so a rename would reach the transcript without a refetch — correct, and it
 * memoised on the feed array. But that array is paced by TELEMETRY, not by names:
 * `main/session-summary.js › summariesDigest` is `JSON.stringify(list)` over rows that spread
 * `session-metrics.js › metrics`, whose `lastActivityAt` "moves on every dispatch", and the push
 * coalesces at 200ms. So one working agent handed the hook a brand-new array ~5×/sec, `indexAgents`
 * minted a new `Map` every time, `index` moved, and `rows` rebuilt — and neither `transcript.tsx`
 * nor `message-markdown.tsx` memoises, so every message re-ran `marked.lexer` and both mention-index
 * builds, five times a second, for as long as an agent was working.
 *
 * ⚠ WHAT MAKES THE FIX CORRECT IS THE ROUND TRIP, so that is what this file asserts: the key must
 * capture exactly the fields the index renders (so a rename cannot be swallowed) and nothing else
 * (so telemetry cannot move it). Those two are the same test read in opposite directions.
 *
 * ⚠ THE IDLE PATH IS PINNED TOO. It is what HID the bug — an empty feed returns the shared
 * `NO_AGENTS`, so `index` never moved and the churn only ever appeared while an agent ran.
 */

import { describe, expect, it } from "vitest";
import { agentIndexFromKey, agentIndexKey, indexAgents } from "./view-model";

const FEED = [
  { agentId: "k3v7d2mq", displayName: "Research Bot", description: "reads the docs" },
  { agentId: "zzzzzzzz", displayName: null, description: null },
];

/** What the hook does, end to end. */
const stabilize = (feed: Parameters<typeof indexAgents>[0]) =>
  agentIndexFromKey(agentIndexKey(indexAgents(feed)));

describe("the key round-trips the index exactly", () => {
  it("preserves every field the transcript renders", () => {
    expect([...stabilize(FEED).entries()]).toEqual([...indexAgents(FEED).entries()]);
  });

  it("gives the SAME key for the same identities — telemetry must not move it", () => {
    // ⚠ THE FIELDS THAT CHURN ARE NOT IN THE KEY BECAUSE THEY ARE NOT IN THE INDEX. Sending them
    // through proves the seam holds at the place the bug actually was: the feed row, not the map.
    const later = FEED.map((a, i) => ({
      ...a,
      lastActivityAt: 1_700_000_000_000 + i,
      tokensSpent: 999,
      contextUsed: 84_000,
    }));
    expect(agentIndexKey(indexAgents(later))).toBe(agentIndexKey(indexAgents(FEED)));
  });

  it("MOVES on a rename, which is the property the original memo existed for", () => {
    const renamed = [{ ...FEED[0], displayName: "Scout" }, FEED[1]];
    expect(agentIndexKey(indexAgents(renamed))).not.toBe(agentIndexKey(indexAgents(FEED)));
  });

  it("MOVES on a describe, and on an agent joining or leaving", () => {
    const described = [{ ...FEED[0], description: "reads the specs" }, FEED[1]];
    expect(agentIndexKey(indexAgents(described))).not.toBe(agentIndexKey(indexAgents(FEED)));
    expect(agentIndexKey(indexAgents([FEED[0]]))).not.toBe(agentIndexKey(indexAgents(FEED)));
  });

  it("cannot be forged by a name that looks like the delimiter", () => {
    // ⚠ A PRINTABLE SEPARATOR WOULD MAKE THESE TWO ROOMS KEY THE SAME. Both control characters are
    // refused by `main/agent-names.js`, so this is belt — but it is the reason for the choice.
    const a = [{ agentId: "aaaaaaaa", displayName: "x", description: "y|z" }];
    const b = [{ agentId: "aaaaaaaa", displayName: "x|y", description: "z" }];
    expect(agentIndexKey(indexAgents(a))).not.toBe(agentIndexKey(indexAgents(b)));
  });

  it("holds the EMPTY case still — the identity that hid the bug", () => {
    // ⚠ ONE SHARED INSTANCE, not a fresh Map: this is why the web tree and the pop-out never
    // churned, and it must keep being true or they start to.
    expect(agentIndexKey(indexAgents(null))).toBe("");
    expect(agentIndexFromKey("")).toBe(agentIndexFromKey(""));
    expect(agentIndexFromKey("")).toBe(indexAgents([]));
    expect(agentIndexFromKey("").size).toBe(0);
  });
});
