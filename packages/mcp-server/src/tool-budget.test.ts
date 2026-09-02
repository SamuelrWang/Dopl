/**
 * THE SERVED BUDGET FOR THIS SURFACE — the gate that stops the prose growing
 * back (T82 / T10, 2026-09-02; the schema, instructions and doctrine ratchets
 * are A2 of the MCP v2 wave).
 *
 * ⚠ WHY IT IS A TEST AND NOT A CONVENTION. Every sentence that made this
 * surface expensive was an HONEST one: a rule somebody had been bitten by,
 * written down where the next agent would read it. Nothing about "keep it
 * short" survives that pressure, because each individual addition is
 * defensible. A number does.
 *
 * ⚠ FOUR QUANTITIES, AND THE FOURTH IS PAID DIFFERENTLY FROM THE OTHER THREE.
 *   1. each tool's DESCRIPTION,
 *   2. each tool's INPUT SCHEMA, as `JSON.stringify(inputSchema).length` — the
 *      LARGER half of a connection today (53,581 against 24,526), and the half
 *      that had no gate at all until this file grew one,
 *   3. the `instructions` briefing, written once at handshake.
 *   Those three are PUSHED: every connected client pays for all of it on every
 *   connection, including the sessions that never call the tool in question.
 *   {@link SERVED_TOTAL_CEILING} is their sum and is the headline number.
 *   4. the DOCTRINE is PULLED, and carries its own SEPARATE ceiling for exactly
 *      that reason. Without a second budget every future description cut could
 *      be laundered into an unbounded pulled document and the pushed numbers
 *      would keep improving while nothing got simpler. Doctrine is EXPECTED to
 *      grow as prose leaves `.describe()`; the ratchet makes that growth a
 *      decision recorded here rather than a silent transfer.
 *
 * The per-call WRITE-RESULT cap is a different cost with a different payer and
 * lives in `write-result-budget.test.ts`.
 *
 * ⚠ MEASURED AS **SERVED**, THROUGH A REAL `Client.listTools()` /
 * `listResources()` over a real transport — not by reading the constants. The
 * registrar injects a `workspace` argument into every domain tool's schema and
 * the SDK renders the JSON Schema, so a description measured at its source is
 * not the string an agent receives. Same boot shape as `strict-args.test.ts`,
 * for the same reason.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer, buildInstructions } from "./server.js";
import { DESCRIPTION_MAX_CHARS } from "./tools/channel-description.js";

/**
 * ⚠ A CEILING THAT ONLY EVER MOVES DOWN — AND ALL FOUR OF ITS HALVES. Only the
 * first is a budget; the other three are what keep it one.
 *
 *   • OVER    — it grew past its ceiling. The regression this file is for.
 *   • STALE   — it shrank below its ceiling, so the ceiling can be lowered.
 *     ⚠ The description half of this **asserted nothing until 2026-09-02**: it
 *     read `len <= Math.min(ceiling, DESCRIPTION_MAX_CHARS)`, and since every
 *     ceiling here is ABOVE the cap the `Math.min` collapsed to the cap, which
 *     re-asks the OVER question. Every shrink in between — the whole range the
 *     half exists to police — passed silently. It caught two real shrinks the
 *     hour it was repaired.
 *   • DEAD    — a ceiling for a name nothing serves any more. Wave A deletes
 *     five tools; without this their entries outlive them and become headroom
 *     for whatever is added next.
 *   • MISSING — a name served with no ceiling declared. Without it a NEW tool
 *     joins the surface unbudgeted, which is how a per-item gate stops bounding
 *     the total. `cap` opts a family out of this half: descriptions have a
 *     shared cap, so only the over-cap ones declare a ceiling of their own.
 */
interface RatchetReport {
  over: string[];
  stale: string[];
  dead: string[];
  missing: string[];
}

