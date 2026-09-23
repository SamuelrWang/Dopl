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

/** The server decides no posture and resolves no model: the request is stored verbatim, `resolved_*` is
 *  written null, and the operator's machine clamps (`main/launch-posture.js`) and reports `applied_*`. */

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

  // MCP's `allowed=` renders `resolved_*`; a copy of the request would claim the server permitted it.
  it("writes the whole `resolved_*` group as NULL — the server permitted nothing", async () => {
    await createLaunchDirective(ctx, { channel: CHAN, tools: "bypass", messages: "auto_both", chain: true });
    expect(inserted()).toMatchObject({
      resolved_tool_mode: null,
      resolved_message_mode: null,
      resolved_chain: null,
      resolved_model: null,
    });
  });

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

// Claude's alias table must not resolve a model on another runtime's launch.
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
    // `agent_chain_allowed` is retired; it must not change the offline answer.
    withCeiling({ agent_chain_allowed: false });
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    const out = await createLaunchDirective(ctx, { channel: CHAN, chain: true });
    expect(out).toMatchObject({ offline: true });
    expect(vi.mocked(launchRepo.insertLaunchDirective)).not.toHaveBeenCalled();
  });

  it("a converged idempotent retry is NOT re-decided against today's ceiling", async () => {
    // A stored row is this request's answer; re-deciding it could turn a successful launch's retry into a refusal.
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
