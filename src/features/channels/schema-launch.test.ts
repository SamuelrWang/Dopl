/**
 * THE POSTURE SCHEMAS — T24's launch request and the `set_agent_mode` arm
 * (2026-09-01).
 *
 * ⚠ **THE PROPERTIES HERE ARE NOT "ZOD WORKS". THEY ARE THE THREE THINGS THAT GO
 * WRONG SILENTLY:**
 *
 *  1. **A `set_agent_mode` THAT ASKS FOR NOTHING MUST BE REFUSED AT THE SCHEMA.**
 *     It parses cleanly as an object with two optional fields, files a row, is
 *     claimed, and can only ever come back refused for a request that was never
 *     expressible. Three statements refuse it (here, the column CHECK, and
 *     `main/directive-agent-ops.js › setAgentMode`); this is the only one that
 *     costs the caller nothing.
 *  2. **THE MODE ARRAYS ARE ORDERED, AND `closedEnum` DOES NOT CHECK ORDER.** The
 *     clamp on the other side of the wire is an INDEX COMPARISON over a copy of
 *     these sequences (`main/launch-posture.js › narrowTo`), so a re-order
 *     inverts the bound with every type and every set-membership test still
 *     green. The order is asserted as a LIST, deliberately, not as a set.
 *  3. **`chain: false` MUST SURVIVE.** It is a real request ("run it with
 *     chaining off") and is not a spelling of "did not ask", which inherits the
 *     channel's setting and can be the opposite.
 */

import { describe, it, expect } from "vitest";
import {
  AgentDirectiveCreateSchema,
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
  LaunchCreateSchema,
} from "./schema-launch";

const AGENT = "a1b2c3d4";
const BASE = { channel: "general", agentId: AGENT } as const;

describe("the mode vocabularies are ORDERED narrowest first", () => {
  // ⚠ `toEqual` ON THE ARRAY, NOT `toContain` PER MEMBER. A set assertion is
  // exactly the one that cannot fail when the sequence is reversed, which is the
  // change that silently inverts the desktop's clamp.
  it("tools: manual -> accept_edits -> auto -> bypass, in that order", () => {
    expect([...LAUNCH_TOOL_MODES]).toEqual([
      "manual",
      "accept_edits",
      "auto",
      "bypass",
    ]);
  });

  it("messages: ask -> auto_inbound -> auto_outbound -> auto_both, in that order", () => {
    expect([...LAUNCH_MESSAGE_MODES]).toEqual([
      "ask",
      "auto_inbound",
      "auto_outbound",
      "auto_both",
    ]);
  });

  it("the widest tool mode is LAST — the property the index comparison depends on", () => {
    expect(LAUNCH_TOOL_MODES[LAUNCH_TOOL_MODES.length - 1]).toBe("bypass");
    expect(LAUNCH_MESSAGE_MODES[LAUNCH_MESSAGE_MODES.length - 1]).toBe(
      "auto_both",
    );
  });
});

describe("LaunchCreateSchema — the posture a launch may ASK for", () => {
  it("takes both axes and the chain", () => {
    const parsed = LaunchCreateSchema.parse({
      channel: "general",
      tools: "auto",
      messages: "auto_both",
      chain: true,
    });
    expect(parsed.tools).toBe("auto");
    expect(parsed.messages).toBe("auto_both");
    expect(parsed.chain).toBe(true);
  });

  it("omitting all three is legal — the pre-T24 shape still parses", () => {
    const parsed = LaunchCreateSchema.parse({ channel: "general" });
    expect(parsed.tools).toBeUndefined();
    expect(parsed.messages).toBeUndefined();
    expect(parsed.chain).toBeUndefined();
  });

  it("⚠ `chain: false` PARSES as false — the row records what was sent", () => {
    // ⚠ THIS IS A RECORD-KEEPING PROPERTY, NOT A BEHAVIOURAL ONE, and the
    // distinction is the finding: `main/launch-directive-wire.js › directiveFrom`
    // reads only `true`/`"true"`, so a stored `false` resolves on the desktop
    // exactly as an omission does. The schema keeps the value; no copy promises
    // it does anything.
    expect(LaunchCreateSchema.parse({ channel: "general", chain: false }).chain)
      .toBe(false);
  });

  it("refuses a mode outside the enum, rather than passing it to the column CHECK", () => {
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", tools: "yolo" })
        .success,
    ).toBe(false);
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", messages: "auto" })
        .success,
    ).toBe(false);
  });
});

