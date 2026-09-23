/**
 * A launch's `runtime` is carried and recorded, never decided: the roster is the desktop registry's
 * (`dopl-desktop-app/main/runtime/index.js`), so there is no `resolved_runtime`. The idempotency key
 * `(channel, operator, client_msg_id)` excludes the runtime, so a retry naming another stays one agent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import { createLaunchDirective, decideLaunchDirective } from "./service-launch";
import {
  CHAN,
  DIR,
  ME,
  ctx,
  echoInserts,
  inserted,
  row as directiveRow,
  wireLaunchDefaults,
} from "./service-launch-fixtures";

const LAUNCH = { channel: "general", agentName: "Scout" } as const;

const row = (over: Record<string, unknown> = {}) =>
  directiveRow({ color: null, agent_name: "Scout", ...over });

beforeEach(() => {
  wireLaunchDefaults();
  echoInserts();
});

describe("create — the runtime is CARRIED, never resolved", () => {
  it("writes the requested runtime verbatim", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex" });
    expect(inserted().runtime).toBe("codex");
  });

  // `null` = "did not ask": the machine applies its channel's runtime, then its registry default.
  it("writes NULL when none was asked for, and never a default", async () => {
    await createLaunchDirective(ctx, LAUNCH);
    expect(inserted().runtime).toBeNull();
  });

  // `model: "codex"` once started a Claude agent; model and runtime are independent both ways.
  it("never derives a runtime from the model — `model: \"codex\"` writes NULL", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, model: "codex" });
    expect(inserted().model).toBe("codex");
    expect(inserted().runtime).toBeNull();
  });

  it("never derives a model from the runtime either", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex" });
    expect(inserted().model).toBeNull();
  });

  // The server holds no roster, so a resolved runtime would be a fabricated guess; the column deliberately does not exist.
  it("writes NO `resolved_runtime` — the server holds no roster to resolve against", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex" });
    expect(inserted()).not.toHaveProperty("resolved_runtime");
    // `applied_*` is the decide's to write, or the requester could write its own confirmation.
    expect(inserted()).not.toHaveProperty("applied_runtime");
    expect(inserted()).not.toHaveProperty("applied_model");
  });
});

describe("idempotency — one directive, one agent, whatever runtime a retry names", () => {
  // The probe's predicates are the unique index; a runtime among them would file one agent per runtime.
  it("probes on the key alone — the runtime is not part of the identity", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex", clientMsgId: "k1" });
    const args = vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mock.calls[0];
    expect(args).toEqual([ME, CHAN, "k1"]);
    expect(JSON.stringify(args)).not.toContain("codex");
  });

  it("a retry under the same key converges, even when it names a DIFFERENT runtime", async () => {
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(
      row({ runtime: "codex", client_msg_id: "k1" }),
    );
    const again = await createLaunchDirective(ctx, {
      ...LAUNCH,
      runtime: "cursor",
      clientMsgId: "k1",
    });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
    expect(again).toMatchObject({ offline: false, existing: true });
    // It answers the stored request, not the one just sent.
    expect(again.directive?.runtime).toBe("codex");
  });
});

describe("decide — the machine's report is stored, and only on a launch", () => {
  it("stores appliedRuntime and appliedModel on a `launched` decision", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "a1b2c3d4" }),
    );
    await decideLaunchDirective(ctx, DIR, {
      status: "launched",
      agentId: "a1b2c3d4",
      appliedRuntime: "codex",
      appliedModel: "gpt-6-astra",
    });
    const decision = vi.mocked(launchRepo.decideLaunchDirective).mock
      .calls[0][3] as unknown as Record<string, unknown>;
    expect(decision.applied_runtime).toBe("codex");
    expect(decision.applied_model).toBe("gpt-6-astra");
  });

  // An older desktop reports neither (INVARIANTS §13); `null` = not reported, never the requested runtime.
  it("maps an absent report to NULL, never to the requested runtime", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "a1b2c3d4", runtime: "codex" }),
    );
    await decideLaunchDirective(ctx, DIR, { status: "launched", agentId: "a1b2c3d4" });
    const decision = vi.mocked(launchRepo.decideLaunchDirective).mock
      .calls[0][3] as unknown as Record<string, unknown>;
    expect(decision.applied_runtime).toBeNull();
    expect(decision.applied_model).toBeNull();
  });

  // Written as `null`, not left off, so a retried decide leaves no stale runtime beside a refusal.
  it("writes NULL on `refused` and `done`, so no stale runtime survives", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "refused", refusal_reason: "no-sdk" }),
    );
    await decideLaunchDirective(ctx, DIR, { status: "refused", refusalReason: "no-sdk" });
    const decision = vi.mocked(launchRepo.decideLaunchDirective).mock
      .calls[0][3] as unknown as Record<string, unknown>;
    expect(decision.applied_runtime).toBeNull();
    expect(decision.applied_model).toBeNull();
  });
});

describe("the DTO — a row written before the column existed still reads", () => {
  // Stale-cache rule (INVARIANTS): a payload from an older PostgREST schema lacks these keys entirely.
  it("maps a row with no runtime columns to null, and launches follow the default path", async () => {
    const legacy = row();
    for (const k of ["runtime", "applied_runtime", "applied_model"]) {
      delete (legacy as unknown as Record<string, unknown>)[k];
    }
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(legacy);
    const out = await createLaunchDirective(ctx, { ...LAUNCH, clientMsgId: "k1" });
    expect(out.directive?.runtime).toBeNull();
    expect(out.directive?.appliedRuntime).toBeNull();
    expect(out.directive?.appliedModel).toBeNull();
  });
});
