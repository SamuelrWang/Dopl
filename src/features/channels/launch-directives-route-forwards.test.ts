/**
 * Both launch-directive handlers pass the parsed body through whole. A hand-enumerated field list
 * silently dropped validated fields three times (`color`, `agentName`, `appliedAgentName`; F-708),
 * because a missing optional property is not a type error. Auth and the service are mocked; every
 * schema field is sent and must reach the service.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, auth: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { userId: "user-1", workspaceId: "ws-1", role: "member" } as WorkspaceAuthContext),
}));

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({ workspaceId: auth.workspaceId, userId: auth.userId }),
  createLaunchDirective: vi.fn(),
  listPendingLaunchDirectives: vi.fn(),
  decideLaunchDirective: vi.fn(),
}));

import { POST as createPost } from "@/app/api/channels/launch-directives/route";
import { POST as decidePost } from "@/app/api/channels/launch-directives/decide/route";
import { createLaunchDirective, decideLaunchDirective } from "@/features/channels/server/service";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";
import {
  LAUNCH_MESSAGE_MODES,
  LAUNCH_TOOL_MODES,
  LaunchCreateSchema,
  LaunchDecideSchema,
} from "./schema-launch";
import { LAUNCH_APPLIED_TOOL_MODES } from "./schema-launch-modes";

const post = (handler: typeof createPost, body: unknown) =>
  handler(
    new NextRequest("https://dopl.test/api/channels/launch-directives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  );

/** One valid value for every `LaunchCreateSchema` field. */
const FULL_LAUNCH = {
  channel: "general",
  threadId: "44444444-4444-4444-8444-444444444444",
  goal: "ship the parser",
  model: "opus",
  runtime: "codex",
  identity: "Code Auditor",
  tools: LAUNCH_TOOL_MODES[0],
  messages: LAUNCH_MESSAGE_MODES[0],
  chain: false,
  clientMsgId: "k1",
  color: AGENT_COLOR_KEYS[0],
  agentName: "Scout",
};

const DIRECTIVE_ID = "55555555-5555-4555-8555-555555555555";

/** One valid value for every field of each `LaunchDecideSchema` arm, minus `directiveId`. */
const FULL_DECISIONS: Record<string, Record<string, unknown>> = {
  launched: {
    status: "launched",
    agentId: "a1b2c3d4",
    appliedTools: LAUNCH_APPLIED_TOOL_MODES[0],
    appliedMessages: LAUNCH_MESSAGE_MODES[0],
    appliedChain: false,
    appliedAgentName: "Scout",
    appliedRuntime: "codex",
    appliedModel: "gpt-6-astra",
    appliedSetting: "never/danger-full-access",
  },
  done: { status: "done", appliedTools: LAUNCH_APPLIED_TOOL_MODES[0], appliedMessages: LAUNCH_MESSAGE_MODES[0] },
  refused: { status: "refused", refusalReason: "cap" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createLaunchDirective).mockResolvedValue({ offline: true, directive: null } as never);
  vi.mocked(decideLaunchDirective).mockResolvedValue({} as never);
});

describe("POST /api/channels/launch-directives — the handler forwards the whole schema", () => {
  it("passes the parsed input straight to createLaunchDirective", async () => {
    // The payload names every schema field, so a new field fails here until it is sent too.
    expect(Object.keys(FULL_LAUNCH).sort()).toEqual(Object.keys(LaunchCreateSchema.shape).sort());
    const res = await post(createPost, FULL_LAUNCH);
    expect(res.status).toBe(200);
    expect(vi.mocked(createLaunchDirective).mock.calls[0][1]).toEqual(FULL_LAUNCH);
  });

  it("the schema still carries agentName and color", () => {
    expect(Object.keys(LaunchCreateSchema.shape)).toEqual(
      expect.arrayContaining(["agentName", "color"]),
    );
  });
});

describe("POST /api/channels/launch-directives/decide — the machine's whole report lands", () => {
  it("passes the parsed decision through whole — no arm is re-built by hand", async () => {
    for (const arm of LaunchDecideSchema.options) {
      const status = arm.shape.status.value;
      const decision = FULL_DECISIONS[status];
      expect(Object.keys({ directiveId: DIRECTIVE_ID, ...decision }).sort(), status).toEqual(
        Object.keys(arm.shape).sort()
      );
      vi.mocked(decideLaunchDirective).mockClear();
      const res = await post(decidePost, { directiveId: DIRECTIVE_ID, ...decision });
      expect(res.status, status).toBe(200);
      expect(vi.mocked(decideLaunchDirective).mock.calls[0].slice(1), status).toEqual([
        DIRECTIVE_ID,
        decision,
      ]);
    }
  });

  it("the schema's `done` arm carries the re-posture echo the handler now forwards", () => {
    const done = LaunchDecideSchema.options.find((o) => o.shape.status.value === "done");
    expect(Object.keys(done!.shape)).toEqual(
      expect.arrayContaining(["appliedTools", "appliedMessages"]),
    );
  });
});
