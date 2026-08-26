/**
 * THE INFO-CARD CONTRACT — the shape, its bounds, and the four pure editors
 * every surface builds a next card with.
 *
 * ⚠ THE LAST BLOCK IS A JOIN ACROSS A BOUNDARY NO TYPESCRIPT REACHES. The card
 * is bounded three times: by these caps, by the zod schema, and by
 * `channels_info_card_check` in the database (4 KiB, JSON object). The SQL is
 * the floor; the caps are the product rule. Nothing ties them, so a widened cap
 * would surface as an opaque 500 at the constraint — the test computes the
 * worst legal card and holds it against the floor.
 */

import { describe, expect, it } from "vitest";
import {
  ChannelInfoCardSchema,
  EMPTY_INFO_CARD,
  INFO_CARD_BUILT_IN_KEYS,
  INFO_CARD_DB_FLOOR_BYTES,
  INFO_CARD_ID_MAX,
  INFO_CARD_LABEL_MAX,
  INFO_CARD_MAX_BYTES,
  INFO_CARD_MAX_ROWS,
  INFO_CARD_VALUE_MAX,
  hideBuiltInRow,
  infoCardTextBytes,
  infoCardWithinByteLimit,
  isEmptyInfoCard,
  newInfoCardRowId,
  parseInfoCard,
  removeInfoCardRow,
  upsertInfoCardRow,
  type ChannelInfoCard,
  type ChannelInfoCardInput,
} from "./info-card";

/** ⚠ The DB's floor, restated here ON PURPOSE — a literal, not an import,
 *  because the value it must match lives in SQL and cannot be imported. Change
 *  `20260825120000_channel_info_card.sql` and this (and INFO_CARD_DB_FLOOR_BYTES)
 *  go red. */
const DB_MAX_BYTES = 4096;

const row = (id: string, label = "Phone", value = "+1") => ({ id, label, value });

describe("ChannelInfoCardSchema", () => {
  it("parses {} to the empty card — that is how a card is CLEARED", () => {
    expect(ChannelInfoCardSchema.parse({})).toEqual({ hidden: [], rows: [] });
  });

  it("accepts every built-in key and refuses one that names no row", () => {
    expect(
      ChannelInfoCardSchema.parse({ hidden: [...INFO_CARD_BUILT_IN_KEYS] }).hidden
    ).toEqual([...INFO_CARD_BUILT_IN_KEYS]);
    // ⚠ A CLOSED SET. An open one turns `hidden` into a junk drawer that
    // outlives the rows it names, with nothing ever saying a key went dead.
    expect(ChannelInfoCardSchema.safeParse({ hidden: ["phone"] }).success).toBe(
      false
    );
  });

  it("refuses DUPLICATE row ids — two rows, one ×, no way to say which", () => {
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a"), row("a", "Other")] })
        .success
    ).toBe(false);
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a"), row("b")] }).success
    ).toBe(true);
  });

  it("caps the row count, the label and the value", () => {
    const many = Array.from({ length: INFO_CARD_MAX_ROWS + 1 }, (_, i) =>
      row(`r${i}`)
    );
    expect(ChannelInfoCardSchema.safeParse({ rows: many }).success).toBe(false);
    expect(
      ChannelInfoCardSchema.safeParse({
        rows: [row("a", "x".repeat(INFO_CARD_LABEL_MAX + 1))],
      }).success
    ).toBe(false);
    expect(
      ChannelInfoCardSchema.safeParse({
        rows: [row("a", "Phone", "x".repeat(INFO_CARD_VALUE_MAX + 1))],
      }).success
    ).toBe(false);
  });

  it("allows an EMPTY value but not an empty label", () => {
    // A row waiting for its answer is a row; a row with nothing in the left
    // column states nothing and cannot be found again to delete.
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a", "Phone", "")] }).success
    ).toBe(true);
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a", "", "x")] }).success
    ).toBe(false);
  });

  it("refuses the structure-forging characters `safe-label.ts` exists for", () => {
    // A label is spliced into a line we wrote; a newline plus `##` forges a
    // heading in the server's voice.
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a", "Ph\none")] }).success
    ).toBe(false);
    expect(
      ChannelInfoCardSchema.safeParse({ rows: [row("a", "Phone", "a​b")] })
        .success
    ).toBe(false);
  });
});

