/**
 * `channelSeq` / `threadSeq` as they cross `mapMessageRow` — the contract half of
 * the per-channel numbering wave (design: Dopl KB `codebase-cleanup` ›
 * "Per-Channel Numbering Design"; schema: held migration `20261124120000`).
 *
 * ⚠ **THE OLD SHAPE IS THE POINT OF THIS SUITE.** The migration is HELD, so the
 * columns do not exist in production and a row arrives today with no such keys
 * at all. An installed desktop built before this wave sends and receives exactly
 * that payload, and it has to keep working — so "absent" is tested FIRST and
 * treated as a first-class input, not an edge case.
 *
 * ⚠ **`seq` IS THE CONTROL IN EVERY CASE.** The whole design rests on `seq`
 * keeping its meaning (it is the table-wide cursor the account-wide read and the
 * workspace-wide hold are legal because of). A mapper that started deriving
 * `seq` from either new number, or that dropped it, would break the cursor
 * everywhere — so every assertion below pins `seq` too.
 *
 * Pure functions. No database, and none needed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { mapMessageRow, type ChannelMessageRow } from "./dto";
import { CHANNEL_MESSAGE_COLS } from "./dto-rows";

/**
 * TODAY'S ROW, EXACTLY: no `channel_seq`, no `thread_seq`. The keys are absent
 * rather than null, which is the distinction that matters here.
 */
function oldShapeRow(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 4228,
    channel_id: "chan-1",
    workspace_id: "ws-1",
    author_user_id: "user-2",
    author_kind: "user",
    kind: "message",
    body: "hi",
    metadata: {},
    client_msg_id: "c-1",
    created_at: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}

describe("the old shape — a payload from before the migration, or from an old desktop", () => {
  it("🔒 maps both numbers to null when the columns are ABSENT, and keeps seq", () => {
    const row = oldShapeRow();
    expect("channel_seq" in row).toBe(false);
    expect("thread_seq" in row).toBe(false);

    const dto = mapMessageRow(row, undefined);

    expect(dto.channelSeq).toBeNull();
    expect(dto.threadSeq).toBeNull();
    // The control: the cursor is untouched and is still the global seq.
    expect(dto.seq).toBe(4228);
  });

  it("🔒 absent and explicitly null are the SAME answer to a caller", () => {
    // The delivery keystone's rule, applied here: an ABSENT column (migration not
    // applied) normalizes onto the same "not answered" value as a NULL one.
    const absent = mapMessageRow(oldShapeRow(), undefined);
    const explicit = mapMessageRow(
      oldShapeRow({ channel_seq: null, thread_seq: null }),
      undefined
    );
    expect(absent.channelSeq).toBe(explicit.channelSeq);
    expect(absent.threadSeq).toBe(explicit.threadSeq);
  });

  it("🔒 never throws and never invents a number for an old row", () => {
    const dto = mapMessageRow(oldShapeRow({ seq: 1 }), undefined);
    expect(dto.channelSeq).not.toBe(0);
    expect(dto.channelSeq).not.toBe(1);
    expect(dto.channelSeq).toBeNull();
  });
});

describe("the new shape — once the held migration is applied", () => {
  it("maps both numbers, and they are INDEPENDENT of seq", () => {
    // The real numbers from this channel on 2026-10-12: global 4228 is #2421 in
    // the Dopl room. Nothing may derive one from the other.
    const dto = mapMessageRow(
      oldShapeRow({ seq: 4228, channel_seq: 2421, thread_seq: 3 }),
      undefined
    );
    expect(dto.seq).toBe(4228);
    expect(dto.channelSeq).toBe(2421);
    expect(dto.threadSeq).toBe(3);
  });

  it("🔒 coerces a BIGINT arriving as a string", () => {
    // PostgREST hands a bigint back as a string once it exceeds the JS-safe
    // range, and `seq` has been bitten by this shape before.
    const dto = mapMessageRow(
      oldShapeRow({ channel_seq: "2421", thread_seq: "3" }),
      undefined
    );
    expect(dto.channelSeq).toBe(2421);
    expect(dto.threadSeq).toBe(3);
  });

  it("🔒 a main-room row carries a channel number and NO thread number", () => {
    // `thread_seq IS NULL` is a real state, not a miss: the row is in no thread.
    const dto = mapMessageRow(
      oldShapeRow({ channel_seq: 2421, thread_seq: null }),
      undefined
    );
    expect(dto.channelSeq).toBe(2421);
    expect(dto.threadSeq).toBeNull();
  });

  it("🔒 unparseable becomes null rather than NaN", () => {
    // A NaN would render as "#NaN" and would compare false against everything.
    const dto = mapMessageRow(
      oldShapeRow({ channel_seq: "not-a-number" }),
      undefined
    );
    expect(dto.channelSeq).toBeNull();
    expect(Number.isNaN(dto.channelSeq as unknown as number)).toBe(false);
  });
});

describe("the projection is deliberately NOT updated yet", () => {
  it("🔒 CHANNEL_MESSAGE_COLS does NOT name the numbering columns", () => {
    // ⚠ **THIS IS THE ORDERING PIN FOR THE WHOLE STACK, AND IT IS A REAL
    // OUTAGE.** `CHANNEL_MESSAGE_COLS` names columns explicitly, so asking for
    // one the database does not have is a PostgREST 42703 — a hard failure on
    // EVERY page read, not a silent drop (its own docblock, `dto-rows.ts`). The
    // migration is held, so the columns do not exist, so this list must not name
    // them. Both halves move in the commit that releases the migration.
    expect(CHANNEL_MESSAGE_COLS).not.toContain("channel_seq");
    expect(CHANNEL_MESSAGE_COLS).not.toContain("thread_seq");
    // Control: the list is real and still names the cursor, so this is not
    // passing because it read an empty string.
    expect(CHANNEL_MESSAGE_COLS).toContain("seq");
    expect(CHANNEL_MESSAGE_COLS.split(",").length).toBeGreaterThan(10);
  });
});

describe("the SDK twin declares both fields", () => {
  it("🔒 packages/dopl-client carries channelSeq and threadSeq, optional", () => {
    // `twin-drift.test.ts` already fails on a SERVER-ONLY field, and that is the
    // gate of record. This reads the mirror directly so the failure names the
    // actual problem — a hand-maintained copy that did not learn the fields —
    // rather than arriving as a diff of two parsed name lists.
    const twin = readFileSync(
      resolve(process.cwd(), "packages/dopl-client/src/channel-types.ts"),
      "utf8"
    );
    expect(twin).toMatch(/channelSeq\?:\s*number\s*\|\s*null;/);
    expect(twin).toMatch(/threadSeq\?:\s*number\s*\|\s*null;/);
  });
});
