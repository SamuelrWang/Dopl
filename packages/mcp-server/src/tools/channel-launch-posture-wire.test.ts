// The posture ask and the `chain` tri-state, driven through `registerChannelTool` because the
// dispatcher is the seam a direct-handler suite cannot see (F-438).

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { registerChannelTool } from "./channel";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { CHANNEL_ROW as CHANNEL, LAUNCH, directive } from "./launch-fixtures";
import { callTool, stub } from "./narration-fixtures";

/** The create spy every case reads: the one thing the dispatcher decides. */
function launchStub() {
  const createLaunchDirective = vi.fn(async () => ({
    offline: false,
    directive: directive(),
  }));
  return {
    createLaunchDirective,
    client: stub({
      listChannels: vi.fn(async () => [CHANNEL]),
      getChannel: vi.fn(async () => CHANNEL),
      createLaunchDirective,
      getLaunchDirective: vi.fn(async () => directive()),
    }) as DoplClient,
  };
}

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

describe("F-438 — the two posture axes reach the wire", () => {
  it("`tools` and `messages` are on the create body, narrowest values included", async () => {
    const { client, createLaunchDirective } = launchStub();
    await run(client, { ...LAUNCH, posture: { tools: "manual", messages: "ask" } });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({
      tools: "manual",
      messages: "ask",
    });
  });

  it("a caller that asks for NEITHER still sends neither — absent is not a value", async () => {
    // An honest omission must stay distinguishable from a dropped ask; both produce the ceiling.
    const { client, createLaunchDirective } = launchStub();
    await run(client, LAUNCH);
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
    expect(body.messages).toBeUndefined();
  });

  it('action="posture" — the sibling arm that always did — is unchanged', async () => {
    // The control: this arm always read both axes.
    const createAgentDirective = vi.fn(async () => ({
      offline: false,
      directive: { ...directive(), kind: "set_agent_mode" },
    }));
    const client = stub({
      listChannels: vi.fn(async () => [CHANNEL]),
      getChannel: vi.fn(async () => CHANNEL),
      createAgentDirective,
      getLaunchDirective: vi.fn(async () => directive()),
    }) as DoplClient;
    await run(client, {
      op: "manage",
      action: "posture",
      channel: "general",
      to: "k3wpf7c5",
      posture: { tools: "manual", messages: "ask" },
      wait_ms: 0,
    });
    expect(createAgentDirective.mock.calls[0][0]).toMatchObject({
      tools: "manual",
      messages: "ask",
    });
  });
});

describe("`chain` is three words at the seam and a boolean on the wire", () => {
  it("publishes the three states rather than an optional boolean", () => {
    // Through the parser: a boolean is no longer a value a caller can send.
    for (const word of ["inherit", "on", "off"]) {
      expect(
        CHANNEL_INPUT_SHAPE.posture.safeParse({ chain: word }).success,
        word,
      ).toBe(true);
    }
    for (const legacy of [true, false, "allow", "deny"]) {
      expect(
        CHANNEL_INPUT_SHAPE.posture.safeParse({ chain: legacy }).success,
        String(legacy),
      ).toBe(false);
    }
  });

  it.each([
    ["on", true],
    ["off", false],
  ])('chain="%s" sends %s', async (word, wire) => {
    const { client, createLaunchDirective } = launchStub();
    await run(client, { ...LAUNCH, posture: { chain: word } });
    expect(createLaunchDirective.mock.calls[0][0]).toMatchObject({ chain: wire });
  });

  // `false` forbids chaining; absent takes the operator's channel setting, which may be ON.
  it.each(["inherit", undefined])("chain=%s sends NOTHING, not false", async (word) => {
    const { client, createLaunchDirective } = launchStub();
    await run(client, {
      ...LAUNCH,
      ...(word === undefined ? {} : { posture: { chain: word } }),
    });
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(body.chain).toBeUndefined();
    expect(body.chain).not.toBe(false);
  });
});
