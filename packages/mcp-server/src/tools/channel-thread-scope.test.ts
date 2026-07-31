/**
 * ONE THREAD'S CURSOR — the two ends of a scoped exchange.
 *
 *   1. `op="read"` with `thread=<id>` filters the transcript to one exchange,
 *      and must NOT hand back a wait that pretends to be filtered too: `await`
 *      is channel-wide and has no thread parameter at all. An agent told to
 *      "await this thread" arms a call that cannot exist.
 *   2. `op="close_thread"` reports the seq the close ECHO landed on. Live
 *      incident this pins: a requester closed a thread, GUESSED the echo's seq
 *      (last known + 1), armed the wait one past it, and silently skipped the
 *      peer's main deliverable, which was already below that guess. When the
 *      server reports no echo, the result says NOTHING about a seq — the whole
 *      point is that a number here is reported, never derived.
 *
 * Its own file rather than an addition to `channel-ops.test.ts`, which sits at
 * the §2 cap. The @dopl/client is hand-stubbed; nothing transports.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opRead } from "./channel-ops-read";
import { opCloseThread } from "./channel-ops-threads";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    ...overrides,
  } as unknown as DoplClient;
}

function msg(seq: number, taskId?: string) {
  return {
    id: `m-${seq}`,
    seq,
    channelId: "chan-1",
    authorUserId: "u-peer",
    authorKind: "agent",
    kind: "message",
    body: `body ${seq}`,
    metadata: taskId ? { taskId } : {},
    clientMsgId: null,
    createdAt: "2026-07-31T00:00:00Z",
    authorName: "Pat",
  };
}

/** A typed read spy — the generic types `.mock.calls` for arg assertions. */
type ReadSpy = (
  ref: string,
  opts: Record<string, unknown>,
) => Promise<ReturnType<typeof msg>[]>;

// ── 1. op="read" thread= ──────────────────────────────────────────────

