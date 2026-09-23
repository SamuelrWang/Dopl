/**
 * The eight posture columns end to end: what the service writes and what `toDirective` hands back.
 * Both `toDirective` and the desktop's `directiveFrom` are literal whitelists, so a dropped column
 * fails nothing; each field is asserted by name. The echo trio is written only by the decide, and
 * `null` means "not reported" — never defaulted from the request. The tool-mode column CHECKs are
 * read from the migration in `schema-launch.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-agent-owner", () => fx.mocks.agentOwner);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import { createLaunchDirective, decideLaunchDirective } from "./service-launch";
import { createAgentDirective } from "./service-launch-agent";
import { toDirective } from "./service-launch-dto";
import { LaunchDecideSchema } from "../schema-launch";
import {
  DIR,
  ctx,
  inserted,
  row as directiveRow,
  wireLaunchDefaults,
} from "./service-launch-fixtures";

const AGENT = "a1b2c3d4";

/** A directive row carrying all eight posture columns, each null. */
function row(over: Record<string, unknown> = {}) {
  return directiveRow({
    goal: null,
    start_tool_mode: null,
    start_message_mode: null,
    chain: null,
    target_tool_mode: null,
    target_message_mode: null,
    applied_tool_mode: null,
    applied_message_mode: null,
    applied_chain: null,
    ...over,
  });
}

beforeEach(wireLaunchDefaults);

describe("createLaunchDirective persists the request", () => {
  it("writes both axes and the chain under their column names", async () => {
    await createLaunchDirective(ctx, {
      channel: "general",
      tools: "auto",
      messages: "auto_outbound",
      chain: true,
    });
    const ins = inserted();
    expect(ins.start_tool_mode).toBe("auto");
    expect(ins.start_message_mode).toBe("auto_outbound");
    expect(ins.chain).toBe(true);
  });

  it("`chain: false` IS WRITTEN AS false, never rewritten to null", async () => {
    // `false` is a real request: `main/launch-posture.js › resolveChain` grants it even where the channel allows chaining.
    await createLaunchDirective(ctx, { channel: "general", chain: false });
    expect(inserted().chain).toBe(false);
  });

  it("a launch that asks for nothing writes null on all three", async () => {
    await createLaunchDirective(ctx, { channel: "general", goal: "do a thing" });
    const ins = inserted();
    expect(ins.start_tool_mode).toBeNull();
    expect(ins.start_message_mode).toBeNull();
    expect(ins.chain).toBeNull();
  });

  it("NEVER writes the SET-MODE pair — the column CHECK refuses it at rest", async () => {
    await createLaunchDirective(ctx, { channel: "general", tools: "bypass" });
    const ins = inserted();
    expect(ins.target_tool_mode).toBeUndefined();
    expect(ins.target_message_mode).toBeUndefined();
  });

  it("NEVER writes an ECHO column — the machine reports those, not the asker", async () => {
    await createLaunchDirective(ctx, { channel: "general", tools: "auto" });
    const ins = inserted();
    expect(ins.applied_tool_mode).toBeUndefined();
    expect(ins.applied_message_mode).toBeUndefined();
    expect(ins.applied_chain).toBeUndefined();
  });
});

describe("createAgentDirective persists the set_agent_mode request", () => {
  it("writes the kind and both target modes", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "set_agent_mode", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "set_agent_mode",
      channel: "general",
      agentId: AGENT,
      tools: "accept_edits",
      messages: "auto_both",
    });
    const ins = inserted();
    expect(ins.kind).toBe("set_agent_mode");
    expect(ins.target_agent_id).toBe(AGENT);
    expect(ins.target_tool_mode).toBe("accept_edits");
    expect(ins.target_message_mode).toBe("auto_both");
  });

  it("one axis alone writes null for the other — 'leave it alone', not 'narrowest'", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "set_agent_mode", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "set_agent_mode",
      channel: "general",
      agentId: AGENT,
      tools: "auto",
    });
    expect(inserted().target_message_mode).toBeNull();
  });

  it("an END writes NO posture at all, on either pair", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(
      row({ kind: "end", target_agent_id: AGENT }) as never,
    );
    await createAgentDirective(ctx, {
      kind: "end",
      channel: "general",
      agentId: AGENT,
    });
    const ins = inserted();
    expect(ins.target_tool_mode).toBeNull();
    expect(ins.target_message_mode).toBeNull();
    expect(ins.start_tool_mode).toBeUndefined();
    expect(ins.chain).toBeUndefined();
  });
});

