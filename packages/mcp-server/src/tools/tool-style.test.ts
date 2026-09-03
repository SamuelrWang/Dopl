/**
 * THE HOUSE STYLE, ENFORCED — ⚠ the mechanically checkable half of
 * `docs/MCP-TOOL-DESCRIPTION-CHECKLIST.md`, run against the surface **AS
 * SERVED**.
 *
 * ⚠ WHY AS SERVED, THROUGH A REAL `listTools()`. The registrar injects a
 * `workspace` argument into every domain tool's schema and the SDK renders the
 * JSON Schema, so a description or a bound measured at its source is not what
 * an agent receives. Same boot shape as `tool-budget.test.ts`, for the same
 * reason.
 *
 * ⚠ AND WHY A TEST AND NOT A REVIEW. Every rule here is one an author agrees
 * with in the abstract and breaks in the particular, because each individual
 * breach is defensible: one more routing line, one number typed into a
 * `.describe()` where the reader will see it, one description that runs long
 * because the tool genuinely does more. `tool-budget.test.ts`'s header makes
 * this argument about SIZE; this file makes it about SHAPE, which is the half
 * that decides whether an agent can skim at all.
 *
 * ⚠ WHAT THIS FILE DOES NOT ASSERT: whether a sentence is TRUE.
 * `tool-scope-claims.test.ts` owns the completeness claims and
 * `parity.test.ts` owns op coverage. A green run here means the shape holds,
 * never that the prose is right.
 */