function ratchet(
  measured: ReadonlyMap<string, number>,
  ceilings: Readonly<Record<string, number | undefined>>,
  cap?: number,
): RatchetReport {
  const report: RatchetReport = { over: [], stale: [], dead: [], missing: [] };
  for (const [name, size] of measured) {
    const ceiling = ceilings[name] ?? cap;
    if (ceiling === undefined) {
      report.missing.push(`${name}: ${size} chars, no ceiling declared`);
    } else if (size > ceiling) {
      report.over.push(`${name}: ${size} chars (ceiling ${ceiling})`);
    }
  }
  for (const [name, ceiling] of Object.entries(ceilings)) {
    if (ceiling === undefined) continue;
    const size = measured.get(name);
    if (size === undefined) {
      report.dead.push(`${name}: ceiling ${ceiling}, nothing serves it`);
    } else if (size < ceiling) {
      report.stale.push(`${name}: ${size} chars, ceiling ${ceiling}`);
    }
  }
  return report;
}

/** Asserts all four halves, so no ratchet in this file can ship with three. */
function expectRatchet(
  what: string,
  report: RatchetReport,
  grew: string,
  shrank = "lower the ceiling to the measured size in the same commit — that is how the win gets banked",
): void {
  const list = (rows: string[]) => `\n- ${rows.join("\n- ")}`;
  expect(report.over, `${what} grew past its ceiling. ${grew}:${list(report.over)}`).toEqual([]);
  expect(report.stale, `${what} shrank below its ceiling — ${shrank}:${list(report.stale)}`).toEqual([]);
  expect(report.dead, `${what}: a ceiling holding up nothing — delete the entry:${list(report.dead)}`).toEqual([]);
  expect(report.missing, `${what}: served with no ceiling — measure it and declare one, never leave it unbudgeted:${list(report.missing)}`).toEqual([]);
}

/**
 * ⚠ THE DESCRIPTION RATCHET, AND IT IS NOT AN EXEMPTION LIST. Seven
 * descriptions do not fit {@link DESCRIPTION_MAX_CHARS} today, and each is at
 * its smallest HONEST size: a headline, one line per op, the tenancy wording
 * the P3 tier owns (`p3/mcp-tenancy-naming`), and the security / preview
 * sentences `tool-scope-claims.test.ts` pins by phrase.
 * Getting one under the cap means deleting one of those, which is a DECISION
 * somebody takes rather than a trim. Measured 2026-09-02; re-derive with this
 * suite rather than trusting the numbers. ⚠ ADDING A NAME HERE IS NOT A FIX —
 * it is how a budget stops being a budget. When one falls to the cap, DELETE
 * the entry instead of lowering it, so the cap enforces itself.
 *
 * ── ⚠ THE ONE TIME A CEILING WENT UP, AND WHAT IT COST TO SAY SO ────────────
 *
 * **2026-09-02, the integration of the orchestrator-surface and tenancy tiers:
 * three of these rose, and the other two tools that broke the cap did NOT get
 * an entry.** The rule that separated them is the four-things rule in
 * `channel-description.ts`: a description may carry what the tool is, the
 * SECURITY sentence, the OPS named and glossed, and the arguments that are not
 * self-describing from their own `.describe()`.
 *
 *   • `current_workspace` and `dopl_status` grew on prose that RESTATED their
 *     own schema descriptions — the `since` cursor, which of "set"/"clear" does
 *     what, that a home-channel container is a legal target. A description and
 *     its arg descriptions are BOTH pushed on every connection, so that is the
 *     same fact paid for twice. Both were trimmed and both now fit 1,200 with
 *     no entry added here.
 *   • `dopl_kb`, `dopl_agent` and `dopl_channel` grew on NEW OPS. An op a model
 *     never sees is an op it cannot pick, and `parity.test.ts` requires every
 *     enum op to appear as a quoted `"op_name"` with a bullet
 *     `tool-scope-claims.test.ts` then reads. That content cannot leave, so the
 *     ceilings moved to the measured post-trim size — and the trim came first:
 *     `dopl_kb` 3,557 → 3,400 and `dopl_agent` 2,632 → 2,476 by deleting the
 *     halves of the copy/pin bullets that `to_workspace` and `path` already
 *     say. `dopl_channel` had nothing duplicative to give back.
 *
 * ⚠ **A RISE IS A DECISION AND IT IS RECORDED HERE, NOT ABSORBED.** The honest
 * next move for the three is the one `dopl_channel` already made for its LAW: a
 * pulled doctrine resource per tool (`channel-doctrine.ts`, `resources.ts`), so
 * the op glosses stop being pushed to clients that never call them.
 */
