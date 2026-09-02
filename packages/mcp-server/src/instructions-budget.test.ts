/**
 * THE INSTRUCTIONS BUDGET — the gate that keeps the briefing inside the prefix
 * a model actually receives (A1, 2026-09-02).
 *
 * ⚠ WHY A NUMBER AND NOT A CONVENTION. The block that grew to 17,065 chars was
 * built entirely out of true sentences, each one added by somebody who had just
 * been bitten. Nothing about "keep it short" survives that pressure. What the
 * cap adds is the one fact none of those authors had: **the CLI delivers the
 * first {@link INSTRUCTIONS_MAX_CHARS} characters and drops the rest**, so past
 * that line a sentence is not a weak rule — it is an absent one, served and
 * paid for on every connection and read by nobody.
 *
 * ⚠ THE BUDGET IS OVER THE RENDERED BLOCK, not over the template, because the
 * caller's own workspace directory is spliced into it. Hence the shapes below:
 * the cap has to hold for the caller who has one workspace and for the one who
 * has several, or it is a cap on the easy case only.
 *
 * ⚠ AND NOTHING IS DELETED, ONLY UN-PUSHED. The last two suites are the other
 * half of the claim: the skill-authoring guide is no longer interpolated here,
 * AND `dopl_skill(op="authoring_guide")` still returns it byte for byte.
 */

import { describe, it, expect } from "vitest";
import type { WorkspaceListItem } from "@dopl/client";

import { buildInstructions, INSTRUCTIONS_MAX_CHARS } from "./instructions.js";
import { SKILL_AUTHORING_GUIDE } from "./prompts/skill-authoring-guide.js";
import { registerSkillTools } from "./tools/skills.js";
import { callTool, stub } from "./tools/narration-fixtures.js";

function ws(n: number): WorkspaceListItem {
  return {
    id: `id-${n}`,
    ownerId: "owner",
    name: `Product Engineering ${n}`,
    slug: `product-engineering-${n}`,
    publicId: `pub-${n}`,
    // ⚠ Descriptions are rendered, so a shape without one measures nothing.
    description: `Where the team keeps specs, runbooks and release notes (${n}).`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

const directoryOf = (n: number) => Array.from({ length: n }, (_, i) => ws(i + 1));

/** Every membership shape `server.ts › createServer` can boot into. */
const SHAPES: Array<[string, string]> = [
  ["no memberships", buildInstructions([])],
  ["directory load failed", buildInstructions([], { directoryLoadFailed: true })],
  ["sole membership", buildInstructions(directoryOf(1))],
  ["two, no pin", buildInstructions(directoryOf(2))],
  [
    "two, header pin",
    buildInstructions(directoryOf(2), { pin: { name: "Product Engineering 2", slug: "product-engineering-2" } }),
  ],
  ["five", buildInstructions(directoryOf(5))],
  ["forty", buildInstructions(directoryOf(40))],
];

describe("the briefing fits the prefix the model is handed", () => {
  // ⚠ WRITTEN IS DELIVERED, and the LENGTH is the whole of that claim: the CLI
  // hands the model the first `INSTRUCTIONS_MAX_CHARS` characters and drops the
  // rest, so a shape within the cut is a shape delivered whole. The defect this
  // file closes was a block whose last 15,017 characters were written, served
  // and truncated away unread.
  // ⚠ A `text.slice(0, MAX) === text` case STOOD HERE AND IS DELETED
  // (2026-09-02): it is the identity `text.length <= MAX` restated, so it could
  // only ever fail alongside the loop below and never instead of it. A second
  // spelling of one assertion reads as a second guarantee.
  for (const [shape, text] of SHAPES) {
    it(`${shape}: ${text.length} chars`, () => {
      expect(text.length, `${shape} is ${text.length} chars`).toBeLessThanOrEqual(
        INSTRUCTIONS_MAX_CHARS,
      );
    });
  }

  it("a caller with MANY workspaces loses directory ROWS, never the contract", () => {
    // ⚠ Order is the design: the directory is variable-length DATA and sits
    // last, so an unusually long one cannot push the contract off the prefix.
    const out = buildInstructions(directoryOf(40));

    expect(out).toContain("caller: id=<your user id>");
    expect(out).toContain("WHICH TOOL (");
    expect(out).toContain('dopl_channel(op="list")');
    expect(out).toContain("WORKSPACES: You are in 40 workspaces");
    // ⚠ And the rows that did not fit are ANNOUNCED with the tool that lists
    // them — a silently short directory reads as a complete one.
    expect(out).toMatch(/…and \d+ more — `list_workspaces`/);
    expect(out).not.toContain("product-engineering-40");
  });
});

describe("what the budget buys back is still stated", () => {
  // ⚠ A cap passes on an empty string. These are the contract clauses the block
  // exists for; a shrink that drops one is a regression, not a saving.
  const OUT = buildInstructions(directoryOf(1));

  it("names the caller's identity and where to read it", () => {
    expect(OUT).toContain("`_dopl_status`");
    expect(OUT).toContain("dopl_members(op='whoami')");
  });

  it("routes every domain to its tool", () => {
    for (const tool of [
      "dopl_map",
      "dopl_search",
      "dopl_kb",
      "dopl_skill",
      "dopl_agent",
      "dopl_ontology",
      "dopl_members",
      "dopl_chats",
      "dopl_status",
      "dopl_channel",
    ]) {
      expect(OUT, `${tool} is unrouted`).toContain(tool);
    }
  });

  it("points at the doctrine instead of restating it", () => {
    expect(OUT).toContain('dopl_channel(op="help")');
    expect(OUT).toContain("dopl://doctrine/channels");
    expect(OUT).toContain('dopl_skill(op="authoring_guide")');
    expect(OUT).toContain('op="guide"');
  });

  it("states the `workspace=` targeting rule once, here", () => {
    // ⚠ The paragraph 14 tool schemas used to carry a byte-identical copy of.
    expect(buildInstructions(directoryOf(2))).toContain("`workspace=<slug_or_id>`");
  });
});

describe("the skill-authoring guide is PULLED, not pushed", () => {
  /** Three samples: the head, an interior heading, and the tail. */
  const SAMPLES = [
    SKILL_AUTHORING_GUIDE.slice(0, 120),
    SKILL_AUTHORING_GUIDE.slice(Math.floor(SKILL_AUTHORING_GUIDE.length / 2), Math.floor(SKILL_AUTHORING_GUIDE.length / 2) + 120),
    SKILL_AUTHORING_GUIDE.slice(-120),
  ];

  it("is not interpolated into the briefing (9,653 chars of it, 57% of the old block)", () => {
    for (const [shape, text] of SHAPES) {
      for (const sample of SAMPLES) {
        expect(text.includes(sample), `${shape} still carries the guide`).toBe(false);
      }
    }
  });

  it("is still returned, byte for byte, by the op the briefing names", async () => {
    // ⚠ The claim is "un-pushed", not "deleted" — drive the real registrar.
    const out = await callTool(
      registerSkillTools,
      stub({}),
      "dopl_skill",
      { op: "authoring_guide" },
    );
    expect(out).toContain(SKILL_AUTHORING_GUIDE);
  });
});
