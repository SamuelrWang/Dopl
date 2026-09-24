// `manage action="launch"`: what the CREATE BODY carries (the result it teaches is `channel-ops-launch.test.ts`).

import { describe, it, expect, vi } from "vitest";
import { opLaunchAgent } from "./channel-ops-launch";
import { channelDoctrine, TENANCY_RULE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  created,
  launchClient as client,
  launchText as text,
  launched,
  polls,
} from "./launch-fixtures";

describe("the call itself", () => {
  it("passes channel id, thread, goal, model and identity through", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      thread: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      identity: "Code Auditor",
    });
    // The identity ref goes out untouched: id vs name and ambiguity are decided server-side.
    expect(createLaunchDirective).toHaveBeenCalledWith({
      channel: "chan-1",
      threadId: "44444444-4444-4444-4444-444444444444",
      goal: "ship the parser",
      model: "claude-opus-5",
      identity: "Code Auditor",
      // Trimmed, because the length refusal measured the trimmed value.
      agentName: "Scout",
    });
  });

  it("names NO operator — there is no argument that could", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    const body = createLaunchDirective.mock.calls[0][0] as Record<string, unknown>;
    // The whole key list, so no unreviewed field joins the body; none may ever name an operator.
    expect(Object.keys(body)).toEqual([
      "channel",
      "threadId",
      "goal",
      "model",
      // Separate from `model` and never derived from it.
      "runtime",
      "identity",
      // The posture ask: clamped by the caller's own machine to its owner's ceiling.
      "tools",
      "messages",
      "chain",
      // Scoped by the operator id the server stamps, so it cannot widen who a launch reaches.
      "clientMsgId",
      "color",
      // Required (a nameless launch is refused before the create), so always present.
      "agentName",
    ]);
  });

  it("`no-identity` from the MACHINE says WHOSE visibility failed, and does not guess why", async () => {
    // The machine's answer after the row was filed: a fact line, unlike the create-time `isError`
    // refusals in `channel-ops-launch-identity.test.ts`; a caller branches on `reason=`.
    const out = await text(created({ status: "refused", refusalReason: "no-identity" }), {
      waitMs: 0,
    });
    expect(out).toContain("reason=no-identity");
    expect(out).toContain("filed=yes");
    expect(out).not.toContain("nothing was filed");
    // Names whose fence failed, never which of deleted / invisible (the resolve is 404-never-403).
    expect(channelDoctrine()).toContain(
      "`no-identity` THAT machine could not resolve it under the operator's visibility",
    );
    // The tenancy rule is standing and reveals no row, so it may be stated here.
    expect(CHANNEL_INPUT_SHAPE.identity.description).toContain(
      "THIS CHANNEL'S container",
    );
    expect(TENANCY_RULE).toContain("a home channel IS its own container");
    // Both halves: a NAME resolves only in the channel's container, an id wherever the row lives.
    expect(TENANCY_RULE).toContain(
      "A NAME resolves only in the container the channel lives in",
    );
    expect(TENANCY_RULE).toContain("an id resolves wherever the row lives");
    // A desktop refusal carries no detail field, so it cannot name a place.
    expect(out).not.toContain("not in this channel's own container");
  });

  it("an unknown channel comes back as a clean not-found", async () => {
    const res = await opLaunchAgent(client({ listChannels: vi.fn(async () => []) }), "nope", {
      name: "Scout",
    });
    expect(res.content[0].text).toContain("nope");
  });

  it("the wait is CAPPED at 30s however much is asked for", async () => {
    // The fake clock advances in the hold's own 1.5s tick and stops at settle, so `Date.now()`
    // measures the real hold.
    vi.useFakeTimers();
    try {
      const started = Date.now();
      let elapsed = Number.NaN;
      const held = text(polls({ status: "pending" }), { waitMs: 600_000 }).then(() => {
        elapsed = Date.now() - started;
      });
      for (let i = 0; i < 500 && Number.isNaN(elapsed); i += 1) {
        await vi.advanceTimersByTimeAsync(1_500);
      }
      await held;
      expect(elapsed).toBeLessThan(31_000);
      // The lower bound guards against a vacuous pass (the fake clock never reaching the op).
      expect(elapsed).toBeGreaterThanOrEqual(1_500);
    } finally {
      vi.useRealTimers();
    }
  }, 40_000);
});

// The load-bearing assertion is `not.toHaveBeenCalled()`: a pre-flight refusal means nothing crossed the wire.
describe("the launch goal has its own cap, and it is refused before the wire", () => {
  it("refuses a 2,001-character body BY NAME, and files nothing", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    const res = await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal: "x".repeat(2_001),
    });
    expect(createLaunchDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    // Named `body`, the argument the caller passed, never the wire's `goal`.
    expect(out).toContain("field=body");
    expect(out).toContain("limit=2000");
    expect(out).toContain("reason=goal_too_long");
    expect(out).toContain("retry=no");
    expect(out).toContain("Nothing was filed");
    expect(out).toContain("knowledge entry");
  });

  it("a 2,000-character body still goes through, untouched", async () => {
    const goal = "x".repeat(2_000);
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal,
    });
    // Inclusive, like the route's `.max(2000)`.
    expect(createLaunchDirective).toHaveBeenCalledWith(
      expect.objectContaining({ goal }),
    );
  });

  it("measures the TRIMMED length, because the route trims before it measures", async () => {
    const goal = `${" ".repeat(20)}${"x".repeat(2_000)}${" ".repeat(20)}`;
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "Scout",
      goal,
    });
    // The trim is only a measurement; the caller's own string is what is filed.
    expect(createLaunchDirective).toHaveBeenCalledWith(
      expect.objectContaining({ goal }),
    );
  });

  it("an ABSENT goal is not a refusal — a stand-by agent is a supported launch", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    await opLaunchAgent(client({ createLaunchDirective }), "general", { name: "Scout" });
    expect(createLaunchDirective).toHaveBeenCalled();
  });

  it("refuses a 61-character name the same way, and that cap was unpublished too", async () => {
    const createLaunchDirective = vi.fn(async () => ({ offline: false, directive: launched() }));
    const res = await opLaunchAgent(client({ createLaunchDirective }), "general", {
      name: "N".repeat(61),
    });
    expect(createLaunchDirective).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    const out = res.content[0].text as string;
    expect(out).toContain("field=name");
    expect(out).toContain("limit=60");
    expect(out).toContain("reason=name_too_long");
    expect(out).toContain("Nothing was filed");
  });

  it("publishes the launch cap on `body`, so the published bound matches the enforced one", () => {
    // `.max(16000)` is `op="send"`'s and stays; the launch cap is stated beside it.
    const described = CHANNEL_INPUT_SHAPE.body.description ?? "";
    expect(described).toContain("2000");
    expect(JSON.stringify(CHANNEL_INPUT_SHAPE.body.def)).toContain("16000");
  });
});