const OVER_BUDGET_CEILINGS: Record<string, number> = {
  // ⚠ +383 ON 2026-09-02 for op="copy", after its bullet gave back the sentences
  // `copy-target.ts › TO_WORKSPACE_ARG_DESCRIPTION` already carries.
  // ⚠ 2,476 → 2,467 ON 2026-09-02: A8 took the TEAM AXIS off the `list` bullet
  // and out of the `visibility` arg (which is a THIRD enum arm gone from the
  // schema too, and that is not counted here). The filter disclosure stayed.
  // ⚠ 2,467 → 2,446 ON 2026-09-02 (A3): the closing line stopped routing to
  // `dopl_agent_admin`, a tool that no longer exists, and states the rule.
  dopl_agent: 2446,
  // ⚠ 1,197 OF THIS IS THE P1 SUMMARY AND THE REST IS **ONE PARAGRAPH THE P3
  // TENANCY TIER ASKED TO KEEP WORD FOR WORD** — `channel-description.ts ›
  // HOME_CHANNEL_ADDRESSING`, ~650 chars on how a home channel is addressed,
  // discovered and tenanted. Each of its three facts was a measured misread in
  // the orchestration run this work came out of. It is interpolated by
  // REFERENCE precisely so it stays a decision somebody takes rather than a
  // sentence whoever is counting characters trims. Was 34,904.
  // ⚠ +116 ON 2026-09-02: three op NAMES in the ops line — "set_agent_mode",
  // "ping", "pings" — with two five-word glosses. Nothing here duplicated
  // anything, so nothing was traded for them.
  // ⚠ 1,781 → 1,775 ON 2026-09-02: the `seq` sentence said "workspace-global"
  // where `design/status.ts` and INVARIANTS §5 (F-412) say TABLE-WIDE, and the
  // correct word is six characters shorter. Caught by the STALE half, which is
  // what that half is for.
  dopl_channel: 1775,
  // ⚠ +931 ON 2026-09-02 for three new ops — "copy_base", "pin", "unpin" — after
  // the copy/pin bullets gave back what `to_workspace` and `path` already say.
  // ⚠ 3,400 → 3,399 ON 2026-09-02: R2 reworded the `copy_base` bullet from "a
  // base you can READ" to "a base YOU CREATED", one character shorter.
  // ⚠ 3,399 → 3,387 ON 2026-09-02: A8 took the TEAM AXIS off the `list_bases`
  // bullet. The FILTER is still disclosed ("no grant on", pinned by
  // `tool-scope-claims.test.ts`) — what left is the dead axis naming it.
  // ⚠ 3,387 → 3,371 ON 2026-09-02 (A3): the closing line stopped routing to
  // `dopl_kb_admin` — a tool that no longer exists — and says the rule instead.
  dopl_kb: 3371,
  dopl_chats: 1654,
  dopl_members: 1535,
  // ⚠ UNCHANGED BY A3 (2026-09-02): its closing sentence stopped naming
  // `dopl_ontology_admin` and states the rule instead, at exactly the same
  // length. The win of that slice is the five tools, not this line.
  dopl_ontology: 2321,
  dopl_skill: 1586,
};

/**
 * ⚠ THE BIGGER HALF OF THE CONNECTION, AND IT HAD NO GATE UNTIL NOW — 53,581
 * chars of input schema against 24,526 of description, measured 2026-09-02.
 * That asymmetry is not an accident: `.describe()` is where doctrine goes when
 * a description gets audited, and nothing was counting it.
 *
 * ⚠ EVERY SERVED TOOL DECLARES ONE. There is no shared cap to fall back on and
 * no honest one to invent — a 24-op tool and a one-arg tool have nothing in
 * common — so the ratchet's MISSING half refuses a tool that declares none,
 * which is what stops a NEW tool joining the surface unbudgeted.
 *
 * ⚠ `dopl_channel` IS 41% OF THE WHOLE SERVED SURFACE ON ITS OWN (21,778 of
 * 53,581) — 24 ops and 37 params, most of the weight in `.describe()` prose
 * that is doctrine wearing a schema. A6 moves it; this number is what proves it
 * moved rather than being redistributed.
 */
