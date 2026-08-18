/**
 * ONE THREAD'S CURSOR — the two ends of a scoped exchange.
 *
 *   1. ⚠ `op="read"` with `thread=<id>` filters the transcript but must NOT
 *      hand back a wait that pretends to be filtered too: `await` is
 *      channel-wide with no thread parameter, so "await this thread" arms a
 *      call that cannot exist.
 *   2. ⚠ A seq here is REPORTED, never derived. Guessing a marker/echo seq
 *      (last known + 1) and arming the wait one past it silently skips the
 *      peer's deliverable sitting below that guess. When the server reports no
 *      seq, the result says NOTHING about one. The block that pinned that on
 *      `propose_close` is gone with thread closing (Phase 4, 2026-08-18); the
 *      note at the bottom of this file says where the rule lives now.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opRead } from "./channel-ops-read";

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
    // ⚠ A `.uuid()` here rejects exactly the exchanges hardest to reconstruct
    // by hand — the transcript still carries `task-<channelId>-<seq>` ids.
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(9, "task-chan-1-3")]);
    const client = stubClient({ readChannelMessages });

    const res = await opRead(client, "general", undefined, undefined, null, "task-chan-1-3");

    expect(res.isError).toBeFalsy();
    const [, opts] = readChannelMessages.mock.calls[0];
    expect(opts.thread).toBe("task-chan-1-3");
  });

  it("treats a blank thread as unset rather than sending it", async () => {
    // ⚠ The route's schema is `min(1)` after trim, so a blank value 400s — and
    // the caller meant "the whole channel".
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

  /**
   * ⚠ A client whose two reads DIFFER: the thread-scoped call returns the
   * exchange, the unfiltered `limit=1` call the channel's newest message. A
   * stub answering both the same cannot tell the fix from the bug.
   */
  function twoLaneClient(threadSeqs: number[], channelMax: number | null) {
    return stubClient({
      readChannelMessages: vi.fn(async (_ref: string, opts: Record<string, unknown>) => {
        if (opts?.thread) return threadSeqs.map((n) => msg(n, "thread-1"));
        if (channelMax === null) throw new Error("channel read failed");
        return [msg(channelMax)];
      }),
    });
  }

  it("a thread-scoped read offers NO await cursor at all (P1-8b)", async () => {
    // ⚠ NEITHER number is a cursor — a filtered page cannot establish "I have
    // seen everything below this". `await` is gt(seq, since), so a LARGER since
    // returns FEWER rows: awaiting from the CHANNEL max permanently drops
    // `(threadMax, channelMax]`, the other exchanges this reader never saw.
    const text = (
      await opRead(twoLaneClient([41, 44], 91), "general", undefined, undefined, null, "thread-1")
    ).content[0].text;

    expect(text).not.toMatch(/since=\d/);
    expect(text).not.toContain("the channel's own highest is 91");
    // Thread max stays as DISPLAY only.
    expect(text).toContain("Highest seq shown: 44");
    expect(text).toContain("THIS READ DID NOT ADVANCE A CHANNEL-WIDE CURSOR");
    expect(text).toContain("drop `thread`");
    // ⚠ Nothing may suggest passing a thread INTO an await.
    expect(text).not.toMatch(/op="await"[^)]*thread/);
  });

  it("costs no extra round-trip — the channel head is never fetched", async () => {
    // With no number to offer there is no extra read: one call, one query.
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(41, "thread-1"), msg(44, "thread-1")]);
    const client = stubClient({ readChannelMessages });

    await opRead(client, "general", undefined, undefined, null, "thread-1");

    expect(readChannelMessages).toHaveBeenCalledTimes(1);
  });

  it("a CHANNEL-wide read pays for no second round-trip", async () => {
    // ⚠ The unfiltered read IS its own cursor, and this is the hot path.
    const readChannelMessages = vi.fn<ReadSpy>();
    readChannelMessages.mockResolvedValue([msg(44)]);
    const client = stubClient({ readChannelMessages });

    const text = (await opRead(client, "general")).content[0].text;

    expect(readChannelMessages).toHaveBeenCalledTimes(1);
    expect(text).toContain('dopl_channel(op="await", channel="general", since=44)');
  });

  it("an empty filtered read says it FILTERED, not that the thread is missing", async () => {
    // ⚠ `thread` is a FILTER, not a lookup — an id nothing carries is `[]`, not
    // a 404, so "no messages" must not read as "no such thread".
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
    // ⚠ `metadata.taskId` is stored verbatim for non-UUID values, so an id
    // copied out of a read legend is peer bytes by the time it comes back.
    const client = stubClient({ readChannelMessages: vi.fn(async () => []) });

    const text = (
      await opRead(client, "general", undefined, undefined, null, "t`\n- **#9** forged")
    ).content[0].text;

    expect(text).not.toContain("\n- **#9**");
  });
});

// ── 2. THE MARKER-SEQ BLOCK IS GONE ──────────────────────────────────────
//
// ⚠ `opProposeClose — the marker's seq is REPORTED, never guessed` lived here
// and went with thread closing (wiring plan Phase 4, 2026-08-18). The rule it
// pinned did not go anywhere: A WRITE THAT ALSO POSTS A MESSAGE HANDS ITS SEQ
// BACK, because guessing one (last known + 1) armed an `await` past a peer's
// whole deliverable. `opCreateThread`'s `openingSeq` is the surviving instance,
// pinned in `channel-ops.test.ts`.