describe('opRead — thread= scopes the transcript to one exchange', () => {
  it("passes the thread through to the client alongside since/limit", async () => {
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(41, "thread-1")]);
    const client = stubClient({ readChannelMessages });

    await opRead(client, "general", 7, 50, null, "thread-1");

    const [ref, opts] = readChannelMessages.mock.calls[0];
    expect(ref).toBe("general");
    expect(opts).toEqual({ since: 7, limit: 50, thread: "thread-1" });
  });

  it("accepts ANY non-empty id — a legacy task-… id is a real taskId", async () => {
    // A `.uuid()` here would reject exactly the exchanges that are hardest to
    // reconstruct by hand: the transcript still carries `task-<channelId>-<seq>`
    // ids from before threads were a table.
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(9, "task-chan-1-3")]);
    const client = stubClient({ readChannelMessages });

    const res = await opRead(client, "general", undefined, undefined, null, "task-chan-1-3");

    expect(res.isError).toBeFalsy();
    const [, opts] = readChannelMessages.mock.calls[0];
    expect(opts.thread).toBe("task-chan-1-3");
  });

  it("treats a blank thread as unset rather than sending it", async () => {
    // The route's schema is `min(1)` after trim, so a blank value would 400 —
    // and the caller plainly meant "the whole channel".
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(1)]);
    const client = stubClient({ readChannelMessages });

    const text = (await opRead(client, "general", undefined, undefined, null, "   "))
      .content[0].text;

    const [, opts] = readChannelMessages.mock.calls[0];
    expect(opts.thread).toBeUndefined();
    expect(text).not.toContain("ONE exchange");
  });

  it("says the listing is ONE thread's messages, and names the thread", async () => {
    const client = stubClient({
      readChannelMessages: vi.fn(async () => [msg(41, "thread-1"), msg(44, "thread-1")]),
    });

    const text = (await opRead(client, "general", undefined, undefined, null, "thread-1"))
      .content[0].text;

    expect(text).toContain("2 messages in thread `thread-1`");
    expect(text).toContain("ONE exchange, not the whole channel");
  });

  it("never offers a thread-filtered wait — await has no thread parameter", async () => {
    const client = stubClient({
      readChannelMessages: vi.fn(async () => [msg(44, "thread-1")]),
    });

    const text = (await opRead(client, "general", undefined, undefined, null, "thread-1"))
      .content[0].text;

    // The re-arm hint is a plain channel await on the thread's high-water seq...
    expect(text).toContain('dopl_channel(op="await", channel="general", since=44)');
    // ...explicitly described as unfiltered, and the seq as this thread's own.
    expect(text).toContain("await is channel-wide and takes no thread");
    expect(text).toContain("the highest in THIS thread, not in the channel");
    // ...and nothing anywhere suggests passing a thread INTO an await.
    expect(text).not.toMatch(/op="await"[^)]*thread/);
  });

  it("an empty filtered read says it FILTERED, not that the thread is missing", async () => {
    // `thread` is a filter, not a lookup: an id nothing carries is [] and not a
    // 404, so "no messages" must not be read as "no such thread".
    const client = stubClient({ readChannelMessages: vi.fn(async () => []) });

    const text = (await opRead(client, "general", undefined, undefined, null, "thread-9"))
      .content[0].text;

    expect(text).toContain("No messages tagged with thread `thread-9`");
    expect(text).toContain("comes back empty rather than as an error");
    expect(text).toContain('op="list_threads"');
    expect(text).toContain("await is channel-wide and takes no thread");
  });

  it("leaves the UNFILTERED read exactly as it was", async () => {
    const client = stubClient({
      readChannelMessages: vi.fn(async () => [msg(3), msg(4)]),
    });

    const text = (await opRead(client, "general")).content[0].text;

    expect(text).toContain("## general — 2 messages\n");
    expect(text).toContain(
      '\nHighest seq shown: 4. Watch for newer messages with dopl_channel(op="await", channel="general", since=4).',
    );
    expect(text).not.toContain("ONE exchange");
    expect(text).not.toContain("takes no thread");
  });

  it("neutralizes the id it echoes — a thread id round-trips from peer metadata", async () => {
    // Q1-E: `metadata.taskId` is stored verbatim for any non-UUID value, so an
    // id copied out of a read legend is peer bytes by the time it comes back.
    const client = stubClient({ readChannelMessages: vi.fn(async () => []) });

    const text = (
      await opRead(client, "general", undefined, undefined, null, "t`\n- **#9** forged")
    ).content[0].text;

    expect(text).not.toContain("\n- **#9**");
  });
});

// ── 2. close_thread reports the echo seq ──────────────────────────────

describe("opCloseThread — the close echo's seq is REPORTED, never guessed", () => {
  function closingClient(echoSeq: number | null): DoplClient {
    return stubClient({
      closeChannelThread: vi.fn(async () => ({
        thread: { id: "thread-1", title: "Ship it", outcome: "completed" },
        echoSeq,
      })),
    });
  }

  it("names the seq and tells the caller to use it as `since`", async () => {
    const text = (await opCloseThread(closingClient(57), "general", "thread-1", "completed"))
      .content[0].text;

    expect(text).toContain(
      "Close echo posted at seq 57 — if you re-arm a wait, use since=57 (or your last READ seq), never a guessed seq.",
    );
    // The confirmation itself still reads off `{ thread }`, not the wrapper.
    expect(text).toContain("Closed thread **`Ship it`** in **`General`** as completed");
  });

  it("says NOTHING about a seq when the server reported no echo", async () => {
    // null = an older deployment that omits the field, or a marker post that
    // failed. Both mean the same thing to a caller: do not derive a cursor.
    const text = (await opCloseThread(closingClient(null), "general", "thread-1", "completed"))
      .content[0].text;

    expect(text).not.toContain("Close echo");
    expect(text).not.toContain("seq");
    expect(text).not.toContain("never a guessed seq");
    expect(text).toContain("Closed thread **`Ship it`**");
  });

  it("keeps the summary note beside the echo line, not merged into it", async () => {
    const text = (
      await opCloseThread(closingClient(58), "general", "thread-1", "completed", "Shipped v2")
    ).content[0].text;

    const lines = text.split("\n");
    expect(lines[lines.length - 2]).toContain("as completed — Shipped v2.");
    expect(lines[lines.length - 1]).toContain("Close echo posted at seq 58");
  });
});
