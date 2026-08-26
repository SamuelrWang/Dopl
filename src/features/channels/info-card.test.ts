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
  INFO_CARD_LABEL_MAX,
  INFO_CARD_MAX_ROWS,
  INFO_CARD_VALUE_MAX,
  hideBuiltInRow,
  isEmptyInfoCard,
  newInfoCardRowId,
  parseInfoCard,
  removeInfoCardRow,
  upsertInfoCardRow,
  type ChannelInfoCard,
} from "./info-card";

/** ⚠ The DB's floor, restated here ON PURPOSE — a literal, not an import,
 *  because the value it must match lives in SQL and cannot be imported. Change
 *  `20260825120000_channel_info_card.sql` and this goes red. */
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

describe("the caps sit UNDER the database's floor", () => {
  it("the largest card the schema accepts is well inside 4 KiB", () => {
    const worst = {
      hidden: [...INFO_CARD_BUILT_IN_KEYS],
      rows: Array.from({ length: INFO_CARD_MAX_ROWS }, (_, i) => ({
        // Ids are client-minted uuids in practice; the ceiling is slack.
        id: `${i}`.padStart(36, "0"),
        label: "x".repeat(INFO_CARD_LABEL_MAX),
        value: "y".repeat(INFO_CARD_VALUE_MAX),
      })),
    };
    expect(ChannelInfoCardSchema.safeParse(worst).success).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(worst), "utf8");
    expect(bytes).toBeLessThan(DB_MAX_BYTES);
  });
});
