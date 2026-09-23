/**
 * **THE SERVER'S HALF OF U9** — what a `runtime` on a launch directive does, and everything it
 * deliberately does NOT do (2026-09-21).
 *
 * 🔒 **THE DEFECT, VERBATIM FROM `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`**:
 * *a live MCP launch carrying `model: "codex"` was accepted but started a Claude Sonnet agent,
 * because the MCP contract has no runtime field and an unknown model falls through to the default
 * adapter.*
 *
 * ⚠ **THE SERVER'S JOB HERE IS TO CARRY AND TO RECORD, NOT TO DECIDE, AND THAT IS THE PROPERTY
 * THIS SUITE PINS.** It holds no runtime roster — the registry is
 * `dopl-desktop-app/main/runtime/index.js`'s, on the operator's machine, and it moves with a
 * DESKTOP release. So there is no `resolved_runtime` beside the posture's `resolved_*` group and
 * there must never be one: a server-side "resolution" would be a guess about a list it cannot
 * see, and a guess is exactly what turned `model: "codex"` into a Claude session.
 *
 * ⚠ **AND TO KEEP A RETRY ONE AGENT.** The idempotency key's uniqueness is
 * `(channel, operator, client_msg_id)` and the runtime is not in it. A retry that names a
 * different runtime is still the SAME request, and a probe that grew a runtime predicate would
 * file a second row — one agent per runtime, which is the failure mode U9's own test list names.
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

  // ⚠ THE BACKWARD-COMPATIBILITY ROW. `null` is the column's own spelling of "did not ask", which
  // the machine reads as "apply the documented chain" — its channel's runtime, then its registry
  // default. A default written HERE would take that decision away from the only party that holds
  // the roster.
  it("writes NULL when none was asked for, and never a default", async () => {
    await createLaunchDirective(ctx, LAUNCH);
    expect(inserted().runtime).toBeNull();
  });

  // 🔒 DECISION #4. The two fields are independent in both directions, and this is the payload
  // that produced the shipped defect.
  it("never derives a runtime from the model — `model: \"codex\"` writes NULL", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, model: "codex" });
    expect(inserted().model).toBe("codex");
    expect(inserted().runtime).toBeNull();
  });

  it("never derives a model from the runtime either", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex" });
    expect(inserted().model).toBeNull();
  });

  // ⚠ **THE ABSENCE IS THE DESIGN.** The posture has three groups because the SERVER can clamp
  // against a column it holds; it holds no runtime roster, so a third group here would be a
  // fabricated resolution. If this case ever fails, read the migration's header before "fixing"
  // it — the column deliberately does not exist.
  it("writes NO `resolved_runtime` — the server holds no roster to resolve against", async () => {
    await createLaunchDirective(ctx, { ...LAUNCH, runtime: "codex" });
    expect(inserted()).not.toHaveProperty("resolved_runtime");
    // ⚠ AND NOT THE MACHINE'S ECHO EITHER. `applied_*` is the DECIDE's to write; a create that
    // could stamp it would let the requester write its own confirmation.
    expect(inserted()).not.toHaveProperty("applied_runtime");
    expect(inserted()).not.toHaveProperty("applied_model");
  });
});

describe("idempotency — one directive, one agent, whatever runtime a retry names", () => {
  // ⚠ THE PROBE'S PREDICATE SET IS THE UNIQUE INDEX: `(channel, operator, client_msg_id)`. A
  // runtime added to it would make two runtimes two rows under one key — one agent per runtime,
  // which is exactly what an idempotency key exists to stop.
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
    // ⚠ AND IT ANSWERS THE **STORED** REQUEST, not the one just sent. A converged retry that
    // echoed the new runtime would tell the caller it got `cursor` while a `codex` agent runs.
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

  // ⚠ §13 — AN OLDER DESKTOP REPORTS NEITHER, AND `undefined` MUST BECOME `null` = NOT REPORTED.
  // Filling it in from the row's own REQUEST column would make the row assert that the machine
  // ran the vendor that was asked for, which is the one claim this lane cannot make.
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

  // ⚠ A RETRIED DECIDE MUST NOT LEAVE A STALE RUNTIME STANDING BESIDE A REFUSAL — the echo trio's
  // rule, which is why these are written as `null` rather than left off.
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
  // ⚠ **THE STALE-CACHE FIELD RULE (INVARIANTS).** A payload cached against an older PostgREST
  // schema arrives WITHOUT these keys entirely, and `undefined` reaching the desktop's narrowing
  // is a different bug from `null`. Every one of them defaults.
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