const SCHEMA_CEILINGS: Record<string, number> = {
  current_workspace: 704,
  dopl_agent: 4598,
  dopl_agent_admin: 1096,
  dopl_channel: 21778,
  dopl_chats: 4147,
  dopl_chats_admin: 1165,
  dopl_home: 457,
  dopl_kb: 5432,
  dopl_kb_admin: 1223,
  dopl_map: 879,
  dopl_members: 1232,
  dopl_ontology: 3166,
  dopl_ontology_admin: 1162,
  dopl_search: 1430,
  dopl_skill: 3428,
  dopl_skill_admin: 1062,
  dopl_status: 508,
  list_workspaces: 114,
};

/**
 * ⚠ WHAT AN EXTERNAL CONNECTION COSTS BEFORE IT HAS DONE ANYTHING: every
 * description + every input schema + the `instructions` briefing, measured
 * 2026-09-02 at **95,174 chars / ~23.8k tokens**. Doctrine is NOT in it — that
 * is pulled, and {@link DOCTRINE_CEILING} is its separate ratchet.
 *
 * ⚠ IT IS NOT ARITHMETIC OVER THE ROWS ABOVE, AND THAT IS THE POINT. The
 * per-tool ceilings bound each tool; this bounds the SURFACE, so adding tools
 * cannot pay for itself by staying under every individual ceiling. Keeping it
 * true also forces the headline number to be re-measured on every slice that
 * claims a win.
 */
const SERVED_TOTAL_CEILING = 95_174;

/**
 * ⚠ THE BRIEFING IS WRITTEN ONCE AND PUSHED ONCE, AND IT IS 17,067 CHARS — 18%
 * of the connection, larger than every description put together bar three.
 * A1's target is 2,048. ⚠ WHAT THIS CEILING DOES NOT SEE: whether the CLIENT
 * keeps all of it. Nothing in this tree truncates the briefing (F-423), so
 * "written" and "delivered" are the same number at every layer we own; a cut
 * inside a consuming runtime is not observable from here and must not be
 * asserted here.
 */
const INSTRUCTIONS_CEILING = 17_067;

/**
 * ⚠ THE PULLED SIDE, AND IT IS BUDGETED SEPARATELY ON PURPOSE (principle 7).
 * The sum of every resource this server publishes — one today,
 * `dopl://doctrine/channels` at 28,870 chars. ⚠ THIS CEILING IS EXPECTED TO
 * RISE during Wave A, and a rise here is only legitimate when the pushed side
 * falls further: A6 moves ~14,000 chars out of `.describe()` and ~3,000 of it
 * lands in the doctrine. A rise with no matching fall in
 * {@link SERVED_TOTAL_CEILING} is prose laundering and this is the gate for it.
 */
const DOCTRINE_CEILING = 28_870;

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

/** Enough of the client for registration. ⚠ No handler runs on this path. */
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

let client: Client;
let listed: Awaited<ReturnType<Client["listTools"]>>;
let descriptions: Map<string, number>;
let schemas: Map<string, number>;
let instructions: string;
/** Every published resource's body, by URI. Doctrine is the only one today. */
let doctrine: Map<string, number>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "budget-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  listed = await client.listTools();
  descriptions = new Map(listed.tools.map((t) => [t.name, (t.description ?? "").length]));
  schemas = new Map(listed.tools.map((t) => [t.name, JSON.stringify(t.inputSchema).length]));
  instructions = client.getInstructions() ?? "";
  const published = await client.listResources();
  doctrine = new Map(
    await Promise.all(
      published.resources.map(async ({ uri }): Promise<[string, number]> => {
        const read = await client.readResource({ uri });
        // ⚠ A resource may answer text OR a blob; only text costs an agent
        // tokens, and a blob must not be silently counted as zero either — the
        // doctrine is markdown and a blob here would be a different bug.
        const body = read.contents
          .map((c) => ("text" in c ? c.text : ""))
          .join("");
        return [uri, body.length];
      }),
    ),
  );
});

afterAll(async () => {
  await client?.close();
});

/** Every measured char an external client is pushed on connection. */
function servedTotal(): number {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return sum(descriptions) + sum(schemas) + instructions.length;
}

