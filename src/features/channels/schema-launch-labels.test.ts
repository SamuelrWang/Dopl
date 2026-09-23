/**
 * THE DIRECTIVE LANE'S AGENT NAMES USE THE ONE LABEL CHARSET (F14) — `shared/lib/safe-label.ts ›
 * SAFE_LABEL_RE`. Three hand-rolled copies had drifted from it and let U+202F, U+2060–U+2065 and
 * U+206A–U+206F through, into names spliced into MCP lines.
 */

import { describe, expect, it } from "vitest";
import { AgentDirectiveCreateSchema, LaunchCreateSchema } from "./schema-launch";
import { LaunchDecideSchema } from "./schema-launch-decide";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const DRIFTED = [" ", "⁠", "⁤", "⁪", "⁯"];

describe("agent names on the directive lane", () => {
  it.each(DRIFTED)("launch `agentName` refuses U+%s", (ch) => {
    const res = LaunchCreateSchema.safeParse({ channel: CHANNEL, agentName: `Coder${ch}1` });
    expect(res.success).toBe(false);
  });

  it.each(DRIFTED)("rename `name` refuses U+%s, and empty still clears", (ch) => {
    const base = { kind: "rename", channel: CHANNEL, agentId: "k3v7d2mq" } as const;
    expect(AgentDirectiveCreateSchema.safeParse({ ...base, name: `Coder${ch}1` }).success).toBe(false);
    expect(AgentDirectiveCreateSchema.safeParse({ ...base, name: "" }).success).toBe(true);
  });

  it.each(DRIFTED)("decide `appliedAgentName` refuses U+%s", (ch) => {
    const res = LaunchDecideSchema.safeParse({
      directiveId: "11111111-1111-4111-8111-111111111111",
      status: "launched",
      agentId: "k3v7d2mq",
      appliedAgentName: `Coder${ch}1`,
    });
    expect(res.success).toBe(false);
  });

  it("a plain name still passes all three", () => {
    expect(LaunchCreateSchema.safeParse({ channel: CHANNEL, agentName: "Coder 1" }).success).toBe(true);
    expect(
      AgentDirectiveCreateSchema.safeParse({
        kind: "rename",
        channel: CHANNEL,
        agentId: "k3v7d2mq",
        name: "Coder 1",
      }).success
    ).toBe(true);
    expect(
      LaunchDecideSchema.safeParse({
        directiveId: "11111111-1111-4111-8111-111111111111",
        status: "launched",
        agentId: "k3v7d2mq",
        appliedAgentName: "Coder 1",
      }).success
    ).toBe(true);
  });
});
