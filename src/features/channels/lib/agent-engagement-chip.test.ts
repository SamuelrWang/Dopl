/**
 * WHAT THE CHIP SAYS AND OFFERS, split out of `agent-engagement.test.ts` (§2)
 * because it is a different reason to change: that file pins the STATE MACHINE
 * (when a stamp is live, what holds it, when the surface must re-read), this
 * one pins the words and the treatments that state the result, plus the one
 * write affordance gated on it.
 *
 * The through-line here is that NOTHING may rest on color alone and nothing may
 * promise behavior the desktop will refuse: three treatments, three distinct
 * words, and a hint per state that says what to expect rather than what is.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_ENGAGEMENT_LABEL,
  AGENT_ENGAGEMENT_TAG,
  agentEngagedByLabel,
  agentEngagementChipClass,
  agentEngagementHint,
  agentEngagementTagClass,
  canDisengageAgent,
  ENGAGEMENT_TTL_MS,
  type AgentEngagement,
} from "./agent-engagement";
import type { ChannelAgent } from "../types";

const ME = "u-me";
const ADA = "u-ada";
const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const NAMES = new Map([
  [ME, "Me"],
  [ADA, "Ada"],
]);

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

describe("canDisengageAgent — owner-only", () => {
  const engaged = () => aged(0);

  it("lets the OWNER disengage their engaged agent", () => {
    expect(canDisengageAgent(engaged(), ME, NOW)).toBe(true);
  });

  it("refuses a NON-owner, even though they can see the chip", () => {
    expect(canDisengageAgent(engaged(), ADA, NOW)).toBe(false);
  });

  it("refuses a viewer with no id at all", () => {
    expect(canDisengageAgent(engaged(), undefined, NOW)).toBe(false);
  });

  it("refuses on an agent that is already idle (nothing to disengage from)", () => {
    expect(canDisengageAgent(aged(ENGAGEMENT_TTL_MS + 1), ME, NOW)).toBe(false);
  });

  it("refuses on a dismissed agent (retired, not editable)", () => {
    expect(canDisengageAgent(aged(0, { status: "dismissed" }), ME, NOW)).toBe(
      false
    );
  });

  it("STILL offers it on a parked agent (there is a stamp to clear)", () => {
    // Refusing here would mean an owner had to resume an agent before they
    // could stop it listening, which is the opposite of what they asked for.
    expect(canDisengageAgent(aged(0, { status: "parked" }), ME, NOW)).toBe(true);
  });
});

/**
 * WHO ENGAGED IT. The peer who engaged a teammate's agent is the person most
 * likely to want Disengage and the one person the web hides it from, so the
 * popover owes them a sentence rather than a chip that looks broken.
 */
describe("agentEngagedByLabel", () => {
  it("says nothing when nothing is engaged", () => {
    expect(agentEngagedByLabel(agent({ engagedBy: ADA }), NAMES, ME, NOW)).toBe(
      null
    );
  });

  it("says nothing when the row carries no engaged_by", () => {
    expect(agentEngagedByLabel(aged(0), NAMES, ME, NOW)).toBeNull();
  });

  it("names the teammate who engaged it", () => {
    expect(agentEngagedByLabel(aged(0, { engagedBy: ADA }), NAMES, ME, NOW)).toBe(
      "Ada engaged it."
    );
  });

  it("falls back to a neutral phrase for someone off the roster", () => {
    expect(
      agentEngagedByLabel(aged(0, { engagedBy: "u-gone" }), NAMES, ME, NOW)
    ).toBe("A teammate engaged it.");
  });

  it("tells the OWNER plainly that they engaged their own agent", () => {
    expect(agentEngagedByLabel(aged(0, { engagedBy: ME }), NAMES, ME, NOW)).toBe(
      "You engaged it."
    );
  });

  it("tells a PEER who engaged it why they have no Disengage button", () => {
    // ADA engaged an agent ME owns, and is viewing it.
    const theirs = aged(0, { ownerUserId: ME, engagedBy: ADA });
    expect(agentEngagedByLabel(theirs, NAMES, ADA, NOW)).toBe(
      "You engaged it. Only its owner can disengage it here."
    );
    // Which is the truth: the web gate really does refuse them.
    expect(canDisengageAgent(theirs, ADA, NOW)).toBe(false);
  });

  it("still says who engaged a HELD agent (the fact outlives the hold)", () => {
    expect(
      agentEngagedByLabel(
        aged(0, { status: "parked", engagedBy: ADA }),
        NAMES,
        ME,
        NOW
      )
    ).toBe("Ada engaged it.");
  });

  it("uses no em dashes (product copy rule)", () => {
    const lines = [
      agentEngagedByLabel(aged(0, { engagedBy: ADA }), NAMES, ME, NOW),
      agentEngagedByLabel(aged(0, { engagedBy: ME }), NAMES, ME, NOW),
      agentEngagedByLabel(
        aged(0, { ownerUserId: ME, engagedBy: ADA }),
        NAMES,
        ADA,
        NOW
      ),
    ];
    for (const line of lines) expect(line).not.toContain("—");
  });
});

