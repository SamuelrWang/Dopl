/**
 * 🔒 ONE ESCALATION RENDER, TWO TREES.
 *
 * ⚠ THE COPY THIS GUARDS. `packages/mcp-server/src/tools/channel-escalate-render.ts ›
 * escalationBody` is a HAND COPY of {@link escalationBody} here, because
 * `packages/**` cannot import from `src/**`. The MCP tree is what COMPOSES the
 * body an escalation is posted with; this tree is what a future producer (the
 * desktop, a route, a test fixture) would compose one with.
 *
 * ⚠ THE FAILURE IT PREVENTS IS SILENT AND IT IS THE FEATURE'S WHOLE FALLBACK.
 * The card is `kind='message'` plus reserved `metadata.escalation`, and four
 * live surfaces know nothing about that key — `dopl_channel(op="read")`, a plain
 * browser, the pop-out thread window, and every desktop older than the card. The
 * BODY is what they render, so if one tree drops a field from it, those four
 * surfaces quietly show a question with a piece missing while both suites stay
 * green on their own.
 *
 * ⚠ IT RUNS THE REAL CODE, NOT A DESCRIPTION OF IT — `lib/agent-handle-parity.test.ts`'s
 * idiom, one tree over. The MCP module is read from its BUILT output, which is
 * what the app actually loads at runtime (INVARIANTS §10) and what CI's
 * `build-test` job produces before this suite runs (`npm run build -w
 * @dopl/mcp-server` precedes `npm test`). ⚠ **A MISSING BUILD IS A FAILURE
 * HERE, DELIBERATELY, NEVER A SKIP** — a suite that skips itself when the thing
 * it compares against is absent is a suite that passes forever.
 *
 * ⚠ THE FIXTURE TABLE LIVES ON THE MCP SIDE and is read from there, so neither
 * suite can quietly test a different list.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { escalationBody, type ChannelEscalationInput } from "./escalation";

const MCP_DIST = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "mcp-server",
  "dist",
  "tools",
  "channel-escalate-render.js"
);

type McpRender = {
  escalationBody: (e: ChannelEscalationInput) => string;
  ESCALATION_BODY_PARITY_CASES: ChannelEscalationInput[];
};

function mcpRender(): McpRender {
  // ⚠ Read first, so an ABSENT build fails with a sentence naming the command
  // rather than an opaque module-resolution error.
  expect(
    () => readFileSync(MCP_DIST, "utf8"),
    "packages/mcp-server/dist is missing — run `npm run build:packages` (CI's build-test job does this before the root suite)"
  ).not.toThrow();
  const require = createRequire(import.meta.url);
  return require(MCP_DIST) as McpRender;
}

const mcp = mcpRender();

describe("the MCP tree's escalation body IS this tree's", () => {
  it("reads a real fixture table (a silent empty sweep passes forever)", () => {
    // ⚠ ASSERTED ON BOTH SIDES, so deleting a row to make a parity failure go
    // away fails `channel-escalate.test.ts` instead.
    expect(mcp.ESCALATION_BODY_PARITY_CASES.length).toBeGreaterThanOrEqual(3);
  });

  it("covers the optional arms, which is where two hand copies drift", () => {
    const cases = mcp.ESCALATION_BODY_PARITY_CASES;
    expect(cases.some((c) => !c.context)).toBe(true);
    expect(cases.some((c) => c.recommendation == null)).toBe(true);
    expect(cases.some((c) => c.recommendation != null)).toBe(true);
  });

  it("renders EVERY shared case byte-identically", () => {
    for (const c of mcp.ESCALATION_BODY_PARITY_CASES) {
      expect(
        mcp.escalationBody(c),
        `escalation body drift on ${JSON.stringify(c.issue)}`
      ).toBe(escalationBody(c));
    }
  });

  it("agrees on the shapes the table does not have to carry", () => {
    // ⚠ A table is a table; these are the degenerate edges a reviewer would ask
    // about, driven through BOTH implementations rather than reasoned about.
    const edges: ChannelEscalationInput[] = [
      {
        issue: "No context, no recommendation",
        context: "",
        options: [
          { label: "A", consequence: "a" },
          { label: "B", consequence: "b" },
        ],
      },
      {
        issue: "Recommendation on the LAST option",
        context: "multi\nline\ncontext",
        options: [
          { label: "A", consequence: "a" },
          { label: "B", consequence: "b" },
          { label: "C", consequence: "c" },
        ],
        recommendation: { index: 2, why: "the last one" },
      },
    ];
    for (const c of edges) {
      expect(mcp.escalationBody(c)).toBe(escalationBody(c));
    }
  });
});