describe("toDirective hands back all eight columns", () => {
  const now = Date.now();

  it("maps the five REQUEST columns to camelCase, value for value", () => {
    const d = toDirective(
      row({
        kind: "set_agent_mode",
        start_tool_mode: "auto",
        start_message_mode: "auto_inbound",
        chain: true,
        target_tool_mode: "bypass",
        target_message_mode: "auto_both",
      }) as never,
      now,
    );
    // `directiveFrom` reads exactly these camelCase keys off the claim's answer.
    expect(d.startToolMode).toBe("auto");
    expect(d.startMessageMode).toBe("auto_inbound");
    expect(d.chain).toBe(true);
    expect(d.targetToolMode).toBe("bypass");
    expect(d.targetMessageMode).toBe("auto_both");
  });

  it("the ECHO trio comes back as null, NOT defaulted from the request", () => {
    const d = toDirective(
      row({ start_tool_mode: "bypass", start_message_mode: "auto_both", chain: true }) as never,
      now,
    );
    expect(d.appliedToolMode).toBeNull();
    expect(d.appliedMessageMode).toBeNull();
    expect(d.appliedChain).toBeNull();
  });

  it("carries `set_agent_mode` through as a kind rather than collapsing it to launch", () => {
    expect(toDirective(row({ kind: "set_agent_mode" }) as never, now).kind).toBe(
      "set_agent_mode",
    );
  });

  it("an unknown kind still collapses to launch — the fail-safe fallback is intact", () => {
    expect(toDirective(row({ kind: "teleport" }) as never, now).kind).toBe("launch");
  });

  it("a STALE CACHED PAYLOAD missing every new column maps to null, never undefined", () => {
    // Stale-cache rule (INVARIANTS): `undefined` would render as the string "undefined".
    const stale = row();
    for (const k of [
      "start_tool_mode",
      "start_message_mode",
      "chain",
      "target_tool_mode",
      "target_message_mode",
      "applied_tool_mode",
      "applied_message_mode",
      "applied_chain",
    ]) {
      delete (stale as Record<string, unknown>)[k];
    }
    const d = toDirective(stale as never, now);
    for (const v of [
      d.startToolMode,
      d.startMessageMode,
      d.chain,
      d.targetToolMode,
      d.targetMessageMode,
      d.appliedToolMode,
      d.appliedMessageMode,
      d.appliedChain,
    ]) {
      expect(v).toBeNull();
    }
  });
});

/** The decide is the echo's only writer (F-410). An older desktop sends none of the three (INVARIANTS
 *  §13); `null` is what `channel-facts.ts › postureFacts` renders as `not reported`. */
