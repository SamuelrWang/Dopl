/**
 * `engagedAt` is a FACT the server never expires, so every reader applies the
 * TTL itself — which makes the BOUNDARY the thing worth pinning: an agent one
 * millisecond past the window is idle, not "probably still fine", because the
 * desktop applies the same window before it acts on an untagged message. Both
 * ends of that window are pinned, the future one because an unbounded skew
 * tolerance shows every agent engaged forever on a wrong clock.
 *
 * Then the two facts a live stamp does NOT establish — the process is running,
 * and the machine it runs on is connected — and `nextEngagementExpiry`, which
 * is where "when should the bar re-render" lives so that it can be tested at
 * all rather than being buried in an effect. The rest pins the defensive reads:
 * nothing here may throw on a row from an older build.
 *
 * THE STATE MACHINE ONLY. What the chip says about the result, and the write it
 * gates, live in `agent-engagement-chip.test.ts` (§2 split).
 */

import { describe, expect, it } from "vitest";
import {
  deriveAgentEngagement,
  ENGAGEMENT_TTL_MS,
  engagementTickDelay,
  isEngaged,
  isListening,
  MIN_ENGAGEMENT_TICK_MS,
  nextEngagementExpiry,
  readAgentEngagedAt,
  readAgentEngagedBy,
  type AgentEngagement,
} from "./agent-engagement";
import { ENGAGEMENT_TTL_MS as SHARED_TTL } from "../constants";
import type { ChannelAgent } from "../types";

const ME = "u-me";
const ADA = "u-ada";
const NOW = Date.parse("2026-07-31T12:00:00.000Z");

/** An owner whose desktop is / is not heartbeating. */
const ONLINE = { agentOnline: true };
const OFFLINE = { agentOnline: false };

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: ME,
    name: "quartz",
    status: "active",
    engagedAt: null,
    engagedBy: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

/** An agent whose engagement stamp is `ageMs` old relative to NOW. */
function aged(ageMs: number, over: Partial<ChannelAgent> = {}) {
  return agent({ engagedAt: new Date(NOW - ageMs).toISOString(), ...over });
}

