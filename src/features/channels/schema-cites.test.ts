/**
 * **THE CITATION FIELD'S VALIDATION** — grammar B (2026-10-12).
 *
 * ⚠ **THE COERCION CASES ARE THE POINT OF THIS FILE.** A citation is a POINTER,
 * and `z.coerce.number()` turns `true` into **1** and `""` / `[]` into **0** — so
 * a lenient schema would manufacture a confident pill at message one out of
 * junk. The read args in `schema-reads.ts` coerce on purpose (MCP clients send
 * numbers as strings, and a bad cursor is only a bad page); this field follows
 * `schema-collab.ts › ConsentMessageSeqSchema` instead, which refuses coercion
 * because a de-dupe key must never be manufactured.
 *
 * ⚠ A numeric STRING is still accepted — clients do send `"12"` — through an
 * explicit digits-only transform, which is the whole difference between
 * accepting a string and coercing anything.
 */

import { describe, it, expect } from "vitest";

import { CiteInputSchema, CitesInputSchema } from "./schema-cites";
import { CHANNEL_CITES_MAX } from "./constants";

describe("a citation names exactly one namespace", () => {
  it("accepts a global seq", () => {
    const parsed = CiteInputSchema.parse({ seq: 4228 });
    expect(parsed).toEqual({ seq: 4228 });
  });

  it("accepts a per-channel number (resolution refuses it until the migration lands)", () => {
    expect(CiteInputSchema.parse({ no: 12 })).toEqual({ no: 12 });
  });

  it("🔒 refuses BOTH at once — two answers to one question", () => {
    expect(() => CiteInputSchema.parse({ no: 12, seq: 4228 })).toThrow(
      /exactly one/i
    );
  });

  it("🔒 refuses NEITHER — a citation that names nothing", () => {
    expect(() => CiteInputSchema.parse({})).toThrow(/exactly one/i);
    expect(() => CiteInputSchema.parse({ thread: "t-1" })).toThrow(/exactly one/i);
  });
});

describe("no coercion — junk never becomes a message number", () => {
  it("🔒 `true` is NOT 1", () => {
    // The case that makes `z.coerce` unusable here: `true` coerces to 1, and 1 is
    // a perfectly valid citation, so the pill would point at message one.
    expect(() => CiteInputSchema.parse({ seq: true })).toThrow();
    expect(() => CiteInputSchema.parse({ no: true })).toThrow();
  });

  it("🔒 empty string, empty array and null are NOT 0", () => {
    for (const junk of ["", [], null, {}]) {
      expect(() => CiteInputSchema.parse({ seq: junk })).toThrow();
    }
  });

  it("🔒 a non-numeric string is refused", () => {
    expect(() => CiteInputSchema.parse({ seq: "12a" })).toThrow();
    expect(() => CiteInputSchema.parse({ seq: "1.5" })).toThrow();
    expect(() => CiteInputSchema.parse({ seq: " 12" })).toThrow();
  });

  it("accepts a digits-only string, because MCP clients send one", () => {
    expect(CiteInputSchema.parse({ seq: "4228" })).toEqual({ seq: 4228 });
  });

  it("🔒 refuses zero and negatives — seq is 1-based", () => {
    expect(() => CiteInputSchema.parse({ seq: 0 })).toThrow();
    expect(() => CiteInputSchema.parse({ seq: -1 })).toThrow();
    expect(() => CiteInputSchema.parse({ seq: "0" })).toThrow();
  });
});

describe("the list", () => {
  it("🔒 an EMPTY array is a real value, not a missing one", () => {
    // Under grammar B "I cited nothing" is the common case; nothing may
    // normalise it away.
    expect(CitesInputSchema.parse([])).toEqual([]);
  });

  it(`🔒 caps at ${CHANNEL_CITES_MAX} — the cap bounds a server-side resolution`, () => {
    const entry = { seq: 1 };
    expect(
      CitesInputSchema.parse(Array.from({ length: CHANNEL_CITES_MAX }, () => entry))
    ).toHaveLength(CHANNEL_CITES_MAX);
    expect(() =>
      CitesInputSchema.parse(
        Array.from({ length: CHANNEL_CITES_MAX + 1 }, () => entry)
      )
    ).toThrow();
  });
});
