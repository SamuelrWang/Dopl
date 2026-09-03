/**
 * **THE COPY OPS' ONE-RELEASE MIGRATION WINDOW, DRIVEN END TO END** (slice B15,
 * 2026-09-02, ruling B11: *grants replace copies*).
 *
 * `dopl_kb(op="copy_base")` and `dopl_agent(op="copy")` are deleted. The NAMES
 * still parse and answer one line naming the grant that replaced them. Four
 * properties, and they break independently:
 *
 *   1. **BOTH names answer**, through the real registrar — a table row nothing
 *      routes to is a migration notice nobody receives.
 *   2. **NEITHER is PUBLISHED.** The runtime enum is the union; the JSON Schema
 *      a client lists is the live set. A retired name a model can SEE is a name
 *      a model will call.
 *   3. **NEITHER reaches the network.** A redirect that made a client call is a
 *      copy op still running under a new sentence.
 *   4. **THE REDIRECT IS KEYED BY TOOL**, so `dopl_kb` does not answer for
 *      `copy` and `dopl_agent` does not answer for `copy_base` — each tool
 *      redirects its own retired word and calls the other one unknown.
 *
 * ⚠ **THE PUBLISHED HALF IS MEASURED THROUGH THE SDK'S OWN CONVERSION**, not off
 * the zod object — the same argument `channel-retired-ops.test.ts` makes: a pin
 * against `ZodEnum.options` would pass while every client saw the retired name.
 *
 * ⚠ **DELETED WHOLE WITH `retired-copy-ops.ts`**, one release after the desktop
 * version floor stops calling either name.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { DoplClient } from "@dopl/client";

import { registerKnowledgeTools } from "./knowledge";
import { registerAgentTools } from "./agent";
import { callTool } from "./narration-fixtures";
import { RETIRED_COPY_OP_NAMES } from "./retired-copy-ops";

const DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  lockedWorkspaceId: () => null,
};

/** ⚠ EVERY method throws — see property 3. */
const TRIPWIRE = new Proxy(
  {},
  {
    get: (_t, prop) => () => {
      throw new Error(`a retired copy op called client.${String(prop)}`);
    },
  },
) as unknown as DoplClient;

const TOOLS = {
  dopl_kb: {
    register: (r: never, c: DoplClient) =>
      registerKnowledgeTools(r, c, undefined, DIRECTORY as never),
    retired: "copy_base",
    foreign: "copy",
    replacement: 'dopl_kb(op="grant", base=…',
  },
  dopl_agent: {
    register: (r: never, c: DoplClient) =>
      registerAgentTools(r, c, undefined, DIRECTORY as never),
    retired: "copy",
    foreign: "copy_base",
    replacement: 'dopl_agent(op="grant", template=…',
  },
} as const;

type ToolName = keyof typeof TOOLS;

async function run(tool: ToolName, args: Record<string, unknown>): Promise<string> {
  return callTool(
    (r, c) => TOOLS[tool].register(r as never, c),
    TRIPWIRE,
    tool,
    args,
  );
}

/** The `op` enum as an MCP client receives it, through the SDK's conversion. */
function publishedOps(tool: ToolName): string[] {
  let shape: Record<string, z.ZodTypeAny> | null = null;
  const cap = ((name: string, _d: string, s: unknown) => {
    if (name === tool) shape = s as Record<string, z.ZodTypeAny>;
  }) as never;
  TOOLS[tool].register(cap, TRIPWIRE);
  const schema = z.toJSONSchema(z.object({ op: shape!.op }), { io: "input" }) as {
    properties?: { op?: { enum?: unknown } };
  };
  const published = schema.properties?.op?.enum;
  return Array.isArray(published) ? (published as string[]) : [];
}

describe("the copy ops are gone from both published enums", () => {
  for (const tool of Object.keys(TOOLS) as ToolName[]) {
    it(`${tool} publishes no copy op, and still routes one`, async () => {
      const published = publishedOps(tool);
      expect(published.length).toBeGreaterThan(0);
      for (const name of RETIRED_COPY_OP_NAMES) {
        expect(published, `"${name}" is visible to a client again`).not.toContain(
          name,
        );
      }
      // ⚠ THE OTHER HALF: drop the retired names from the runtime enum and every
      // redirect becomes an opaque -32602 instead of a sentence.
      const out = await run(tool, { op: TOOLS[tool].retired });
      expect(out).toContain(`${tool} op="${TOOLS[tool].retired}" retired:`);
    });
  }
});

describe("each retired name answers ONE line, names the grant, and reaches nothing", () => {
  for (const tool of Object.keys(TOOLS) as ToolName[]) {
    const row = TOOLS[tool];

    it(`${tool} op="${row.retired}" → use a grant`, async () => {
      // ⚠ Driven with NO other argument: a redirect that needed the copy's own
      // required params would be one an older caller could still fail to reach.
      const out = await run(tool, { op: row.retired });
      expect(out).toContain("use a grant");
      expect(out).toContain(row.replacement);
      // 🔒 THE DIFFERENCE THAT MADE THE COPY WRONG, said in the redirect.
      expect(out).toContain("an edit reaches everyone it is lent to");
      // ⚠ ONE LINE — a redirect that explains gets read instead of followed.
      expect(out.split("\n")).toHaveLength(1);
    });

    it(`${tool} does NOT answer for the OTHER tool's retired word`, async () => {
      // ⚠ PROPERTY 4. `copy` is a plausible op name on a third tool, and a
      // redirect keyed on the bare word would answer for it forever.
      const out = await run(tool, { op: row.foreign });
      expect(out).toBe(`${tool} has no op "${row.foreign}".`);
    });
  }
});