describe("parseInfoCard — the READ path never throws", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
    ["a scalar", 7],
    ["a retired key", { hidden: ["postureLevel"] }],
    ["a malformed row", { rows: [{ id: "a" }] }],
  ])("degrades %s to the card as shipped", (_name, raw) => {
    expect(parseInfoCard(raw)).toEqual(EMPTY_INFO_CARD);
  });

  it("passes a good card through unchanged", () => {
    const card = { hidden: ["email"], rows: [row("a")] };
    expect(parseInfoCard(card)).toEqual(card);
  });
});

describe("the pure editors", () => {
  const base: ChannelInfoCard = { hidden: [], rows: [row("a")] };

  it("hideBuiltInRow adds once and is idempotent", () => {
    const once = hideBuiltInRow(base, "email");
    expect(once.hidden).toEqual(["email"]);
    // ⚠ IDENTITY, not just equality: an idempotent edit must not mint a new
    // object, or every no-op save would look like a change to a memo above it.
    expect(hideBuiltInRow(once, "email")).toBe(once);
  });

  it("removeInfoCardRow drops by id and is idempotent", () => {
    expect(removeInfoCardRow(base, "a").rows).toEqual([]);
    expect(removeInfoCardRow(base, "nope")).toBe(base);
  });

  it("upsertInfoCardRow REPLACES by id rather than appending", () => {
    const next = upsertInfoCardRow(base, row("a", "Phone", "+2"));
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0].value).toBe("+2");
  });

  it("⚠ AT THE CAP a NEW row is refused, and an EDIT is not", () => {
    const full: ChannelInfoCard = {
      hidden: [],
      rows: Array.from({ length: INFO_CARD_MAX_ROWS }, (_, i) => row(`r${i}`)),
    };
    // Refused by returning the card UNCHANGED — never by evicting the oldest,
    // which is data loss wearing a convenience's clothes.
    expect(upsertInfoCardRow(full, row("new"))).toBe(full);
    const edited = upsertInfoCardRow(full, row("r0", "Phone", "+9"));
    expect(edited).not.toBe(full);
    expect(edited.rows).toHaveLength(INFO_CARD_MAX_ROWS);
    expect(edited.rows[0].value).toBe("+9");
  });

  it("never mutates the card it was given — the cache entry is shared", () => {
    const frozen: ChannelInfoCard = Object.freeze({
      hidden: Object.freeze([]) as readonly never[],
      rows: Object.freeze([row("a")]) as readonly { id: string; label: string; value: string }[],
    });
    expect(() => hideBuiltInRow(frozen, "email")).not.toThrow();
    expect(() => removeInfoCardRow(frozen, "a")).not.toThrow();
    expect(() => upsertInfoCardRow(frozen, row("b"))).not.toThrow();
    expect(frozen.rows).toHaveLength(1);
  });

  it("isEmptyInfoCard is true only for the shipped card", () => {
    expect(isEmptyInfoCard(EMPTY_INFO_CARD)).toBe(true);
    expect(isEmptyInfoCard(hideBuiltInRow(EMPTY_INFO_CARD, "created"))).toBe(false);
    expect(isEmptyInfoCard(base)).toBe(false);
  });

  it("newInfoCardRowId mints distinct ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newInfoCardRowId()));
    expect(ids.size).toBe(50);
  });
});