const ALL_STATES: AgentEngagement[] = [
  "engaged",
  "engaged-offline",
  "engaged-parked",
  "idle",
];

describe("engagement copy + treatment", () => {
  it("labels every state in words, so the chip never relies on color", () => {
    expect(AGENT_ENGAGEMENT_LABEL.engaged).toBe("Engaged");
    expect(AGENT_ENGAGEMENT_LABEL["engaged-offline"]).toBe(
      "Engaged, owner offline"
    );
    expect(AGENT_ENGAGEMENT_LABEL["engaged-parked"]).toBe("Engaged, parked");
    expect(AGENT_ENGAGEMENT_LABEL.idle).toBe("Idle");
  });

  it("gives each state a DIFFERENT in-chip word", () => {
    const tags = ALL_STATES.map((s) => AGENT_ENGAGEMENT_TAG[s]);
    expect(tags).toEqual(["Engaged", "Offline", "Parked", "Idle"]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("tells an engaged agent's reader they can talk without tagging", () => {
    expect(agentEngagementHint("engaged", "quartz")).toBe(
      "Listening to this channel; you can talk without tagging."
    );
  });

  it("tells an idle agent's reader exactly how to bring it in", () => {
    expect(agentEngagementHint("idle", "quartz")).toBe(
      "Tag @quartz to bring it in."
    );
  });

  it("tells an OFFLINE owner's reader that it resumes on its own", () => {
    expect(agentEngagementHint("engaged-offline", "quartz")).toBe(
      "Still engaged, but its owner's desktop is offline. Nothing runs here until they reconnect."
    );
  });

  it("tells a PARKED agent's reader that somebody has to resume it", () => {
    expect(agentEngagementHint("engaged-parked", "quartz")).toBe(
      "Still engaged, but parked. Nothing runs here until its owner resumes it."
    );
  });

  it("never tells a held reader they can talk without tagging", () => {
    for (const state of ["engaged-offline", "engaged-parked"] as const) {
      expect(agentEngagementHint(state, "quartz")).not.toContain(
        "without tagging"
      );
    }
  });

  it("uses no em dashes anywhere (product copy rule)", () => {
    for (const state of ALL_STATES) {
      expect(agentEngagementHint(state, "quartz")).not.toContain("—");
      expect(AGENT_ENGAGEMENT_LABEL[state]).not.toContain("—");
    }
  });

  it("gives the states distinguishable, token-only chip recipes", () => {
    const lit = agentEngagementChipClass("engaged");
    const held = agentEngagementChipClass("engaged-offline");
    const hollow = agentEngagementChipClass("idle");
    expect(new Set([lit, held, hollow]).size).toBe(3);
    expect(lit).toContain("bg-bg-elevated");
    expect(hollow).toContain("border-dashed");
    // HELD is neither: a solid hairline (the engagement is intact) over the
    // flat inset fill (nothing is running).
    expect(held).not.toContain("border-dashed");
    expect(held).toContain("bg-bg-inset");
    // Both held states share the one treatment.
    expect(agentEngagementChipClass("engaged-parked")).toBe(held);
    // Design system: tokens only, never a hex or a raw px size.
    expect(`${lit} ${held} ${hollow}`).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("never hovers a non-engaged chip onto the ENGAGED chip's resting fill", () => {
    // `bg-bg-elevated-hover` is the elevated family, i.e. what an engaged chip
    // already looks like at rest. A chip that adopts it under the cursor
    // impersonates the state the bar exists to distinguish.
    for (const state of ["engaged-offline", "engaged-parked", "idle"] as const) {
      expect(agentEngagementChipClass(state)).not.toContain(
        "hover:bg-bg-elevated"
      );
    }
    expect(agentEngagementChipClass("engaged")).toContain(
      "hover:bg-bg-elevated-hover"
    );
  });

  it("inks the tag live / held / faint, in tokens", () => {
    expect(agentEngagementTagClass("engaged")).toBe("text-success");
    expect(agentEngagementTagClass("engaged-offline")).toBe("text-warning");
    expect(agentEngagementTagClass("engaged-parked")).toBe("text-warning");
    expect(agentEngagementTagClass("idle")).toBe("text-text-muted");
  });
});
