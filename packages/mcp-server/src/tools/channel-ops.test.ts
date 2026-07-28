/**
 * Focused unit tests for the v1.7 dopl_channel op deltas:
 *   - opPost folds `task` into metadata.taskId (explicit param wins);
 *   - opCloseTask forwards `summary` and surfaces it in the confirmation;
 *   - the read render labels an agent author "agent for <name>" (never a bare
 *     name), so a counterparty is not mistaken for its own operator.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost, opCloseTask } from "./channel-ops-write";
import { opRead } from "./channel-ops-read";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

/** A client whose listChannels resolves the one test channel, plus overrides. */
function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    ...overrides,
  } as unknown as DoplClient;
}

/** A typed post spy — the generic types `.mock.calls` for arg assertions. */
type PostSpy = (
  channelId: string,
  input: Record<string, unknown>,
) => Promise<{ id: string; seq: number; kind: string }>;

/** A typed close spy — the generic types `.mock.calls` for arg assertions. */
type CloseSpy = (
  channelId: string,
  taskId: string,
  input: Record<string, unknown>,
) => Promise<{ title: string; outcome: string }>;

describe("opPost — task threading (Feature 2a)", () => {
  it("folds `task` into metadata.taskId", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 5, kind: "task_progress" });
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "did the thing", {
      task: "task-uuid",
      kind: "task_progress",
    });

    expect(res.isError).toBeFalsy();
    const [channelId, input] = postChannelMessage.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(input.metadata).toEqual({ taskId: "task-uuid" });
  });

  it("merges `task` over caller metadata (explicit param wins)", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 6, kind: "message" });
    const client = stubClient({ postChannelMessage });

    await opPost(client, "general", "reply", {
      task: "task-uuid",
      metadata: { taskId: "spoofed", keep: 1 },
    });

    const [, input] = postChannelMessage.mock.calls[0];
    expect(input.metadata).toEqual({ taskId: "task-uuid", keep: 1 });
  });

  it("leaves metadata untouched when no `task` is passed", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 7, kind: "message" });
    const client = stubClient({ postChannelMessage });

    await opPost(client, "general", "chat", { metadata: { foo: "bar" } });

    const [, input] = postChannelMessage.mock.calls[0];
    expect(input.metadata).toEqual({ foo: "bar" });
  });
});

describe("opCloseTask — summary (Feature 3c)", () => {
  it("forwards `summary` to the client and surfaces it in the confirmation", async () => {
    const closeChannelTask = vi.fn<CloseSpy>();
    closeChannelTask.mockResolvedValue({ title: "Ship it", outcome: "completed" });
    const client = stubClient({ closeChannelTask });

    const res = await opCloseTask(client, "general", "task-uuid", "completed", "Shipped v2 to prod");

    const [channelId, taskId, input] = closeChannelTask.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(taskId).toBe("task-uuid");
    expect(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
    expect(res.content[0].text).toContain("Shipped v2 to prod");
  });

  it("omits the summary note when none is given", async () => {
    const closeChannelTask = vi.fn<CloseSpy>();
    closeChannelTask.mockResolvedValue({ title: "Ship it", outcome: "failed" });
    const client = stubClient({ closeChannelTask });

    const res = await opCloseTask(client, "general", "task-uuid", "failed");

    const [, , input] = closeChannelTask.mock.calls[0];
    expect(input).toEqual({ outcome: "failed", summary: undefined });
    expect(res.content[0].text).toBe("Closed task **Ship it** in **General** as failed.");
  });
});

describe("read render — counterparty identity (Feature 1b)", () => {
  function msg(overrides: Record<string, unknown>) {
    return {
      id: "m",
      seq: 1,
      channelId: "chan-1",
      authorUserId: "u-1",
      authorKind: "user",
      kind: "message",
      body: "hi",
      metadata: {},
      clientMsgId: null,
      createdAt: "2026-07-28T00:00:00Z",
      authorName: null,
      ...overrides,
    };
  }

  it("labels agents 'agent for <name>' and users by bare name", async () => {
    const client = stubClient({
      readChannelMessages: vi.fn(async () => [
        msg({ seq: 1, authorKind: "agent", authorUserId: "u-alice", authorName: "Alice" }),
        msg({ seq: 2, authorKind: "user", authorUserId: "u-bob", authorName: "Bob" }),
        msg({ seq: 3, authorKind: "agent", authorUserId: "u-x", authorName: null }),
        msg({ seq: 4, authorKind: "system", authorUserId: null, kind: "system", authorName: null }),
      ]),
    });

    const text = (await opRead(client, "general")).content[0].text;

    expect(text).toContain("agent for Alice");
    expect(text).toContain("Bob");
    expect(text).not.toContain("agent for Bob");
    // No authorName → fall back to the id, still marked as an agent.
    expect(text).toContain("agent for `u-x`");
    expect(text).toContain("system");
  });
});