describe("the byte guard sits UNDER the database's floor", () => {
  /**
   * ⚠ MEASURED THE WAY THE CHECK MEASURES IT. `channels_info_card_check` bounds
   * `octet_length(info_card::text)`, and pg's jsonb text form carries a `": "`
   * after every key and a `", "` between every element — bytes `JSON.stringify`
   * never emits. `infoCardTextBytes` reproduces that spacing; the fixtures here
   * fill with CJK (3 UTF-8 bytes each), the true worst case, and pin the actual
   * cap constants (`INFO_CARD_ID_MAX = 64`, not a hardcoded 36).
   */
  const cjkRow = (i: number) => ({
    id: `${i}`.padStart(INFO_CARD_ID_MAX, "0"),
    label: "文".repeat(INFO_CARD_LABEL_MAX),
    value: "字".repeat(INFO_CARD_VALUE_MAX),
  });

  it("the per-field caps do NOT bound the total — a full CJK card BLOWS the floor", () => {
    // ⚠ THIS IS WHY THE BYTE GUARD EXISTS. Every field is at its zod cap and the
    // card parses clean, yet measured as `info_card::text` it is far past 4 KiB —
    // so a per-field cap alone would let a schema-valid card 500 at the DB.
    const worst = {
      hidden: [...INFO_CARD_BUILT_IN_KEYS],
      rows: Array.from({ length: INFO_CARD_MAX_ROWS }, (_, i) => cjkRow(i)),
    };
    expect(ChannelInfoCardSchema.safeParse(worst).success).toBe(true);
    // The measurement is HONEST: jsonb text form, CJK, over the floor.
    expect(infoCardTextBytes(worst)).toBeGreaterThan(DB_MAX_BYTES);
  });

  it("the app ceiling is under the DB floor — the margin that prevents the 500", () => {
    expect(INFO_CARD_MAX_BYTES).toBeLessThan(INFO_CARD_DB_FLOOR_BYTES);
    expect(INFO_CARD_DB_FLOOR_BYTES).toBe(DB_MAX_BYTES);
  });

  it("the largest card the guard ADMITS still measures under the DB floor (jsonb text form)", () => {
    // ⚠ THE INVARIANT THAT GOES RED IF THE CEILING IS RAISED PAST THE FLOOR:
    // grow a CJK card row-by-row up to the byte guard, then measure it the way
    // the CHECK does. If INFO_CARD_MAX_BYTES ever creeps to/over 4096, the
    // admitted card would breach the floor and this fails.
    const rows: ReturnType<typeof cjkRow>[] = [];
    for (let i = 0; i < INFO_CARD_MAX_ROWS; i++) {
      const next = { hidden: [...INFO_CARD_BUILT_IN_KEYS], rows: [...rows, cjkRow(i)] };
      if (!infoCardWithinByteLimit(next)) break;
      rows.push(cjkRow(i));
    }
    const admitted = { hidden: [...INFO_CARD_BUILT_IN_KEYS], rows };
    expect(infoCardWithinByteLimit(admitted)).toBe(true);
    expect(infoCardTextBytes(admitted)).toBeLessThan(DB_MAX_BYTES);
  });

  it("infoCardTextBytes counts the jsonb SEPARATORS JSON.stringify omits", () => {
    // A single row: pg writes `": "` ×4 keys and `", "` ×2 element joins that the
    // compact form drops. The honest count must exceed the compact one, or the
    // measurement would undercount the constraint.
    const one: ChannelInfoCardInput = {
      hidden: ["email"],
      rows: [{ id: "a", label: "Phone", value: "+1" }],
    };
    expect(infoCardTextBytes(one)).toBeGreaterThan(
      Buffer.byteLength(JSON.stringify(one), "utf8")
    );
  });

  it("the byte guard admits a small card and refuses one just over the ceiling", () => {
    expect(infoCardWithinByteLimit({ hidden: [], rows: [row("a")] })).toBe(true);
    // A pile of max-value CJK rows overruns the ceiling; the guard says no.
    const big = {
      hidden: [...INFO_CARD_BUILT_IN_KEYS],
      rows: Array.from({ length: INFO_CARD_MAX_ROWS }, (_, i) => cjkRow(i)),
    };
    expect(infoCardWithinByteLimit(big)).toBe(false);
  });
});
