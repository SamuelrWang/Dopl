/**
 * **THE ONE-RELEASE MIGRATION WINDOW, DRIVEN END TO END** (slice B8, 2026-09-02).
 *
 * Twenty-two op names left `dopl_channel`'s published enum and still PARSE, so
 * a caller pinned to an older desktop gets a sentence naming its replacement
 * instead of an opaque `-32602 invalid enum value`. Three properties have to
 * hold together or the window is not worth its characters:
 *
 *   1. **EVERY retired name answers**, through the real registrar — a table with
 *      a row nothing routes to is a migration notice nobody receives.
 *   2. **NONE of them is PUBLISHED.** The runtime enum is the union; the JSON
 *      Schema an MCP client lists is the five. A retired name a model can SEE is
 *      a name a model will call, and the collapse would have bought nothing.
 *   3. **NONE of them reaches the network.** A redirect that made a client call
 *      is a retired op still running under a new sentence.
 *
 * ⚠ **THE PUBLISHED HALF IS MEASURED THROUGH THE SDK'S OWN CONVERSION**, not off
 * the zod object: `z.enum([...]).meta({ enum: [...] })` is only a collapse if the
 * conversion `@modelcontextprotocol/sdk › toJsonSchemaCompat` runs honours the
 * override, so the assertion goes through `z.toJSONSchema` exactly as that shim
 * does. A pin against `ZodEnum.options` would pass while every client saw 27.
 *
 * ⚠ **DELETED WHOLE BY SLICE B16**, with `channel-retired-ops.ts` itself.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool } from "./narration-fixtures";
import {
  CHANNEL_INPUT_SHAPE,
  CHANNEL_OPS,
  type ChannelOp,
} from "./channel-schema";
import { RETIRED_OPS, RETIRED_OP_NAMES } from "./channel-retired-ops";

const DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  lockedWorkspaceId: () => null,
};

/** ⚠ EVERY method throws — see property 3 above. */
const TRIPWIRE = new Proxy(
  {},
  {
    get: (_t, prop) => () => {
      throw new Error(`a retired op called client.${String(prop)}`);
    },
  },
) as unknown as DoplClient;

async function run(args: Record<string, unknown>): Promise<string> {
  return callTool(
    (r, c) => registerChannelTool(r, c, undefined, false, DIRECTORY),
    TRIPWIRE,
    "dopl_channel",
    args,
  );
}

/** The `op` enum as an MCP client receives it. */
function publishedOps(): string[] {
  const schema = z.toJSONSchema(z.object({ op: CHANNEL_INPUT_SHAPE.op }), {
    io: "input",
  }) as { properties?: { op?: { enum?: unknown } } };
  const published = schema.properties?.op?.enum;
  return Array.isArray(published) ? (published as string[]) : [];
}

describe("the published enum is FIVE, whatever the runtime accepts", () => {
  it("publishes exactly the five ops, in order", () => {
    expect(publishedOps()).toEqual([...CHANNEL_OPS]);
  });

  it("publishes not one of the twenty-two retired names", () => {
    const published = new Set(publishedOps());
    for (const name of RETIRED_OP_NAMES) {
      expect(published.has(name), `"${name}" is visible to a client again`).toBe(
        false,
      );
    }
  });

  it("but the RUNTIME accepts all twenty-seven, or no redirect could run", () => {
    // ⚠ THE OTHER HALF OF THE SAME MECHANISM, asserted separately because the
    // two can break independently: drop the `.meta()` and the enum publishes 27;
    // drop the retired names from the enum and every redirect becomes a -32602.
    for (const name of [...CHANNEL_OPS, ...RETIRED_OP_NAMES]) {
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(name).success,
        `op="${name}" no longer parses`,
      ).toBe(true);
    }
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("not_an_op").success).toBe(false);
  });

  it("the two sets are DISJOINT — `read` survived and is not a redirect", () => {
    // ⚠ `read` is the one old name that kept its own meaning. A row for it would
    // refuse a LIVE op with a sentence about itself, which is the worst failure
    // this table can have and the least visible.
    for (const op of CHANNEL_OPS) {
      expect(RETIRED_OPS, `"${op}" is both published and retired`).not.toHaveProperty(
        op,
      );
    }
    expect(RETIRED_OP_NAMES).not.toContain("read" as never);
  });
});

describe("every retired name answers ONE line, and reaches nothing", () => {
  it("covers the twenty-two the collapse retired, and no more", () => {
    // ⚠ A COUNT, because the table is the whole compatibility window: a name
    // that left the enum without a row here is the opaque -32602 this exists to
    // prevent, and a row for a name that never existed is dead law.
    expect(RETIRED_OP_NAMES.length).toBe(22);
  });

  for (const name of RETIRED_OP_NAMES) {
    it(`op="${name}" → ${RETIRED_OPS[name].slice(0, 40)}…`, async () => {
      // ⚠ Driven with NO other argument on purpose: a redirect that needed a
      // channel would be a redirect an older caller could still fail to reach.
      const out = await run({ op: name });
      expect(out).toBe(`dopl_channel op="${name}" ${RETIRED_OPS[name]}`);
      // ⚠ ONE LINE. The replacement is named with the shape that answers the
      // same question and stops; a redirect that explains gets read instead of
      // followed, and `rooms(action="help")` is where the rules live.
      expect(out.split("\n")).toHaveLength(1);
      expect(out.startsWith(`dopl_channel op="${name}" retired: use `)).toBe(true);
    });
  }

  it("every line names an op that actually exists now", () => {
    // ⚠ THE PAIR THAT MAKES THE TABLE TRUE. A redirect naming a sixth op would
    // send a stalled caller to a second -32602 — and it would read as authority
    // while doing it.
    for (const [name, line] of Object.entries(RETIRED_OPS)) {
      const named = CHANNEL_OPS.filter((op: ChannelOp) => line.includes(op));
      expect(named.length, `"${name}" names no live op: ${line}`).toBeGreaterThan(0);
    }
  });
});