describe("AgentDirectiveCreateSchema — the set_agent_mode arm", () => {
  it("takes one axis alone — moving one and leaving the other is the ordinary case", () => {
    const tools = AgentDirectiveCreateSchema.parse({
      kind: "set_agent_mode",
      ...BASE,
      tools: "accept_edits",
    });
    expect(tools).toMatchObject({ kind: "set_agent_mode", tools: "accept_edits" });

    const messages = AgentDirectiveCreateSchema.parse({
      kind: "set_agent_mode",
      ...BASE,
      messages: "auto_inbound",
    });
    expect(messages).toMatchObject({ messages: "auto_inbound" });
  });

  it("takes both axes", () => {
    expect(
      AgentDirectiveCreateSchema.safeParse({
        kind: "set_agent_mode",
        ...BASE,
        tools: "bypass",
        messages: "auto_both",
      }).success,
    ).toBe(true);
  });

  it("🔒 REFUSES an ask with NEITHER axis — the union arm that could express nothing", () => {
    const res = AgentDirectiveCreateSchema.safeParse({
      kind: "set_agent_mode",
      ...BASE,
    });
    expect(res.success).toBe(false);
    // ⚠ THE MESSAGE HAS TO NAME WHAT TO PASS. A bare "invalid input" sends the
    // caller to guess at a required field the shape does not have.
    const message = res.success ? "" : res.error.issues.map((i) => i.message).join(" ");
    expect(message).toContain("at least one axis");
    expect(message).toContain("tools");
    expect(message).toContain("messages");
  });

  it("the refusal is the ARM's, not the union's — end and rename are untouched by it", () => {
    // ⚠ A predicate hung on the whole union would run over every kind and the
    // message a rename caller saw would be about axes it has no field for.
    expect(
      AgentDirectiveCreateSchema.safeParse({ kind: "end", ...BASE }).success,
    ).toBe(true);
    expect(
      AgentDirectiveCreateSchema.safeParse({ kind: "rename", ...BASE, name: "R" })
        .success,
    ).toBe(true);
  });

  it("refuses a mode outside the enum on either axis", () => {
    expect(
      AgentDirectiveCreateSchema.safeParse({
        kind: "set_agent_mode",
        ...BASE,
        tools: "auto_both",
      }).success,
    ).toBe(false);
  });

  it("⚠ HAS NO `model` FIELD — the desktop's narrower has no column to read one into", () => {
    // A model accepted here would be stored and silently dropped on the way in,
    // i.e. the caller told its request landed while nothing carried it.
    const parsed = AgentDirectiveCreateSchema.parse({
      kind: "set_agent_mode",
      ...BASE,
      tools: "auto",
      model: "opus",
    });
    expect(parsed).not.toHaveProperty("model");
  });

  it("⚠ HAS NO OPERATOR FIELD, on any arm — the whole cross-member story", () => {
    const parsed = AgentDirectiveCreateSchema.parse({
      kind: "set_agent_mode",
      ...BASE,
      messages: "ask",
      operatorUserId: "someone-else",
    });
    expect(parsed).not.toHaveProperty("operatorUserId");
  });

  it("requires the bare 8-character instance id, as the other arms do", () => {
    expect(
      AgentDirectiveCreateSchema.safeParse({
        kind: "set_agent_mode",
        channel: "general",
        agentId: "@agent-a1b2c3d4",
        tools: "auto",
      }).success,
    ).toBe(false);
  });
});