describe("ENGAGEMENT_TTL_MS", () => {
  it("IS the shared constant, not a second copy that can drift", () => {
    expect(ENGAGEMENT_TTL_MS).toBe(SHARED_TTL);
    expect(ENGAGEMENT_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe("deriveAgentEngagement — the TTL boundary", () => {
  it("is ENGAGED one millisecond inside the window", () => {
    expect(deriveAgentEngagement(aged(ENGAGEMENT_TTL_MS - 1), NOW)).toBe(
      "engaged"
    );
  });

  it("is IDLE exactly ON the boundary (the window is exclusive)", () => {
    expect(deriveAgentEngagement(aged(ENGAGEMENT_TTL_MS), NOW)).toBe("idle");
  });

  it("is IDLE one millisecond past it", () => {
    expect(deriveAgentEngagement(aged(ENGAGEMENT_TTL_MS + 1), NOW)).toBe("idle");
  });

  it("is engaged on a fresh stamp", () => {
    expect(deriveAgentEngagement(aged(0), NOW)).toBe("engaged");
  });

  it("tolerates a stamp in the future (clock skew) as engaged", () => {
    expect(deriveAgentEngagement(aged(-5_000), NOW)).toBe("engaged");
  });
});

/**
 * The future side of the window is BOUNDED, and the reason is not symmetry. An
 * unbounded "negative age means skew" branch is the one failure that never
 * corrects itself: a client whose clock is grossly wrong reads EVERY stamp as
 * future, so EVERY agent shows engaged forever and no amount of waiting or
 * refetching changes it.
 */
describe("deriveAgentEngagement — a grossly skewed clock", () => {
  it("still tolerates a stamp just inside one TTL of the future", () => {
    expect(deriveAgentEngagement(aged(-(ENGAGEMENT_TTL_MS - 1)), NOW)).toBe(
      "engaged"
    );
  });

  it("is IDLE exactly one TTL into the future (the bound is exclusive too)", () => {
    expect(deriveAgentEngagement(aged(-ENGAGEMENT_TTL_MS), NOW)).toBe("idle");
  });

  it("refuses a stamp a whole day in the future", () => {
    expect(deriveAgentEngagement(aged(-24 * 60 * 60_000), NOW)).toBe("idle");
  });

  it("shows NOTHING engaged when a wrong clock puts every stamp years ahead", () => {
    const skewed = [
      aged(-400 * 24 * 60 * 60_000, { id: "a1" }),
      aged(-400 * 24 * 60 * 60_000, { id: "a2" }),
    ];
    for (const a of skewed) expect(deriveAgentEngagement(a, NOW)).toBe("idle");
    // And it schedules no wake either, so the bar cannot spin on it.
    expect(nextEngagementExpiry(skewed, NOW)).toBeNull();
  });
});

/**
 * A LIVE STAMP IS NOT ENOUGH. The agent runs on its owner's machine and inside
 * a process its owner can suspend; either being gone means nothing acts on the
 * next untagged message, however fresh the stamp is. Both states keep the word
 * "engaged" because the engagement genuinely survives, and both must be
 * distinguishable from plain engaged, or the chip is back to promising work
 * that will not happen.
 */
describe("deriveAgentEngagement — engaged but HELD", () => {
  it("is ENGAGED when the owner's desktop is online", () => {
    expect(deriveAgentEngagement(aged(0), NOW, ONLINE)).toBe("engaged");
  });

  it("does NOT read as listening when the owner's desktop is offline", () => {
    expect(deriveAgentEngagement(aged(0), NOW, OFFLINE)).toBe("engaged-offline");
  });

  it("does NOT downgrade an offline owner's agent to idle (it resumes)", () => {
    const state = deriveAgentEngagement(aged(0), NOW, OFFLINE);
    expect(state).not.toBe("idle");
    expect(isEngaged(state)).toBe(true);
    expect(isListening(state)).toBe(false);
  });

  it("treats an UNKNOWN owner as unknown, never as offline", () => {
    // Roster still loading, or the owner is no longer a channel member. An
    // absent row is not evidence their machine is gone.
    expect(deriveAgentEngagement(aged(0), NOW, undefined)).toBe("engaged");
    expect(deriveAgentEngagement(aged(0), NOW, null)).toBe("engaged");
  });

  it("never claims a PARKED agent is listening, however fresh the stamp", () => {
    const state = deriveAgentEngagement(aged(0, { status: "parked" }), NOW);
    expect(state).toBe("engaged-parked");
    expect(isListening(state)).toBe(false);
  });

  it("says PARKED first when a parked agent's owner is also offline", () => {
    // The more specific, more actionable fact wins: resuming it is a click,
    // reconnecting somebody else's laptop is not.
    expect(
      deriveAgentEngagement(aged(0, { status: "parked" }), NOW, OFFLINE)
    ).toBe("engaged-parked");
  });

  it("still expires a held agent (held is not a way to dodge the TTL)", () => {
    expect(
      deriveAgentEngagement(
        aged(ENGAGEMENT_TTL_MS + 1, { status: "parked" }),
        NOW,
        OFFLINE
      )
    ).toBe("idle");
  });

  it("holds nothing over an agent that was never engaged", () => {
    expect(deriveAgentEngagement(agent({ status: "parked" }), NOW)).toBe("idle");
    expect(deriveAgentEngagement(agent(), NOW, OFFLINE)).toBe("idle");
  });

  it("answers the bar's question for exactly one state", () => {
    const states: AgentEngagement[] = [
      "engaged",
      "engaged-offline",
      "engaged-parked",
      "idle",
    ];
    expect(states.filter(isListening)).toEqual(["engaged"]);
    expect(states.filter(isEngaged)).toEqual([
      "engaged",
      "engaged-offline",
      "engaged-parked",
    ]);
  });
});

/**
 * WHEN THE BAR GOES STALE. This is the whole reason the chip can be trusted a
 * minute after it was rendered: the surface schedules a wake at the instant
 * returned here. Null MUST mean "schedule nothing" — an idle channel that woke
 * on a timer would be the F-072 shape in a component.
 */
describe("nextEngagementExpiry", () => {
  it("returns the instant the single engaged agent falls out of the window", () => {
    expect(nextEngagementExpiry([aged(60_000)], NOW)).toBe(
      NOW - 60_000 + ENGAGEMENT_TTL_MS
    );
  });

  it("returns the SOONEST expiry when several are engaged", () => {
    const soonest = nextEngagementExpiry(
      [
        aged(10_000, { id: "a1" }),
        aged(ENGAGEMENT_TTL_MS - 1_000, { id: "a2" }),
        aged(120_000, { id: "a3" }),
      ],
      NOW
    );
    // a2 is the oldest live stamp, so it is the first to expire.
    expect(soonest).toBe(NOW - (ENGAGEMENT_TTL_MS - 1_000) + ENGAGEMENT_TTL_MS);
  });

  it("is null when NOTHING is engaged (no timer at all)", () => {
    expect(nextEngagementExpiry([agent(), agent({ id: "a2" })], NOW)).toBeNull();
  });

  it("is null on an empty roster", () => {
    expect(nextEngagementExpiry([], NOW)).toBeNull();
  });

  it("is null when every stamp has ALREADY expired", () => {
    expect(
      nextEngagementExpiry(
        [
          aged(ENGAGEMENT_TTL_MS, { id: "a1" }),
          aged(ENGAGEMENT_TTL_MS + 60_000, { id: "a2" }),
        ],
        NOW
      )
    ).toBeNull();
  });

  it("IGNORES a dismissed agent, whatever its stamp says", () => {
    expect(
      nextEngagementExpiry([aged(0, { status: "dismissed" })], NOW)
    ).toBeNull();
  });

  it("ignores the expired ones while a live one remains", () => {
    expect(
      nextEngagementExpiry(
        [
          aged(ENGAGEMENT_TTL_MS + 60_000, { id: "a1" }),
          aged(90_000, { id: "a2" }),
        ],
        NOW
      )
    ).toBe(NOW - 90_000 + ENGAGEMENT_TTL_MS);
  });

  it("ignores rows with no stamp, and unparseable ones, without throwing", () => {
    expect(
      nextEngagementExpiry(
        [agent({ id: "a1" }), agent({ id: "a2", engagedAt: "not a date" })],
        NOW
      )
    ).toBeNull();
  });

  it("SCHEDULES a held agent too (its chip changes at that instant as well)", () => {
    // Parked / owner-offline chips still flip to Idle when the TTL elapses,
    // and presence is not something a clock can predict, so the expiry is a
    // pure time question here.
    expect(
      nextEngagementExpiry([aged(30_000, { status: "parked" })], NOW)
    ).toBe(NOW - 30_000 + ENGAGEMENT_TTL_MS);
  });

  it("never returns an instant in the past", () => {
    const at = nextEngagementExpiry([aged(ENGAGEMENT_TTL_MS - 1)], NOW);
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThan(NOW);
  });
});

/**
 * The other half of the scheduling decision. `nextEngagementExpiry` says WHEN
 * the bar goes stale; this says how long to sleep for it — and both clamps
 * exist to stop a timer from becoming a render loop, which is the one failure
 * mode a ticking surface cannot recover from on its own.
 */
describe("engagementTickDelay", () => {
  it("sleeps exactly until the expiry in the ordinary case", () => {
    expect(engagementTickDelay(NOW + 90_000, NOW)).toBe(90_000);
  });

  it("FLOORS an expiry that is already upon us (never a zero-delay spin)", () => {
    expect(engagementTickDelay(NOW, NOW)).toBe(MIN_ENGAGEMENT_TICK_MS);
  });

  it("floors an expiry already in the past rather than going negative", () => {
    expect(engagementTickDelay(NOW - 5_000, NOW)).toBe(MIN_ENGAGEMENT_TICK_MS);
  });

  it("CEILINGS a pathological delay below the 32-bit setTimeout overflow", () => {
    // Past 2^31-1 a delay wraps and setTimeout fires immediately, turning the
    // guard against a bad clock into the render loop it was meant to prevent.
    const delay = engagementTickDelay(NOW + 4_000_000_000, NOW);
    expect(delay).toBe(2_147_483_647);
    expect(delay).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it("always returns a delay a timer can actually take", () => {
    for (const expiry of [NOW - 1e12, NOW, NOW + 1, NOW + 1e12]) {
      const delay = engagementTickDelay(expiry, NOW);
      expect(delay).toBeGreaterThanOrEqual(MIN_ENGAGEMENT_TICK_MS);
      expect(delay).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
});

describe("deriveAgentEngagement — idle is the answer without evidence", () => {
  it("reads an agent that was never engaged as idle", () => {
    expect(deriveAgentEngagement(agent(), NOW)).toBe("idle");
  });

  it("reads a null stamp as idle", () => {
    expect(deriveAgentEngagement(agent({ engagedAt: null }), NOW)).toBe("idle");
  });

  it("reads an unparseable stamp as idle rather than throwing", () => {
    expect(deriveAgentEngagement(agent({ engagedAt: "not a date" }), NOW)).toBe(
      "idle"
    );
  });

  it("reads a non-string stamp as idle (a wire value is not a promise)", () => {
    const rogue = agent({ engagedAt: 1234 as unknown as string });
    expect(deriveAgentEngagement(rogue, NOW)).toBe("idle");
  });

  it("never calls a DISMISSED agent engaged, whatever its stamp says", () => {
    expect(deriveAgentEngagement(aged(0, { status: "dismissed" }), NOW)).toBe(
      "idle"
    );
  });
});

describe("engagement field reads", () => {
  it("returns the raw stamp when present", () => {
    const stamp = "2026-07-31T11:30:00.000Z";
    expect(readAgentEngagedAt(agent({ engagedAt: stamp }))).toBe(stamp);
  });

  it("returns null for absent / empty fields", () => {
    expect(readAgentEngagedAt(agent())).toBeNull();
    expect(readAgentEngagedAt(agent({ engagedAt: "" }))).toBeNull();
    expect(readAgentEngagedBy(agent())).toBeNull();
  });

  it("returns who engaged it", () => {
    expect(readAgentEngagedBy(agent({ engagedBy: ADA }))).toBe(ADA);
  });
});

