/**
 * `isErr` — ONE declaration, and the object guard that makes it safe.
 *
 * ⚠ **THE BUG THIS PINS (2026-09-17).** Three copies existed: `channel-shared.ts`
 * guarded `typeof x === "object" && x !== null`, `agent-shared.ts` and
 * `knowledge-shared.ts` went straight to `"isError" in x`. The `in` operator
 * THROWS `TypeError` on a primitive, so a resolver that rejected with a string
 * or a number crashed the two agent/knowledge lanes where the channel lane
 * narrowed cleanly — the failure arriving as an opaque MCP framework error
 * rather than the refusal the op was about to return.
 *
 * The cases below are the primitives, driven through each FORMER call path's
 * own generic instantiation.
 */

import { describe, it, expect } from "vitest";
import type { AgentIdentity, Channel, KnowledgeBase } from "@dopl/client";

import { isErr } from "./channel-shared";
import type { ToolResponse } from "./respond";

/** Every non-object a rejected resolver can hand back. */
const PRIMITIVES = ["boom", "", 0, 42, true, false, null, undefined];

describe("isErr — one declaration", () => {
  it("no other module in the tree declares its own isErr", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const declarers: string[] = [];
    for (const sub of [["src"], ["src", "tools"]]) {
      const dir = path.join(process.cwd(), ...sub);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
        if (/function\s+isErr\b/.test(readFileSync(path.join(dir, f), "utf8"))) {
          declarers.push(f);
        }
      }
    }
    expect(declarers).toEqual(["channel-shared.ts"]);
  });
});

describe("🔒 isErr does not throw on a primitive", () => {
  // ⚠ Each lane instantiated as its own former copy was, so a re-introduced
  // per-lane copy fails HERE rather than in whatever op first meets a reject.
  it("the agent-identity lane (was agent-shared.ts › isErr)", () => {
    for (const p of PRIMITIVES) {
      expect(isErr<AgentIdentity>(p as unknown as AgentIdentity)).toBe(false);
    }
  });

  it("the knowledge-base lane (was knowledge-shared.ts › isErr)", () => {
    for (const p of PRIMITIVES) {
      expect(isErr<KnowledgeBase>(p as unknown as KnowledgeBase)).toBe(false);
    }
  });

  it("the channel lane", () => {
    for (const p of PRIMITIVES) {
      expect(isErr<Channel>(p as unknown as Channel)).toBe(false);
    }
  });
});

describe("isErr still narrows what it is for", () => {
  it("true for a ToolResponse error, false for a row and for a plain ok", () => {
    const refusal: ToolResponse = {
      isError: true,
      content: [{ type: "text", text: "nope" }],
    };
    expect(isErr(refusal)).toBe(true);
    expect(isErr({ content: [{ type: "text" as const, text: "fine" }] })).toBe(false);
    expect(isErr({ id: "kb-1", name: "Notes" })).toBe(false);
    // ⚠ `isError: false` is a SUCCESS, not an error — the `=== true` is load-bearing.
    expect(isErr({ isError: false, content: [] })).toBe(false);
  });
});
