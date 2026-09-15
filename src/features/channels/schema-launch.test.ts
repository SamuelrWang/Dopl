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
      // ⚠ REQUIRED SINCE 2026-09-15 — an agent that launches an agent NAMES it.
      agentName: "Scout",
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
    const parsed = LaunchCreateSchema.parse({
      // ⚠ REQUIRED SINCE 2026-09-15 — an agent that launches an agent NAMES it.
      agentName: "Scout", channel: "general" });
    expect(parsed.tools).toBeUndefined();
    expect(parsed.messages).toBeUndefined();
    expect(parsed.chain).toBeUndefined();
  });

  it("⚠ `chain: false` PARSES as false — the row records what was sent", () => {
    // ⚠ AND IT IS A BEHAVIOURAL PROPERTY SINCE 2026-09-01, NOT MERELY A
    // RECORD-KEEPING ONE. `main/launch-directive-wire.js › directiveFrom` used to
    // read only `true`/`"true"`, so a stored `false` resolved on the desktop
    // exactly as an omission did; it now carries all three states and
    // `main/launch-posture.js › resolveChain` grants `false` unconditionally —
    // it wins even over a channel set to ON. A schema that dropped the value
    // would now delete a real request, not just a record.
    expect(LaunchCreateSchema.parse({ channel: "general", agentName: "Scout", chain: false }).chain)
      .toBe(false);
  });

  /**
   * 🔒 **AN AGENT THAT LAUNCHES AN AGENT MUST NAME IT** (Samuel, 2026-09-15, verbatim: *"if
   * agents are spinning up agents, they should be the ones that are naming the agent. Shouldn't
   * be a nameless agent."*).
   *
   * ⚠ **THE ARGUMENT DID NOT EXIST BEFORE THIS WAVE, WHICH IS THE WHOLE DEFECT** — a launch
   * filed over MCP could carry a goal, a model, a template, a colour and a posture, and no name,
   * so every agent an agent launched was nameless BY CONSTRUCTION and rendered on every human
   * surface as its own instance id. Adding the field as OPTIONAL would have left the defect
   * reachable by omission, and the caller is a model that omits whatever it can.
   * ⚠ **THE ID-SHAPED REFUSAL IS THE TOOL'S, NOT THIS SCHEMA'S** — see
   * `packages/mcp-server/src/tools/channel-ops-launch-name.ts`. A zod message cannot say what to
   * pass instead, and a refusal an orchestrator cannot act on is a retry loop.
   */
  it("🔒 REFUSES a launch with no name, and a whitespace-only one", () => {
    expect(LaunchCreateSchema.safeParse({ channel: "general" }).success).toBe(false);
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "" }).success,
    ).toBe(false);
    // ⚠ TRIMMED FIRST, so `"   "` is refused rather than stored as a name nobody typed. The
    // empty string is meaningful on the RENAME arm (it clears) and meaningless here.
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "   " }).success,
    ).toBe(false);
  });

  it("refuses the invisibles rather than stripping them, as `agent-names.js` does", () => {
    // ⚠ STRIPPING WOULD STORE SOMETHING OTHER THAN WHAT WAS SENT AND SAY NOTHING ABOUT IT. A bidi
    // override in an agent name renders a card that reads backwards; a zero-width joiner makes
    // two names look identical. The desktop's `sanitizeName` is the authority at the far end and
    // refuses, so accepting them here would file a directive the machine will only bounce.
    for (const bad of ["Bug\u200bReviewer", "Bug\u202eReviewer", "Bug\nReviewer"]) {
      expect(
        LaunchCreateSchema.safeParse({ channel: "general", agentName: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("refuses a name past 60 — `main/agent-names.js › MAX_NAME`, not the template's 120", () => {
    // ⚠ A name legal here that the desktop then refuses is a 200 followed by a refusal the
    // orchestrator cannot explain.
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "x".repeat(61) }).success,
    ).toBe(false);
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "x".repeat(60) }).success,
    ).toBe(true);
  });

  it("refuses a mode outside the enum, rather than passing it to the column CHECK", () => {
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "Scout", tools: "yolo" })
        .success,
    ).toBe(false);
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "Scout", messages: "auto" })
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
