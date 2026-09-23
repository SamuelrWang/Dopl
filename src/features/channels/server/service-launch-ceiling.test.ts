import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { loadVisibleChannel } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import {
  CHANNEL_ROW,
  CHAN,
  MEMBERSHIP,
  ctx,
  echoInserts,
  inserted,
  row,
  wireLaunchDefaults,
} from "./service-launch-fixtures";

/**
 * **THE SERVER DECIDES NO POSTURE AND RESOLVES NO MODEL.** The channel ceiling is retired, so the
 * request is stored verbatim (`start_*` / `chain`) and the `resolved_*` group is written `null`
 * (F10); `resolved_model` is no longer looked up in Claude's frozen table on every runtime (F7).
 * The operator's machine clamps (`main/launch-posture.js`) and reports `applied_*`.
 */

function withCeiling(over: Record<string, unknown>): void {
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: { ...CHANNEL_ROW, ...over },
    membership: MEMBERSHIP,
  } as never);
}

beforeEach(() => {
  wireLaunchDefaults();
  echoInserts();
});

describe("a request is stored verbatim and never narrowed by the server", () => {
  it("does NOT narrow a request that the old ceiling would have clamped", async () => {
    withCeiling({ agent_tool_ceiling: "accept_edits", agent_message_ceiling: "ask" });
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both" });
    expect(inserted()).toMatchObject({
      start_tool_mode: "bypass",
      start_message_mode: "auto_both",
    });
  });

  // 🔒 F10: `resolved_*` was a byte copy of the request once the clamp was deleted, and MCP's
  // `allowed=` printed it as if the server had permitted something.
  it("writes the whole `resolved_*` group as NULL — the server permitted nothing", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both", chain: true });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: null,
      resolved_message_mode: null,
      resolved_chain: null,
      resolved_model: null,
    });
  });

  // C5 (ruling R3): a Codex launch may ask in Codex words.
  it("stores a Codex tool word verbatim", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, runtime: "codex", tools: "on-request" });
    expect(inserted()).toMatchObject({ runtime: "codex", start_tool_mode: "on-request" });
  });

  it("a chain:true directive is GRANTED even where the channel forbade it", async () => {
    withCeiling({ agent_chain_allowed: false });
    await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).toHaveBeenCalledTimes(1);
    expect(inserted().chain).toBe(true);
  });

  it("`chain: false` still means false — the CALLER may always narrow itself", async () => {
    withCeiling({ agent_chain_allowed: true });
    await createLaunchDirective(ctx, { channel: CHAN, chain: false });
    expect(inserted().chain).toBe(false);
  });
});

// 🔒 F7: `launch_agent runtime=codex model=opus` got `resolved_model = "claude-opus-5"` off
// Claude's frozen alias table, and MCP printed it on a Codex launch the machine then refused.
describe("the model is carried verbatim and never resolved server-side", () => {
  it.each([
    ["claude-opus-5", undefined],
    ["sonnet", undefined],
    ["opus", "codex"],
    ["gpt-6-sol", "codex"],
    ["constructor", undefined],
  ])("model %s (runtime %s) is stored as asked, with resolved_model NULL", async (model, runtime) => {
    await createLaunchDirective(ctx, { channel: CHAN, model, runtime });
    expect(inserted()).toMatchObject({ model, resolved_model: null });
  });
});

describe("the ceiling is decided in the right ORDER", () => {
  it("an OFFLINE operator gets the offline answer — the retired ceiling has no say", async () => {
    // ⚠ **REWRITTEN 2026-09-06 WITH THE CEILING ITSELF.** This read "refuses a forbidden chain
    // even when the operator is OFFLINE" and pinned an ORDER: the refusal had to beat the
    // `offline` 200, because answering a forbidden chain with "your machine is asleep" makes the
    // caller fix the wrong thing and ask again a minute later for the real refusal. There is no
    // refusal to order any more — `agent_chain_allowed` is dropped — so what is left to state is
    // that the retired column changes nothing about the offline path either.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    const out = await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(out).toMatchObject({ offline: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
  });

  it("a converged idempotent retry is NOT re-decided against today's ceiling", async () => {
    // ⚠ A stored row is this request's answer. Re-clamping it would let a ceiling
    // that moved since turn a successful launch's retry into a refusal.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(row({ chain: true }));
    const out = await createLaunchDirective(ctx, {
      channel: CHAN,
      chain: true,
      clientMsgId: "k1",
    });
    expect(out).toMatchObject({ offline: false, existing: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
  });
});
