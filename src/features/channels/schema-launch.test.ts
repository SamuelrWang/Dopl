/**
 * The posture schemas: the launch request and the `set_agent_mode` arm. A `set_agent_mode` asking for
 * nothing is refused here, where it costs the caller nothing. The mode arrays are ordered and the
 * desktop clamps by index (`main/launch-posture.js › narrowTo`), so order is asserted as a list.
 * `chain: false` is a real request, not "did not ask".
 */

import { describe, it, expect } from "vitest";
import { readCode, readSource } from "@/shared/testing/source-text";
import {
  AgentDirectiveCreateSchema,
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
  LaunchCreateSchema,
} from "./schema-launch";
import { LAUNCH_TOOL_MODES_BY_RUNTIME } from "./schema-launch-modes";

const AGENT = "a1b2c3d4";
const BASE = { channel: "general", agentId: AGENT } as const;

/** Repo-root-relative path, resolved from this file rather than the working directory. */
const repoFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url);

// Each runtime asks in its own words, narrowest first, pinned against its adapter's `tools.js`.
function desktopToolModes(runtime: string): string[] {
  const src = readCode(repoFile(`dopl-desktop-app/main/runtime/${runtime}/tools.js`));
  const m = /const TOOL_MODES = \[([^\]]*)\]/.exec(src);
  expect(m, `${runtime}/tools.js declares TOOL_MODES`).not.toBeNull();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the mode vocabularies", () => {
  it.each(Object.keys(LAUNCH_TOOL_MODES_BY_RUNTIME))(
    "tools (%s) are that runtime's own words, in its narrowest-first order",
    (runtime) => {
      const mine = LAUNCH_TOOL_MODES_BY_RUNTIME[runtime as keyof typeof LAUNCH_TOOL_MODES_BY_RUNTIME];
      expect([...mine]).toEqual(desktopToolModes(runtime));
    },
  );

  it("the wire accepts the UNION of every runtime's words, and no word is shared", () => {
    const union = Object.values(LAUNCH_TOOL_MODES_BY_RUNTIME).flat();
    expect([...LAUNCH_TOOL_MODES].sort()).toEqual([...union].sort());
    expect(new Set(LAUNCH_TOOL_MODES).size).toBe(LAUNCH_TOOL_MODES.length);
  });

  it("messages: ask -> auto_inbound -> auto_outbound -> auto_both, in that order", () => {
    expect([...LAUNCH_MESSAGE_MODES]).toEqual([
      "ask",
      "auto_inbound",
      "auto_outbound",
      "auto_both",
    ]);
  });

  // A CHECK narrower than the wire would refuse a legal decide at rest.
  it("the latest tool-mode CHECKs admit exactly the wire union", () => {
    const sql = readSource(
      repoFile("supabase/migrations/20261020120000_channel_launch_directives_runtime_tool_words.sql"),
    );
    for (const col of ["start_tool_mode", "target_tool_mode", "applied_tool_mode", "resolved_tool_mode"]) {
      const m = new RegExp(`${col} IN \\(([^)]*)\\)`).exec(sql);
      expect(m, col).not.toBeNull();
      const words = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      expect(words.sort(), col).toEqual([...LAUNCH_TOOL_MODES].sort());
    }
  });

  it("a launch and a re-posture accept a Codex word, and refuse a word no runtime has", () => {
    const launch = { agentName: "Scout", channel: "general" };
    expect(LaunchCreateSchema.parse({ ...launch, tools: "on-request" }).tools).toBe("on-request");
    expect(LaunchCreateSchema.safeParse({ ...launch, tools: "yolo" }).success).toBe(false);
    expect(AgentDirectiveCreateSchema.parse({ ...BASE, kind: "set_agent_mode", tools: "never" }))
      .toMatchObject({ tools: "never" });
  });
});

describe("LaunchCreateSchema — the posture a launch may ASK for", () => {
  it("takes both axes and the chain", () => {
    const parsed = LaunchCreateSchema.parse({
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

  it("omitting all three is legal", () => {
    const parsed = LaunchCreateSchema.parse({
      agentName: "Scout", channel: "general" });
    expect(parsed.tools).toBeUndefined();
    expect(parsed.messages).toBeUndefined();
    expect(parsed.chain).toBeUndefined();
  });

  it("`chain: false` PARSES as false — the row records what was sent", () => {
    // `main/launch-posture.js › resolveChain` grants `false` even over a channel set to on.
    expect(LaunchCreateSchema.parse({ channel: "general", agentName: "Scout", chain: false }).chain)
      .toBe(false);
  });

  /** An agent that launches an agent must name it; optional would leave it nameless by omission.
   *  The id-shaped refusal is `packages/mcp-server/src/tools/channel-ops-launch-name.ts`'s. */
  it("REFUSES a launch with no name, and a whitespace-only one", () => {
    expect(LaunchCreateSchema.safeParse({ channel: "general" }).success).toBe(false);
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "" }).success,
    ).toBe(false);
    // Trimmed first; `""` clears only on the rename arm.
    expect(
      LaunchCreateSchema.safeParse({ channel: "general", agentName: "   " }).success,
    ).toBe(false);
  });

  it("refuses the invisibles rather than stripping them, as `agent-names.js` does", () => {
    // Refused, not stripped: the desktop's `sanitizeName` refuses them too, so a stripped name would only bounce.
    for (const bad of ["Bug\u200bReviewer", "Bug\u202eReviewer", "Bug\nReviewer"]) {
      expect(
        LaunchCreateSchema.safeParse({ channel: "general", agentName: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("refuses a name past 60 — `main/agent-names.js › MAX_NAME`, not the identity's 120", () => {
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

  it("REFUSES an ask with NEITHER axis — the union arm that could express nothing", () => {
    const res = AgentDirectiveCreateSchema.safeParse({
      kind: "set_agent_mode",
      ...BASE,
    });
    expect(res.success).toBe(false);
    // The message must name what to pass.
    const message = res.success ? "" : res.error.issues.map((i) => i.message).join(" ");
    expect(message).toContain("at least one axis");
    expect(message).toContain("tools");
    expect(message).toContain("messages");
  });

  it("the refusal is the ARM's, not the union's — end and rename are untouched by it", () => {
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

  it("HAS NO `model` FIELD — the desktop's narrower has no column to read one into", () => {
    const parsed = AgentDirectiveCreateSchema.parse({
      kind: "set_agent_mode",
      ...BASE,
      tools: "auto",
      model: "opus",
    });
    expect(parsed).not.toHaveProperty("model");
  });

  it("HAS NO OPERATOR FIELD, on any arm — the whole cross-member story", () => {
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
