/**
 * A retry may not queue a second agent, on both agent mailboxes: a repeated key converges on the
 * stored row, above the identity/thread/presence gates; a lost insert race converges too; a 23505 on
 * any other constraint still throws. `existing` is what MCP renders as `retry=existing`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
// `createAgentDirection` asks whether the target is another member's; `false` (unknown or stale still files) is the default (F-418).
vi.mock("./repository-agent-owner", () => fx.mocks.agentOwner);
vi.mock("./repository-directions");
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as directionRepo from "./repository-directions";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { resolveIdentityRef } from "@/features/agent-identities/server/service";
import { loadVisibleChannel } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import { createAgentDirection } from "./service-directions";
import { AGENT_DIRECTION_TTL_MS } from "../constants";
import {
  CHAN,
  CHANNEL_ROW,
  DIR,
  ME,
  WS,
  ctx,
  row,
  wireLaunchDefaults,
} from "./service-launch-fixtures";

const AGENT = "k3wpf7c5";
const KEY = "orchestrator-run-7:launch-1";

const launchRow = (over: Record<string, unknown> = {}) => row({ client_msg_id: KEY, ...over });

function directionRow(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    agent_id: AGENT,
    sender_agent_id: null,
    body: "status?",
    status: "pending",
    refusal_reason: null,
    reply: null,
    claimed_at: null,
    decided_at: null,
    client_msg_id: KEY,
    expires_at: new Date(Date.now() + AGENT_DIRECTION_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  } as never;
}

/** A PostgREST unique violation, the shape `pgErrorCode` reads. */
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
  });

beforeEach(() => {
  wireLaunchDefaults();
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(launchRow());
  vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(null);
  vi.mocked(directionRepo.insertAgentDirection).mockResolvedValue(directionRow());
});

describe("launch_agent — the probe converges instead of filing a second directive", () => {
  it("no key means no probe and today's behaviour byte for byte", async () => {
    const result = await createLaunchDirective(ctx, { channel: "general", goal: "go" });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
    expect(launchRepo.insertLaunchDirective).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ offline: false, existing: false });
  });

  it("a key is written to the row, so the retry has something to find", async () => {
    await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(launchRepo.insertLaunchDirective).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({ client_msg_id: KEY })
    );
  });

  it("a repeated key returns the FIRST directive and files nothing", async () => {
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(
      launchRow({ status: "launched", agent_id: "abcd1234" })
    );
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
    expect(result).toMatchObject({ offline: false, existing: true });
    expect(result.directive?.id).toBe(DIR);
    // The probe's arguments are the index: without the operator another member's key answers; without the channel another room's.
    expect(launchRepo.findLaunchDirectiveByClientMsgId).toHaveBeenCalledWith(ME, CHAN, KEY);
  });

  it("a MEMBERSHIP row is still required — converging is still a read of that channel", async () => {
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: CHANNEL_ROW,
      membership: null,
    } as never);
    await expect(
      createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY })
    ).rejects.toThrow();
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
  });
});

describe("launch_agent — the probe sits ABOVE the gates a retry must not be re-judged by", () => {
  it("an OFFLINE machine does not turn a filed directive into `nothing was filed`", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(launchRow());
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    // `offline: true` says nothing was filed, which invites a retry over a row that exists.
    expect(result).toMatchObject({ offline: false, existing: true });
  });

  it("an identity deleted since the first call does not refuse the retry", async () => {
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" } as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(
      launchRow({ identity_id: null, identity_name: "Code Auditor" })
    );
    const result = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Code Auditor",
      clientMsgId: KEY,
    });
    expect(resolveIdentityRef).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
  });

  it("a thread id is not re-validated either — the stored row already names one", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(launchRow());
    const result = await createLaunchDirective(ctx, {
      channel: "general",
      threadId: "44444444-4444-4444-4444-444444444444",
      clientMsgId: KEY,
    });
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
  });
});

describe("launch_agent — the race, where both probes miss", () => {
  it("a lost race converges on the winner rather than 500-ing", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(
      uniqueViolation("channel_launch_directives_client_msg_key")
    );
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(launchRow());
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(result).toMatchObject({ offline: false, existing: true });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).toHaveBeenCalledTimes(2);
  });

  it("a 23505 from SOME OTHER constraint still throws — no silent success with no row", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(
      uniqueViolation("channel_launch_directives_replica_identity_idx")
    );
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(null);
    await expect(
      createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY })
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a keyless call rethrows a 23505 untouched — there is nothing to converge on", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(uniqueViolation("whatever"));
    await expect(createLaunchDirective(ctx, { channel: "general" })).rejects.toMatchObject({
      code: "23505",
    });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
  });
});

describe("direct_agent — the same rule, and the reply is what a converged retry collects", () => {
  it("no key means no probe", async () => {
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
    });
    expect(directionRepo.findAgentDirectionByClientMsgId).not.toHaveBeenCalled();
    expect(result).toMatchObject({ offline: false, existing: false });
  });

  it("a key is written to the row", async () => {
    await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(directionRepo.insertAgentDirection).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({ client_msg_id: KEY })
    );
  });

  it("a repeated key returns the stored direction, REPLY INCLUDED", async () => {
    // A direction's reply reaches the caller nowhere else, so a converged retry is how a timed-out hold collects it.
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(
      directionRow({ status: "delivered", reply: "done, 3 files changed" })
    );
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(directionRepo.insertAgentDirection).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
    expect(result.direction?.reply).toBe("done, 3 files changed");
  });

  it("an OFFLINE machine does not turn a filed direction into `nothing was filed`", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(directionRow());
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(result).toMatchObject({ offline: false, existing: true });
  });

  it("a lost race converges on the winner", async () => {
    vi.mocked(directionRepo.insertAgentDirection).mockRejectedValue(
      uniqueViolation("channel_agent_directions_client_msg_key")
    );
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(directionRow());
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(result).toMatchObject({ existing: true });
  });

  it("the key never becomes an identity — the operator is still a separate argument", async () => {
    await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    const [operator, body] = vi.mocked(directionRepo.insertAgentDirection).mock.calls[0];
    expect(operator).toBe(ME);
    expect(Object.keys(body)).not.toContain("operator_user_id");
  });
});
