import { describe, expect, it } from "vitest";
import { AGENT_HANDLE_RE } from "../schema";
import {
  agentAttributionFor,
  agentOwnerLabel,
  agentStatusDotClass,
  isAddressableAgent,
  isAgentOwner,
  isValidAgentHandle,
  normalizeAgentHandle,
  readAuthorAgentId,
  visibleAgents,
} from "./agent-display";
import type { AgentStatus, ChannelAgent } from "../types";

const ME = "u-me";
const ADA = "u-ada";
const NAMES = new Map([
  [ME, "Me"],
  [ADA, "Ada"],
]);

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: ADA,
    name: "quartz",
    status: "active",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

describe("agent handle charset", () => {
  it("accepts the pool's shape: lowercase, starts with a letter", () => {
    for (const name of ["quartz", "vega", "a1", "deep-thought", "x-9-b"]) {
      expect(isValidAgentHandle(name)).toBe(true);
    }
  });

  it("normalizes the way the server does before judging (trim + case-fold)", () => {
    expect(normalizeAgentHandle("  Quartz  ")).toBe("quartz");
    // Accepted here because `AgentHandleSchema` case-folds before its charset
    // test — refusing it locally would contradict the server.
    expect(isValidAgentHandle("Quartz")).toBe(true);
    expect(isValidAgentHandle("  vega ")).toBe(true);
  });

  it("refuses everything the DB CHECK refuses", () => {
    for (const name of [
      "9lives", // leading digit
      "-lead", // leading dash
      "a", // one char (min is 2)
      "has space",
      "under_score",
      "a".repeat(32), // 32 chars (max is 31)
      "",
    ]) {
      expect(isValidAgentHandle(name)).toBe(false);
    }
  });

  it("uses the ONE charset from schema.ts — never a local copy", () => {
    // Pins the contract regex itself: if the schema's charset moves, this and
    // the DB CHECK move together, and the UI cannot drift looser than either.
    expect(AGENT_HANDLE_RE.source).toBe("^[a-z][a-z0-9-]{1,30}$");
  });
});

describe("agent status presentation", () => {
  it("pulses a summoned agent, inks an active one, hollows the rest", () => {
    expect(agentStatusDotClass("summoned")).toContain("animate-pulse");
    expect(agentStatusDotClass("active")).toBe("bg-success");
    expect(agentStatusDotClass("parked")).toContain("bg-transparent");
    expect(agentStatusDotClass("dismissed")).toContain("bg-transparent");
  });

  it("uses design tokens only — no hex, no raw px", () => {
    const statuses: AgentStatus[] = ["summoned", "active", "parked", "dismissed"];
    for (const status of statuses) {
      expect(agentStatusDotClass(status)).not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(agentStatusDotClass(status)).not.toMatch(/\[\d+px\]/);
    }
  });

  it("hides a dismissed agent's chip but keeps its row for attribution", () => {
    const rows = [agent({ id: "a1" }), agent({ id: "a2", status: "dismissed" })];
    expect(visibleAgents(rows).map((a) => a.id)).toEqual(["a1"]);
  });

  it("treats summoned + active as the addressable states", () => {
    expect(isAddressableAgent(agent({ status: "summoned" }))).toBe(true);
    expect(isAddressableAgent(agent({ status: "active" }))).toBe(true);
    expect(isAddressableAgent(agent({ status: "parked" }))).toBe(false);
    expect(isAddressableAgent(agent({ status: "dismissed" }))).toBe(false);
  });
});

describe("ownership (who may rename / park / dismiss)", () => {
  it("is the summoner, and nobody else", () => {
    expect(isAgentOwner(agent({ ownerUserId: ME }), ME)).toBe(true);
    expect(isAgentOwner(agent({ ownerUserId: ADA }), ME)).toBe(false);
  });

  it("claims nothing when the viewer is unknown", () => {
    expect(isAgentOwner(agent({ ownerUserId: ME }), undefined)).toBe(false);
  });

  it("says whose agent it is, in the viewer's terms", () => {
    expect(agentOwnerLabel(agent({ ownerUserId: ME }), NAMES, ME)).toBe(
      "Your agent"
    );
    expect(agentOwnerLabel(agent({ ownerUserId: ADA }), NAMES, ME)).toBe(
      "Ada's agent"
    );
    // An owner who is not on the loaded roster stays unnamed rather than wrong.
    expect(agentOwnerLabel(agent({ ownerUserId: "u-gone" }), NAMES, ME)).toBe(
      "A teammate's agent"
    );
  });
});

describe("message attribution (metadata.author_agent_id)", () => {
  const agents = [agent({ id: "a1", name: "quartz", ownerUserId: ADA })];

  it("resolves a stamped message to its agent's handle + owner", () => {
    expect(
      agentAttributionFor(
        { metadata: { author_agent_id: "a1" } },
        agents,
        NAMES,
        ME
      )
    ).toEqual({ handle: "quartz", ownerLabel: "Ada's agent" });
  });

  it("falls back when the message carries no agent id", () => {
    expect(agentAttributionFor({ metadata: {} }, agents, NAMES, ME)).toBeNull();
  });

  it("falls back when the id names an agent this client has not loaded", () => {
    expect(
      agentAttributionFor(
        { metadata: { author_agent_id: "a-unknown" } },
        agents,
        NAMES,
        ME
      )
    ).toBeNull();
  });

  it("reads the key defensively — a non-string is simply not an agent", () => {
    for (const raw of [42, null, {}, [], true, ""]) {
      expect(readAuthorAgentId({ author_agent_id: raw })).toBeNull();
    }
    expect(readAuthorAgentId(undefined)).toBeNull();
    expect(readAuthorAgentId({ author_agent_id: "a1" })).toBe("a1");
  });

  it("falls back when the agent list is empty (not yet loaded)", () => {
    expect(
      agentAttributionFor({ metadata: { author_agent_id: "a1" } }, [], NAMES, ME)
    ).toBeNull();
  });
});
