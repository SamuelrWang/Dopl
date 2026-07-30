/**
 * Focused unit tests for the dopl_channel op deltas:
 *   - opPost folds `thread` into the storage key metadata.taskId (explicit
 *     param wins);
 *   - opCloseThread forwards `summary` and surfaces it in the confirmation;
 *   - the read render labels an agent author "agent for <name>" (never a bare
 *     name), so a counterparty is not mistaken for its own operator.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost, opCloseThread } from "./channel-ops-write";
import { opRead, opListThreads, opGetThread } from "./channel-ops-read";

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
  threadId: string,
  input: Record<string, unknown>,
) => Promise<{ title: string; outcome: string }>;

describe("opPost — thread threading (Feature 2a)", () => {
  it("folds `thread` into metadata.taskId", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 5, kind: "task_progress" });
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "did the thing", {
      thread: "thread-uuid",
      kind: "task_progress",
    });

    expect(res.isError).toBeFalsy();
    const [channelId, input] = postChannelMessage.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(input.metadata).toEqual({ taskId: "thread-uuid" });
  });

  it("merges `thread` over caller metadata (explicit param wins)", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 6, kind: "message" });
    const client = stubClient({ postChannelMessage });

    await opPost(client, "general", "reply", {
      thread: "thread-uuid",
      metadata: { taskId: "spoofed", keep: 1 },
    });

    const [, input] = postChannelMessage.mock.calls[0];
    expect(input.metadata).toEqual({ taskId: "thread-uuid", keep: 1 });
  });

  it("leaves metadata untouched when no `thread` is passed", async () => {
    const postChannelMessage = vi.fn<PostSpy>();
    postChannelMessage.mockResolvedValue({ id: "m1", seq: 7, kind: "message" });
    const client = stubClient({ postChannelMessage });

    await opPost(client, "general", "chat", { metadata: { foo: "bar" } });

    const [, input] = postChannelMessage.mock.calls[0];
    expect(input.metadata).toEqual({ foo: "bar" });
  });
});

describe("opCloseThread — summary (Feature 3c)", () => {
  it("forwards `summary` to the client and surfaces it in the confirmation", async () => {
    const closeChannelThread = vi.fn<CloseSpy>();
    closeChannelThread.mockResolvedValue({ title: "Ship it", outcome: "completed" });
    const client = stubClient({ closeChannelThread });

    const res = await opCloseThread(client, "general", "thread-uuid", "completed", "Shipped v2 to prod");

    const [channelId, threadId, input] = closeChannelThread.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(threadId).toBe("thread-uuid");
    expect(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
    expect(res.content[0].text).toContain("Shipped v2 to prod");
  });

  it("omits the summary note when none is given", async () => {
    const closeChannelThread = vi.fn<CloseSpy>();
    closeChannelThread.mockResolvedValue({ title: "Ship it", outcome: "failed" });
    const client = stubClient({ closeChannelThread });

    const res = await opCloseThread(client, "general", "thread-uuid", "failed");

    const [, , input] = closeChannelThread.mock.calls[0];
    expect(input).toEqual({ outcome: "failed", summary: undefined });
    expect(res.content[0].text).toBe(
      "Closed thread **Ship it** in **General** as failed."
    );
  });
});

describe("opPost — bad thread mapping (Gap 4)", () => {
  it("maps a 400 on an unresolvable `thread` (no `to`) to a clear message", async () => {
    const postChannelMessage = vi.fn(async () => {
      throw { status: 400 };
    });
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "progress", {
      thread: "not-in-this-channel",
      kind: "task_progress",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not in this channel");
    expect(res.content[0].text).toContain("post without `thread`");
  });

  it("still maps a 400 addressee error when `to` is set", async () => {
    // `to` resolves to a member, then the route rejects them as a non-member.
    const client = stubClient({
      listWorkspaceMembers: vi.fn(async () => [
        { userId: "u-p", email: "p@x.com", displayName: "Pat", status: "active" },
      ]),
      postChannelMessage: vi.fn(async () => {
        throw { status: 400 };
      }),
    });

    const res = await opPost(client, "general", "hi", { to: "p@x.com" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("aren't a member");
  });
});

describe("opListThreads / opGetThread — thread reads (Gap 1)", () => {
  const THREAD = {
    id: "thread-1",
    channelId: "chan-1",
    workspaceId: "ws-1",
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: "u-a",
    targetUserId: "u-b",
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
    closedAt: null,
    outcomeSummary: null,
  };

  it("renders a thread list readably", async () => {
    const client = stubClient({
      listChannelThreads: vi.fn(async () => [
        THREAD,
        { ...THREAD, id: "thread-2", title: "Done one", status: "closed", outcome: "completed", outcomeSummary: "shipped" },
      ]),
    });

    const res = await opListThreads(client, "general");
    const text = res.content[0].text;
    expect(res.isError).toBeFalsy();
    expect(text).toContain("2 threads");
    expect(text).toContain("Ship it");
    expect(text).toContain("`thread-1`");
    expect(text).toContain("shipped");
    expect(text).toContain('op="get_thread"');
  });

  it("get_thread renders one thread's detail", async () => {
    const client = stubClient({
      getChannelThread: vi.fn(async () => ({ ...THREAD, outcomeSummary: "all good" })),
    });

    const res = await opGetThread(client, "general", "thread-1");
    const text = res.content[0].text;
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Ship it");
    expect(text).toContain("all good");
    expect(text).toContain("`u-b`");
  });

  it("get_thread maps a 404 (thread not in channel) to a thread-oriented not-found", async () => {
    const client = stubClient({
      getChannelThread: vi.fn(async () => {
        throw { status: 404 };
      }),
    });

    const res = await opGetThread(client, "general", "ghost");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No thread `ghost`");
    expect(res.content[0].text).toContain('op="list_threads"');
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