describe("the pushed surface fits its budget, as served", () => {
  it("registers the tools at all (a scan over nothing is not a guard)", () => {
    expect(listed.tools.length).toBeGreaterThan(5);
    expect(listed.tools.map((t) => t.name)).toContain("dopl_channel");
  });

  it(`no description exceeds ${DESCRIPTION_MAX_CHARS} chars, except the ratcheted ${Object.keys(OVER_BUDGET_CEILINGS).length}`, () => {
    expectRatchet(
      "a tool description",
      ratchet(descriptions, OVER_BUDGET_CEILINGS, DESCRIPTION_MAX_CHARS),
      "move standing doctrine into an MCP resource (see channel-doctrine.ts) rather than raising the number",
      `lower the ceiling to the measured size, or (at or under ${DESCRIPTION_MAX_CHARS}) delete the entry so the cap enforces itself`,
    );
  });

  it("every input schema is ratcheted, and every served tool declares one", () => {
    // ⚠ THE BIGGER HALF, AND IT HAD NO GATE. 53,581 chars against 24,526 of
    // description — because `.describe()` is where doctrine goes when a
    // description gets audited, and nothing was counting it.
    expectRatchet(
      "a tool input schema",
      ratchet(schemas, SCHEMA_CEILINGS),
      "delete an op or a param, or move its `.describe()` prose into the doctrine — a schema is pushed to every client on every connection",
    );
  });

  it("the whole connection is bounded, so a new tool cannot arrive for free", () => {
    expectRatchet(
      "the served surface (descriptions + input schemas + instructions)",
      ratchet(new Map([["served per connection", servedTotal()]]), {
        "served per connection": SERVED_TOTAL_CEILING,
      }),
      "the per-tool ceilings above bound each tool; this bounds the surface",
    );
  });

  it("the `instructions` briefing is bounded, and is delivered exactly as written", () => {
    expectRatchet(
      "the instructions briefing",
      ratchet(new Map([["instructions", instructions.length]]), {
        instructions: INSTRUCTIONS_CEILING,
      }),
      "it is pushed once per connection whether or not the agent needs any of it",
    );
    // ⚠ WRITTEN == DELIVERED, at the one layer this repo owns. The handshake
    // carries the briefing whole, so a shrink at the source is a shrink on the
    // wire and this file may measure either. `workspaceSource` is not a header
    // pin above, so the boot passes `pin: null`.
    expect(instructions).toBe(
      buildInstructions([WS], { pin: null, directoryLoadFailed: false }),
    );
  });

  it("`dopl_channel` POINTS at the doctrine instead of carrying it", () => {
    // ⚠ THE HEADLINE MEASUREMENT OF THIS TIER. It was 34,904 chars — half the
    // whole surface — because it carried the law, the model, the await protocol
    // and a paragraph per op. Those are the `dopl://doctrine/channels` resource
    // now, pulled on demand, and this is the assertion that keeps them there.
    const description = listed.tools.find((t) => t.name === "dopl_channel")?.description ?? "";
    expect(description).toContain('op="help"');
    expect(description).toContain("dopl://doctrine/channels");
    // ⚠ THE LAW IS NOT INLINED ANY MORE. This is the assertion that stops 35k of
    // prose growing back one honest sentence at a time.
    expect(description).not.toContain("THE LAW OF THIS ROOM");
  });
});

describe("the pulled doctrine fits its own, separate budget", () => {
  it("publishes the doctrine the pushed budget was cut against", () => {
    // ⚠ A PULLED BUDGET OVER NOTHING IS THE FAILURE MODE, NOT THE GOAL. If the
    // resource stopped being served, every ratchet below would read 0 and go
    // green while the doctrine reached no agent at all.
    expect([...doctrine.keys()]).toContain("dopl://doctrine/channels");
  });

  it("is ratcheted per resource and in total", () => {
    const total = [...doctrine.values()].reduce((a, b) => a + b, 0);
    expectRatchet(
      "the pulled doctrine",
      ratchet(new Map([["all resources", total]]), { "all resources": DOCTRINE_CEILING }),
      "a rise is only legitimate against a LARGER fall in the pushed surface — record the trade here or it is prose laundering",
    );
  });
});