import { describe, it, expect, vi, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "../server.js";
import {
  EXAMPLES_MAX_CHARS,
  HARD_DESCRIPTION_CEILING,
  HEADLINE_MAX_CHARS,
  ROUTING_MAX_LINES,
} from "./tool-style.js";
import * as ERRORS from "./tool-errors.js";
import { FENCE_DESCRIPTION_NOTE } from "./untrusted-fence.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

interface Served {
  name: string;
  description: string;
  schema: {
    properties?: Record<string, Record<string, unknown>>;
  };
}

/**
 * ⚠ THE BOOT IS A TOP-LEVEL `await`, NOT A `beforeAll`, AND IT HAS TO BE. Every
 * suite below generates its cases by iterating the served tools, and vitest
 * COLLECTS `describe` bodies before any hook runs — so a list assigned in
 * `beforeAll` is `undefined` at the moment the cases are built, and the file
 * fails to collect with `tools is not iterable`. A per-tool guard has to know
 * the tools at collection time.
 */
const server = createServer(stubClient(), {
  directory: [WS],
  workspace: WS,
  role: "owner",
  workspaceSource: "sole membership",
  scopes: ["dopl.read", "dopl.write"],
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "style-probe", version: "0.0.0" });
await Promise.all([
  server.connect(serverTransport),
  client.connect(clientTransport),
]);
const listed = await client.listTools();
const tools: Served[] = listed.tools.map((t) => ({
  name: t.name,
  description: t.description ?? "",
  schema: t.inputSchema as Served["schema"],
}));
/** Every tool name this server serves — the routing check's vocabulary. */
const names = new Set(tools.map((t) => t.name));

afterAll(async () => {
  await client.close();
});

/** The paragraph an author wrote, before the generated tail. */
function prose(description: string): string {
  const cut = description.search(/\n\n(?:Limits: |Errors: |e\.g\. )/);
  return cut === -1 ? description : description.slice(0, cut);
}

/** The generated tail, or "" when a tool declares none. */
function tail(description: string): string {
  return description.slice(prose(description).length);
}

describe("the surface is registered at all (a scan over nothing is not a guard)", () => {
  it("serves the tools this file measures", () => {
    // ⚠ Every suite below is GENERATED from `tools`; an empty list would make
    // all of them pass by producing no cases at all.
    expect(tools.length).toBeGreaterThan(5);
    expect(names).toContain("dopl_channel");
  });
});

// ── Q10 of the checklist: the most important sentence goes first ────────────

describe("the first 200 characters carry the tool", () => {
  for (const t of tools) {
    it(`${t.name}: the headline fits the window a truncating client guarantees`, () => {
      // ⚠ THE OPENING SENTENCE, not the opening 200 characters — the rule is
      // that the sentence a model reads before deciding is COMPLETE inside the
      // window, and a sentence that merely starts inside it is exactly the
      // failure the reference measured on Notion's and Slack's search tools.
      const first = t.description.split("\n")[0];
      const stop = first.search(/\.(\s|$)/);
      const headline = stop === -1 ? first : first.slice(0, stop + 1);
      expect(
        headline.length,
        `${t.name}'s first sentence runs ${headline.length} chars. A client that truncates cuts from the END, so everything past ${HEADLINE_MAX_CHARS} reached no model at decision time:\n${headline}`,
      ).toBeLessThanOrEqual(HEADLINE_MAX_CHARS);
      expect(headline.length, `${t.name} has no opening sentence`).toBeGreaterThan(0);
    });

    it(`${t.name}: says what it does NOT do, or is read-only, inside the first 200 chars`, () => {
      // ⚠ ONE OF TWO SHAPES, because there are two honest ways to bound a tool
      // in a sentence: naming what it excludes, or declaring the whole class
      // read-only. A tool that does neither has told the agent nothing it can
      // use to rule the tool OUT, which is the decision a description is read
      // to make.
      const window = t.description.slice(0, HEADLINE_MAX_CHARS + 60);
      const bounded =
        /\bnot\b|\bnever\b|\bNOT\b|\bonly\b|\bexcept\b|Read-only\.|\bomits\b|\bwithout\b/.test(
          window,
        );
      expect(
        bounded,
        `${t.name} opens without a boundary — neither "Read-only." nor a clause saying what it does not return:\n${window}`,
      ).toBe(true);
    });
  }
});

// ── Item 2: sibling edges, named, and pointing at something that exists ─────

describe("every tool routes to a live sibling", () => {
  for (const t of tools) {
    it(`${t.name}: carries at least one "Use <tool>" line naming a served tool`, () => {
      const used = [...t.description.matchAll(/\bUse ([a-z_]+)\b/g)].map(
        (m) => m[1],
      );
      const live = used.filter((n) => names.has(n) && n !== t.name);
      expect(
        live.length,
        `${t.name} names no sibling to call instead. A tool suite is a GRAPH — with no edges an agent picks tools by name similarity, which is how a wrong-tool call happens. Found: ${JSON.stringify(used)}; served: ${JSON.stringify([...names])}`,
      ).toBeGreaterThan(0);
    });

    it(`${t.name}: routes to at most ${ROUTING_MAX_LINES} siblings — a signpost, not a table`, () => {
      const lines = prose(t.description)
        .split(/\n+/)
        .flatMap((l) => l.split(/(?<=\.)\s+(?=Use [a-z_])/))
        .filter((l) => /^Use [a-z_]+/.test(l.trim()));
      expect(lines.length).toBeLessThanOrEqual(ROUTING_MAX_LINES);
    });
  }
});

// ── Item 6: one source for every number ────────────────────────────────────

describe("hard numbers come from the schema and appear with their consequence", () => {
  /** The bound a JSON Schema property publishes, as the renderer words it. */
  function boundPhrase(prop: Record<string, unknown>): string | null {
    const n = (k: string) => (typeof prop[k] === "number" ? (prop[k] as number) : null);
    const maxLength = n("maxLength");
    if (maxLength !== null) return `≤${maxLength} chars`;
    const min = n("minimum");
    const max = n("maximum");
    if (min !== null && max !== null) return `${min}–${max}`;
    if (max !== null) return `≤${max}`;
    if (min !== null) return `≥${min}`;
    return null;
  }

  for (const t of tools) {
    it(`${t.name}: every rendered limit matches a bound the schema actually enforces`, () => {
      const limits = /^Limits: (.+?)\. Exceeding one returns a validation error\.$/m.exec(
        t.description,
      );
      if (!limits) return; // a tool may state none; the next case guards the other way
      const published = Object.entries(t.schema.properties ?? {}).flatMap(
        ([name, prop]) => {
          const phrase = boundPhrase(prop);
          return phrase ? [`${name} ${phrase}`] : [];
        },
      );
      for (const rendered of limits[1].split(" · ")) {
        expect(
          published,
          `${t.name} advertises "${rendered}" but its published schema enforces no such bound. A description may never promise a limit the schema does not apply.`,
        ).toContain(rendered);
      }
    });

    it(`${t.name}: no .describe() hand-types a bound the schema already publishes`, () => {
      // ⚠ THE DIRECTION THAT ACTUALLY ROTS. A bound reaches the client as a
      // `maxLength` / `maximum` keyword AND, when it matters, once in the
      // rendered Limits line. A third copy inside the describe is one fact
      // pushed three times per connection — and it is the copy nobody updates
      // when the `.max()` moves.
      for (const [name, prop] of Object.entries(t.schema.properties ?? {})) {
        const bound = prop.maxLength ?? prop.maximum;
        if (typeof bound !== "number") continue;
        const described = typeof prop.description === "string" ? prop.description : "";
        expect(
          described.includes(String(bound)),
          `${t.name}.${name} types its own bound (${bound}) into its .describe(). The JSON Schema already publishes it and \`renderLimits\` states the consequence from that one source — delete the number from the prose:\n${described}`,
        ).toBe(false);
      }
    });
  }
});

// ── Item 3: named error → named remedy, matched to the errors table ────────

describe("every error code a description teaches is one the server declares", () => {
  /** Every `reason` in `tool-errors.ts`, however it is packaged. */
  const declared = new Set<string>();
  for (const value of Object.values(ERRORS)) {
    if (typeof value === "function") continue;
    for (const row of Array.isArray(value) ? value : [value]) {
      if (row && typeof row === "object" && "reason" in row) {
        declared.add((row as { reason: string }).reason);
      }
    }
  }
  // ⚠ `versionConflict` is a FACTORY (the remedy op differs per tool), so its
  // code is not reachable by walking the module's values. Named explicitly, or
  // the set would silently miss the one row three tools share.
  declared.add("version_conflict");

  for (const t of tools) {
    it(`${t.name}: its Errors block quotes only literals from tool-errors.ts`, () => {
      const block = /^Errors: (.+)$/m.exec(t.description);
      if (!block) return;
      for (const code of [...block[1].matchAll(/reason=([A-Za-z_]+)/g)].map((m) => m[1])) {
        expect(
          declared,
          `${t.name} teaches reason=${code}, which no row in tool-errors.ts declares. The whole mechanism is STRING EQUALITY between what the description promises and what a refusal renders — a code that exists only in prose is a remedy the agent can never match.`,
        ).toContain(code);
      }
    });

    it(`${t.name}: every code it teaches carries a retry`, () => {
      const block = /^Errors: (.+)$/m.exec(t.description);
      if (!block) return;
      const rows = block[1].split(" · ");
      for (const row of rows) {
        expect(
          /; retry=\S/.test(row),
          `${t.name}: "${row}" names a failure with no way out. "Do not retry with the same input" is a fact an agent otherwise infers, and infers wrong under pressure.`,
        ).toBe(true);
      }
      expect(rows.length, `${t.name} pushes more than the top three codes`).toBeLessThanOrEqual(3);
    });
  }
});

// ── Item 7: call shapes, as JSON, bounded ──────────────────────────────────

describe("call-shape examples", () => {
  for (const t of tools) {
    const examples = /^e\.g\. (.+)$/m.exec(t.description);

    it(`${t.name}: shows at least one valid JSON call shape`, () => {
      expect(
        examples,
        `${t.name} teaches its surface in prose alone. An example is the shape the agent has to PRODUCE; \`notion-get-users\` teaches its whole surface in six of them.`,
      ).not.toBeNull();
    });

    it(`${t.name}: every example parses, and the set fits ${EXAMPLES_MAX_CHARS} chars`, () => {
      if (!examples) return;
      expect(`e.g. ${examples[1]}`.length).toBeLessThanOrEqual(EXAMPLES_MAX_CHARS);
      for (const shape of examples[1].split(" · ")) {
        expect(
          () => JSON.parse(shape),
          `${t.name}: "${shape}" is not parseable JSON — an example that does not parse teaches a call that cannot be made`,
        ).not.toThrow();
      }
    });

    it(`${t.name}: an op-dispatch tool shows three, or one per op if it has fewer`, () => {
      if (!examples) return;
      const ops = t.schema.properties?.op?.enum;
      if (!Array.isArray(ops)) return;
      // ⚠ THE FLOOR IS `min(3, ops)`, NOT 3. One example teaches one op out of
      // many, so a fourteen-op tool owes three — but `dopl_home` has exactly
      // two, and demanding a third would mean inventing a call it cannot make.
      const floor = Math.min(3, ops.length);
      expect(
        examples[1].split(" · ").length,
        `${t.name} dispatches on ${ops.length} ops and shows too few call shapes`,
      ).toBeGreaterThanOrEqual(floor);
    });
  }
});

// ── Item 10: the anti-patterns, refused by name ────────────────────────────

describe("the reference's anti-patterns stay out of this surface", () => {
  it("no tool bills the caller's context for vendor telemetry", () => {
    // ⚠ HubSpot REQUIRES a `chatInsights` object — user intent plus a
    // satisfaction rating, ~250 words of instruction on anonymizing PII — on
    // every search and query call. That is product metrics collected through
    // the agent's required-parameter list. Derive analytics server-side.
    const banned = /^(chat_?insights|telemetry|analytics|user_intent|satisfaction|feedback)$/i;
    for (const t of tools) {
      for (const name of Object.keys(t.schema.properties ?? {})) {
        expect(banned.test(name), `${t.name}.${name} reads as vendor telemetry`).toBe(false);
      }
    }
  });

  it("no published schema validates a date with a regex", () => {
    // ⚠ A regex in a published schema is a rule the agent must reverse-engineer
    // from a character class, and its failure is an opaque -32602 rather than a
    // sentence. Where a shape matters, say it in the describe and let the
    // handler answer with a code.
    for (const t of tools) {
      for (const [name, prop] of Object.entries(t.schema.properties ?? {})) {
        expect(
          typeof prop.pattern === "string",
          `${t.name}.${name} publishes a regex validator (${String(prop.pattern)})`,
        ).toBe(false);
      }
    }
  });

  it(`no description crosses the ${HARD_DESCRIPTION_CEILING}-char truncation line`, () => {
    const over = tools
      .filter((t) => t.description.length > HARD_DESCRIPTION_CEILING)
      .map((t) => `${t.name}: ${t.description.length}`);
    expect(
      over,
      `past this a description is not long, it is PARTLY INVISIBLE — the reference measured four of fifteen production descriptions arriving cut off mid-sentence`,
    ).toEqual([]);
  });
});

// ── Item 9: the fence declares itself where it is used ─────────────────────

describe("a tool that fences third-party bodies says so in its description", () => {
  // ⚠ THE FENCE IS THREE LAYERS AND THE DESCRIPTION IS THE FIRST. A reader who
  // does not know the close tag is unguessable has no reason to trust it, so a
  // fence shipped without this note is a mechanism nobody can act on.
  for (const name of ["dopl_kb", "dopl_agent"]) {
    it(`${name}: states the trust class and the fence`, () => {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} is not served`).toBeDefined();
      expect(t!.description).toContain(FENCE_DESCRIPTION_NOTE);
    });
  }
});

// ── The generated tail is generated, and stays out of the prose ────────────

describe("the machine-readable tail is last and is not hand-written", () => {
  for (const t of tools) {
    it(`${t.name}: Limits / Errors / e.g. appear once each, in order, at the end`, () => {
      const t9 = tail(t.description);
      const order = ["Limits: ", "Errors: ", "e.g. "]
        .map((k) => t9.indexOf(k))
        .filter((i) => i !== -1);
      expect(
        [...order].sort((a, b) => a - b),
        `${t.name}'s tail is out of order — limits, then errors, then examples`,
      ).toEqual(order);
      for (const key of ["Limits: ", "Errors: ", "e.g. "]) {
        expect(
          t.description.split(key).length - 1,
          `${t.name} repeats "${key}"`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
