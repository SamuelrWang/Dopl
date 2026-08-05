import { describe, expect, it } from "vitest";
import {
  agentAttributionFor,
  agentOwnerLabel,
  readAuthorAgentId,
} from "./agent-display";
import type { ChannelAgent } from "../types";

/**
 * HISTORICAL ATTRIBUTION, and only that. The handle charset, the status labels,
 * the owner rule and the addressable-state predicates were all pinned here and
 * all went with named agents (rollback §1). What must not regress is the one
 * thing the rollback promised to preserve: a message posted by an agent BEFORE
 * the rollback still renders with its handle.
 */

const ME = "u-me";
const ADA = "u-ada";
const NAMES = new Map([
  [ME, "Me"],
  [ADA, "Ada"],
]);

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return { id: "a1", ownerUserId: ADA, name: "quartz", ...over };
}

describe("readAuthorAgentId", () => {
  it("reads a stamped id", () => {
    expect(readAuthorAgentId({ author_agent_id: "a1" })).toBe("a1");
  });

  it("is defensive about the jsonb bag", () => {
    expect(readAuthorAgentId(null)).toBeNull();
    expect(readAuthorAgentId(undefined)).toBeNull();
    expect(readAuthorAgentId({})).toBeNull();
    expect(readAuthorAgentId({ author_agent_id: "" })).toBeNull();
    expect(readAuthorAgentId({ author_agent_id: 7 })).toBeNull();
    expect(readAuthorAgentId({ author_agent_id: ["a1"] })).toBeNull();
  });
});

describe("agentOwnerLabel", () => {
  it("says whose machine it ran on", () => {
    expect(agentOwnerLabel(agent(), NAMES, ADA)).toBe("Your agent");
    expect(agentOwnerLabel(agent(), NAMES, ME)).toBe("Ada's agent");
  });

  it("falls back for an owner who has left the roster", () => {
    expect(agentOwnerLabel(agent({ ownerUserId: "u-gone" }), NAMES, ME)).toBe(
      "A teammate's agent"
    );
  });
});

describe("agentAttributionFor", () => {
  it("names the handle of a HISTORICAL agent-authored message", () => {
    const attribution = agentAttributionFor(
      { metadata: { author_agent_id: "a1" } },
      [agent()],
      NAMES,
      ME
    );
    expect(attribution).toEqual({ handle: "quartz", ownerLabel: "Ada's agent" });
  });

  it("still resolves an agent that was DISMISSED before the rollback", () => {
    // The roster read keeps dismissed rows precisely for this: the agents most
    // likely to own old messages are the retired ones.
    const attribution = agentAttributionFor(
      { metadata: { author_agent_id: "a-old" } },
      [agent({ id: "a-old", name: "flint" })],
      NAMES,
      ME
    );
    expect(attribution?.handle).toBe("flint");
  });

  it("returns null for an unstamped or unresolvable message", () => {
    expect(agentAttributionFor({ metadata: {} }, [agent()], NAMES, ME)).toBeNull();
    expect(
      agentAttributionFor(
        { metadata: { author_agent_id: "nope" } },
        [agent()],
        NAMES,
        ME
      )
    ).toBeNull();
  });
});