describe("decideLaunchDirective writes the applied echo", () => {
  const decided = () => {
    const call = vi.mocked(launchRepo.decideLaunchDirective).mock.calls[0];
    return call[3] as unknown as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: AGENT }) as never,
    );
  });

  it("maps the three `applied*` fields onto their column names", async () => {
    await decideLaunchDirective(ctx, DIR, {
      status: "launched",
      agentId: AGENT,
      appliedTools: "auto",
      appliedMessages: "auto_inbound",
      appliedChain: true,
    });
    const d = decided();
    expect(d.applied_tool_mode).toBe("auto");
    expect(d.applied_message_mode).toBe("auto_inbound");
    expect(d.applied_chain).toBe(true);
  });

  it("`appliedChain: false` is written as false, NOT collapsed to null", async () => {
    // `false` is a report ("may not launch further agents"); `null` is silence.
    await decideLaunchDirective(ctx, DIR, {
      status: "launched",
      agentId: AGENT,
      appliedChain: false,
    });
    expect(decided().applied_chain).toBe(false);
  });

  it("an OLDER DESKTOP reports nothing, and all three land as null — never as the request", async () => {
    // An older desktop posts only `{ directiveId, status, agentId }`; filling from the request would claim what was applied.
    await decideLaunchDirective(ctx, DIR, { status: "launched", agentId: AGENT });
    const d = decided();
    expect(d.applied_tool_mode).toBeNull();
    expect(d.applied_message_mode).toBeNull();
    expect(d.applied_chain).toBeNull();
  });

  it("a REFUSAL writes null on all three — nothing was applied, so nothing is reported", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "refused", refusal_reason: "no-bridge" }) as never,
    );
    await decideLaunchDirective(ctx, DIR, {
      status: "refused",
      refusalReason: "no-bridge",
    });
    const d = decided();
    expect(d.applied_tool_mode).toBeNull();
    expect(d.applied_chain).toBeNull();
    expect(d.agent_id).toBeNull();
  });

  it("an `end` / `rename` `done` reports nothing, so all three land as null", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ kind: "rename", status: "done" }) as never,
    );
    await decideLaunchDirective(ctx, DIR, { status: "done" });
    const d = decided();
    expect(d.applied_tool_mode).toBeNull();
    expect(d.applied_message_mode).toBeNull();
    expect(d.applied_chain).toBeNull();
  });

  // A `set_agent_mode`'s echo rides `done`.
  it("a `set_agent_mode` `done` writes the applied pair — and never a chain", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(row({ kind: "set_agent_mode", status: "done" }) as never);
    await decideLaunchDirective(ctx, DIR, { status: "done", appliedTools: "on-request", appliedMessages: "auto_inbound" });
    const d = decided();
    expect(d.applied_tool_mode).toBe("on-request");
    expect(d.applied_message_mode).toBe("auto_inbound");
    expect(d.applied_chain).toBeNull();
  });

  it("toDirective hands the echo back under its camelCase names", async () => {
    // `postureFacts` reads exactly these three keys.
    const d = toDirective(
      row({
        status: "launched",
        agent_id: AGENT,
        applied_tool_mode: "accept_edits",
        applied_message_mode: "auto_both",
        applied_chain: false,
      }) as never,
      Date.now(),
    );
    expect(d.appliedToolMode).toBe("accept_edits");
    expect(d.appliedMessageMode).toBe("auto_both");
    expect(d.appliedChain).toBe(false);
  });
});

/** zod stands between a machine's report and the column CHECK: a bad mode must be a named 400, not a 500. */
describe("LaunchDecideSchema carries the echo, optionally", () => {
  const launched = { directiveId: DIR, status: "launched" as const, agentId: AGENT };

  it("parses a full echo", () => {
    const parsed = LaunchDecideSchema.parse({
      ...launched,
      appliedTools: "auto",
      appliedMessages: "ask",
      appliedChain: false,
    });
    expect(parsed).toMatchObject({
      appliedTools: "auto",
      appliedMessages: "ask",
      appliedChain: false,
    });
  });

  it("parses a decide with NO echo at all — the older desktop must still be able to report", () => {
    // Required fields would 400 every decide an older desktop posts (INVARIANTS §13).
    const parsed = LaunchDecideSchema.parse(launched);
    expect(parsed).toEqual(launched);
  });

  it("refuses a mode outside the enum rather than passing it to the column CHECK", () => {
    expect(
      LaunchDecideSchema.safeParse({ ...launched, appliedTools: "yolo" }).success,
    ).toBe(false);
    expect(
      LaunchDecideSchema.safeParse({ ...launched, appliedMessages: "telepathy" }).success,
    ).toBe(false);
  });

  // zod must keep these on `done`, or a `set_agent_mode` clamp is stored as "not reported".
  it("`done` keeps a re-posture's applied pair (a Codex word too), and drops a chain", () => {
    const parsed = LaunchDecideSchema.parse({
      directiveId: DIR,
      status: "done",
      appliedTools: "on-request",
      appliedMessages: "auto_both",
      appliedChain: true,
    });
    expect(parsed).toEqual({
      directiveId: DIR, status: "done", appliedTools: "on-request", appliedMessages: "auto_both",
    });
    expect(LaunchDecideSchema.safeParse({ directiveId: DIR, status: "done", appliedTools: "yolo" })
      .success).toBe(false);
  });
});
