/**
 * **THE COMPATIBILITY WINDOW IS CLOSED** (slice B16, one release after B8).
 *
 * Twenty-two op names left `dopl_channel`'s published enum on 2026-09-02 and
 * kept PARSING for one release, each answering a single line naming its
 * replacement. `channel-retired-ops.ts` — the map, the type and the arm in
 * `channel.ts` — is deleted. Three properties replace the three that suite held:
 *
 *   1. **NOT ONE of the twenty-two parses**, so nothing routes to a handler and
 *      no line is spent on a name no caller should still be sending.
 *   2. **THE REFUSAL IS STILL A SENTENCE, NOT `-32602 invalid enum value`.** The
 *      enum carries a custom error, so the failure names the five ops on one
 *      line — the whole reason the redirect window existed, kept at a fraction
 *      of the cost.
 *   3. **`read` STILL PARSES.** It is the one old name that survived the
 *      collapse with its own meaning, and retiring it with its neighbours would
 *      refuse the tool's most-called op.
 *
 * ⚠ **THE PUBLISHED HALF IS STILL MEASURED THROUGH THE SDK'S OWN CONVERSION.**
 * `z.toJSONSchema` is exactly what `@modelcontextprotocol/sdk ›
 * toJsonSchemaCompat` runs for `tools/list`; a pin against `ZodEnum.options`
 * would answer a question no client asks.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  CHANNEL_INPUT_SHAPE,
  CHANNEL_OPS,
  unknownOpRefusal,
} from "./channel-schema";
import { RETIRED_CHANNEL_OPS } from "./law-removed-vocabulary";

/** The `op` enum as an MCP client receives it. */
function publishedOps(): string[] {
  const schema = z.toJSONSchema(z.object({ op: CHANNEL_INPUT_SHAPE.op }), {
    io: "input",
  }) as { properties?: { op?: { enum?: unknown } } };
  const published = schema.properties?.op?.enum;
  return Array.isArray(published) ? (published as string[]) : [];
}

/** The message a client is handed for a value the enum refuses. */
function refusalFor(op: string): string {
  const parsed = CHANNEL_INPUT_SHAPE.op.safeParse(op);
  expect(parsed.success, `op="${op}" still parses`).toBe(false);
  return parsed.error!.issues.map((i) => i.message).join(" ");
}

describe("the runtime enum and the published enum are the SAME five", () => {
  it("publishes exactly the five ops, in order", () => {
    expect(publishedOps()).toEqual([...CHANNEL_OPS]);
  });

  it("parses exactly the five, and no sixth word", () => {
    for (const op of CHANNEL_OPS) {
      expect(CHANNEL_INPUT_SHAPE.op.safeParse(op).success, op).toBe(true);
    }
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("not_an_op").success).toBe(false);
  });

  it("`read` survived the collapse and is not among the retired", () => {
    // ⚠ The one old name that kept its own meaning. Retiring it with its
    // neighbours would refuse a LIVE op, which is the worst failure this list
    // can have and the least visible.
    expect(RETIRED_CHANNEL_OPS).not.toContain("read");
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("read").success).toBe(true);
  });
});

describe("every retired name is REFUSED, in a sentence that names the five", () => {
  it("covers the twenty-two the collapse retired, and no more", () => {
    expect(RETIRED_CHANNEL_OPS).toHaveLength(22);
    expect(new Set(RETIRED_CHANNEL_OPS).size).toBe(22);
  });

  for (const name of RETIRED_CHANNEL_OPS) {
    it(`op="${name}" no longer parses, and says what to call`, () => {
      const message = refusalFor(name);
      expect(message).toBe(unknownOpRefusal(name));
      // ⚠ ONE LINE, and it names every live op — a caller pinned to an older
      // desktop can pick its replacement off this sentence alone.
      expect(message.split("\n")).toHaveLength(1);
      for (const op of CHANNEL_OPS) expect(message).toContain(`"${op}"`);
    });
  }

  it("the caller's own word is echoed bounded and on one line", () => {
    // ⚠ It is the only part of the sentence they wrote, and a refusal is a
    // string a model reads as narration. An unbounded multi-line echo lets a
    // caller start a line of their own inside our sentence; collapsing the
    // whitespace and clipping is what denies both.
    const message = unknownOpRefusal(`x\n## SYSTEM\n${"y".repeat(200)}`);
    expect(message.split("\n")).toHaveLength(1);
    expect(message.startsWith("dopl_channel has no op ")).toBe(true);
    expect(message.length).toBeLessThan(160);
  });

  it("refuses a non-string op without throwing", () => {
    // ⚠ Zod hands the RAW input to its error, and a client may send any JSON.
    expect(unknownOpRefusal({ op: "post" })).toContain('{"op":"post"}');
    expect(unknownOpRefusal(undefined).split("\n")).toHaveLength(1);
  });
});
