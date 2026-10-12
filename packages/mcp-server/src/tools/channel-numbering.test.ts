/**
 * **`#` IS THE PER-CHANNEL NUMBER, `seq` IS THE CURSOR, AND NOTHING MIXES THEM**
 * (2026-10-12, per-channel numbering B4).
 *
 * ⚠ **THE MIXING CASE IS THE ONLY ONE THAT CAN CAUSE REAL DAMAGE, SO IT IS
 * TESTED AGAINST THE WHOLE RENDERED PAGE, NOT A HELPER.** `#12` is a perfectly
 * valid global `seq` in some other room, so a number taken from the wrong
 * namespace does not error — it resolves confidently to the wrong message. The
 * last case here reads the actual `opRead` output and pins that the head moved to
 * the per-channel number WHILE `cursor=` and `since seq` kept the global one.
 *
 * ⚠ **THE FALLBACK IS PRODUCTION TODAY.** The migration filling these columns is
 * held, so every row arrives with no number and every line below falls back to
 * `seq`, byte-identically to before this branch. That is why the fallback cases
 * come first: they are not edge cases, they are the live path.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChannelMessage, DoplClient } from "@dopl/client";

import { channelNoOf, threadNoOf, type NumberedMessage } from "./channel-numbering";
import { opRead } from "./channel-ops-read";

/** A row as the wire hands it over. Cast once, at the boundary, like its siblings. */
function msg(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    seq: 4228,
    channelId: "chan-1",
    authorUserId: "u-1",
    authorKind: "user",
    kind: "message",
    body: "hi",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-10-12T00:00:00Z",
    authorName: "Samuel Wang",
    ...over,
  };
}

const asMessage = (over: Record<string, unknown> = {}) =>
  msg(over) as unknown as ChannelMessage & NumberedMessage;

function stubClient(messages: Record<string, unknown>[]): DoplClient {
  return {
    listChannels: vi.fn(async () => [
      { id: "chan-1", slug: "general", name: "General", visibility: "private" },
    ]),
    readChannelMessages: vi.fn(async () => messages),
  } as unknown as DoplClient;
}

const pageOf = async (messages: Record<string, unknown>[]) =>
  (await opRead(stubClient(messages), "general")).content[0].text as string;

const headOf = async (messages: Record<string, unknown>[]) =>
  (await pageOf(messages)).split("\n").filter((l) => l.startsWith("- **#"))[0];

describe("channelNoOf — the number `#` prints", () => {
  it("🔒 falls back to the global seq when the row carries no number", () => {
    expect(channelNoOf(asMessage())).toBe(4228);
    expect(channelNoOf(asMessage({ channelSeq: null }))).toBe(4228);
  });

  it("returns the per-channel number when the row has one", () => {
    expect(channelNoOf(asMessage({ channelSeq: 2421 }))).toBe(2421);
  });

  it("🔒 refuses a number a reader could not cite, rather than printing it", () => {
    // 0 and negatives are not seqs (`seq` is 1-based), and a NaN would render as
    // "#NaN" and compare false against everything. All fall back.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(channelNoOf(asMessage({ channelSeq: bad }))).toBe(4228);
    }
  });
});

describe("threadNoOf — the dense count inside one exchange", () => {
  it("🔒 is null when the row is in no thread, or has no number yet", () => {
    expect(threadNoOf(asMessage())).toBeNull();
    expect(threadNoOf(asMessage({ threadSeq: null }))).toBeNull();
  });

  it("returns the per-thread count when the row has one", () => {
    expect(threadNoOf(asMessage({ threadSeq: 3 }))).toBe(3);
  });

  it("🔒 never answers 0 — a thread count is 1-based", () => {
    expect(threadNoOf(asMessage({ threadSeq: 0 }))).toBeNull();
  });
});

describe("the rendered transcript", () => {
  it("🔒 prints the global seq in the head when no row has a channel number", async () => {
    // Today's output, pinned so the fallback cannot regress silently.
    expect(await headOf([msg()])).toContain("**#4228**");
  });

  it("prints the per-channel number in the head once the row has one", async () => {
    const head = await headOf([msg({ channelSeq: 2421 })]);
    expect(head).toContain("**#2421**");
    expect(head).not.toContain("**#4228**");
  });

  it("carries the per-thread count on the thread tag", async () => {
    const head = await headOf([
      msg({
        channelSeq: 2421,
        threadSeq: 3,
        metadata: { taskId: "11111111-2222-4333-8444-555555555555" },
      }),
    ]);
    expect(head).toContain("#3");
    expect(head).toMatch(/thread \S+ #3/);
  });

  it("🔒 omits the thread count rather than printing #0 or #null", async () => {
    const head = await headOf([
      msg({ metadata: { taskId: "11111111-2222-4333-8444-555555555555" } }),
    ]);
    expect(head).not.toContain("#null");
    expect(head).not.toContain("#0");
    expect(head).toContain("thread");
  });

  it("🔒 THE ANTI-MIX PIN: the head moves, the CURSOR does not", async () => {
    // ⚠ **THE WHOLE DESIGN IN ONE ASSERTION.** The head is a display identity a
    // person cites; `cursor=` is the table-wide value a caller arms a hold with.
    // If a future change routed the cursor through `channelNoOf`, an agent would
    // re-arm on a per-channel number and silently read another room's history —
    // which is not an error anywhere, just wrong answers.
    const page = await pageOf([msg({ channelSeq: 2421 })]);
    expect(page).toContain("**#2421**");
    expect(page).toContain("cursor=4228");
    expect(page).not.toContain("cursor=2421");
  });
});
