/**
 * **F-438 — THE POSTURE ASK, THROUGH THE DISPATCHER** (fixed 2026-09-02, slice
 * A6b), and **C11's `chain` TRI-STATE** on the same call site.
 *
 * ⚠ **THE BUG THIS FILE EXISTS FOR SHIPPED IN EVERY LAYER BUT ONE.**
 * `channel-schema.ts` published `posture.tools`, `posture.messages` and
 * `posture.chain`;
 * `channel-ops-launch.ts › opLaunchAgent` accepted them; `schema-launch.ts`
 * validated them; `service-launch.ts` stored them; and
 * `20260910120000_channel_launch_directives_posture.sql` gave them columns and
 * CHECKs. `channel-dispatch-agents.ts`'s `case "launch"` read NONE of
 * them, so a caller asking for a narrower agent got the operator's stored
 * ceiling and was told nothing.
 *
 * ⚠ **AND IT SURVIVED BECAUSE THE DIRECTION OF THE BUG IS SAFE.** A dropped ask
 * can only WIDEN back to the ceiling, never past it, so nothing was
 * over-granted; the row simply recorded "did not ask", which is also what an
 * honest omission looks like. What was lost is the ability to ask for LESS —
 * `posture.tools: "manual"`, `posture.chain: "off"` — which T24 shipped so an orchestrator could
 * hand a worker a narrower posture than its own.
 *
 * ⚠ **SO EVERY CASE HERE IS DRIVEN THROUGH `registerChannelTool`, NOT THROUGH
 * `opLaunchAgent`.** That is the whole lesson of the finding:
 * `channel-ops-launch-body.test.ts` already enumerates every key of the create
 * body and would have caught this — except it calls the handler DIRECTLY and
 * therefore never sees the dispatcher. A guard that skips the seam cannot see a
 * seam defect.
 *
 * ⚠ `channel-` filename prefix, like every other file the parity split-scan and
 * the removed-vocabulary source scan walk.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { registerChannelTool } from "./channel";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { callTool, stub } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "general",
  name: "General",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    channelId: "ch-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    templateId: null,
    templateName: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-09-02T12:02:00.000Z",
    createdAt: "2026-09-02T12:00:00.000Z",
    ...over,
  } as LaunchDirective;
}

/** The create spy every case reads — the ONE thing the dispatcher decides. */
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

const LAUNCH = {
  op: "manage",
  action: "launch",
  channel: "general",
  body: "ship it",
  wait_ms: 0,
};

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
    // ⚠ The honest omission must stay distinguishable from a dropped ask, which
    // is the whole reason the bug was invisible: both produced the ceiling.
    const { client, createLaunchDirective } = launchStub();
    await run(client, LAUNCH);
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
    expect(body.messages).toBeUndefined();
  });

  it('action="posture" — the sibling arm that always did — is unchanged', async () => {
    // ⚠ THE CONTROL. This op read both axes all along, which is what proved the
    // launch arm was an OMISSION rather than a design.
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

describe("C11 — `chain` is three words at the seam and a boolean on the wire", () => {
  it("publishes the three states rather than an optional boolean", () => {
    // ⚠ Asserted through the PARSER, not off a zod internal: what matters is
    // which values a caller can send, and that a BOOLEAN is no longer one of
    // them — `true`/`false` were the whole of the old surface.
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

  /**
   * ⚠ **`inherit` IS `undefined`, NOT `false`, AND THIS IS THE CASE THAT SAYS
   * SO.** Flattening the two was a live wire bug (GAP C, `directiveFrom`), and
   * it was possible because the published param was an optional boolean whose
   * `.describe()` had to spend a paragraph insisting that omitting it was not
   * `false`. `false` FORBIDS chaining; absent takes the operator's channel
   * setting, which may be ON. Three words in, three states out.
   */
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
