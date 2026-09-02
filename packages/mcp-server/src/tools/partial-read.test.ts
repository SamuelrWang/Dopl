/**
 * "RETURNED NOTHING" vs "COULD NOT ASK" — two facts `dopl_map` and
 * `dopl_search` can render identically under `.catch(() => [])`.
 *
 * ⚠ Two halves that only work as a PAIR:
 *   1. A failing domain is NAMED with a short cause, and the result does not
 *      read as an empty workspace.
 *   2. The all-healthy result is BYTE-IDENTICAL to the one without any of this
 *      — no notice, no extra line, no changed spacing. A warning that also
 *      fires on the happy path teaches agents to skip it.
 */

import { describe, it, expect, vi } from "vitest";

import { registerMapTool } from "./map";
import { registerSearchTool } from "./search";
import { causeOf } from "./partial-read";
import { callTool, stub } from "./narration-fixtures";

const BASE = {
  id: "kb-1",
  slug: "notes",
  name: "Notes",
  description: null,
  visibility: "public" as const,
};

const SKILL = {
  id: "sk-1",
  slug: "ship-it",
  name: "Ship it",
  description: "Ships things.",
  whenToUse: "When shipping.",
  whenNotToUse: null,
  status: "active" as const,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  folder: null,
};

/** Every domain answering. Overrides replace one read with a rejection. */
const healthyMap = (over: Record<string, unknown> = {}) =>
  stub({
    listKbBases: vi.fn(async () => [BASE]),
    listSkills: vi.fn(async () => [SKILL]),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    ...over,
  });

const healthySearch = (over: Record<string, unknown> = {}) =>
  stub({
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => [SKILL]),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    // FOURTH group since 2026-08-28 — a new domain is a new read the stub has
    // to model, or the group renders as a failure nobody meant to test.
    listAgentTemplates: vi.fn(async () => []),
    ...over,
  });

/** What the transport actually throws on a server error. */
function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "DoplApiError",
    status,
  });
}

// ─── dopl_map ────────────────────────────────────────────────────────

describe("dopl_map names the domains it could not read", () => {
  it("a failing knowledge read is NAMED with its cause, not rendered as an empty workspace", async () => {
    const text = await callTool(
      registerMapTool,
      healthyMap({ listKbBases: vi.fn(async () => { throw apiError(500); }) }),
      "dopl_map",
      {},
    );

    expect(text).toContain("reason=partial_read");
    expect(text).toContain("Knowledge bases (`HTTP 500`)");
    expect(text).toContain("1 of 3 domains could NOT be read");
    // ⚠ The reader must not come away believing the workspace has none.
    expect(text).toContain("not absent from the workspace");
    expect(text).toContain("`ship-it`");
  });

  it("names every failing domain, and only those", async () => {
    const text = await callTool(
      registerMapTool,
      healthyMap({
        listKbBases: vi.fn(async () => { throw apiError(503); }),
        getOntology: vi.fn(async () => { throw Object.assign(new Error("x"), { name: "DoplTimeoutError" }); }),
      }),
      "dopl_map",
      {},
    );

    expect(text).toContain("2 of 3 domains could NOT be read");
    expect(text).toContain("Knowledge bases (`HTTP 503`)");
    expect(text).toContain("Ontology (`timed out`)");
    expect(text).not.toContain("Skills (`");
  });

  it("still renders the healthy sections — one dead domain does not fail the call", async () => {
    const text = await callTool(
      registerMapTool,
      healthyMap({ listSkills: vi.fn(async () => { throw apiError(500); }) }),
      "dopl_map",
      {},
    );
    expect(text).toContain("# Workspace map");
    expect(text).toContain("- `Notes` `notes`");
    expect(text).toContain("## Skills (0)");
    expect(text).toContain("Skills (`HTTP 500`)");
  });

  it("ALL-HEALTHY IS BYTE-IDENTICAL — the whole result, pinned", async () => {
    const text = await callTool(registerMapTool, healthyMap(), "dopl_map", {});

    expect(text).toBe(
      [
        "# Workspace map",
        "",
        "## Knowledge bases (1) — dopl_kb",
        "- `Notes` `notes`",
        "",
        "## Skills (1) — dopl_skill",
        "- `Ship it` `ship-it` — `When shipping.`",
        "",
        "## Ontology (0 clusters) — dopl_ontology",
        "_None._",
        "",
        '_Scope: ACTIVE items visible to you. Draft skills and team-scoped items you have no grant on are not listed, so these counts are not workspace totals; a domain that could not be read is named with reason=partial_read opening this line, so with no such notice every section above was read. Authoritative inventory across every status and visibility: dopl_members(op="access_matrix")._',
        "",
        // ⚠ STATIC routing line (`CHANNELS_ROUTING` in map.ts): not a domain,
        // costs no read, and sits BELOW the scope note because that note's
        // "every section above was read" speaks only for fanned-out domains.
        // Its presence in this byte pin stops it growing into a fetched section.
        '**Reaching a member or their agent: dopl_channel.** Channels are this workspace\'s live member-to-member and agent-to-agent messaging, and this manifest does not query them, so nothing above is a count of them. If dopl_channel is not in your tool list, load it with ToolSearch, then call dopl_channel(op="list") for the channels and DMs this account can post into.',
      ].join("\n"),
    );
    // ⚠ Said twice on purpose — the substring check fails loudly if the byte
    // pin above is ever "fixed" by pasting in whatever the code now emits.
    expect(text).not.toContain("reason=partial_read —");
  });

  it("an empty-but-healthy workspace still says nothing failed", async () => {
    const text = await callTool(
      registerMapTool,
      healthyMap({ listKbBases: vi.fn(async () => []), listSkills: vi.fn(async () => []) }),
      "dopl_map",
      {},
    );
    // ⚠ Genuinely empty must stay distinguishable from the failing case in the
    // OTHER direction too.
    expect(text).toContain("## Knowledge bases (0)");
    expect(text).not.toContain("reason=partial_read —");
  });
});

// ─── dopl_search ─────────────────────────────────────────────────────

describe("dopl_search names the groups it could not read", () => {
  it("a failing group is named instead of passing as a genuine miss", async () => {
    const text = await callTool(
      registerSearchTool,
      healthySearch({ searchKb: vi.fn(async () => { throw apiError(500); }) }),
      "dopl_search",
      { query: "ship" },
    );

    expect(text).toContain("reason=partial_read");
    expect(text).toContain("Knowledge entries (`HTTP 500`)");
    expect(text).toContain("1 of 4 groups could NOT be read");
    expect(text).toContain("not absent from the workspace");
    expect(text).toContain("## Knowledge entries");
    expect(text).toContain("`ship-it`");
  });

  it("ALL-HEALTHY IS BYTE-IDENTICAL — the whole result, pinned", async () => {
    const text = await callTool(
      registerSearchTool,
      healthySearch(),
      "dopl_search",
      { query: "ship" },
    );

    expect(text).toBe(
      [
        "# Search: `ship`",
        "",
        "## Knowledge entries",
        "_No matches._",
        "",
        "## Skills",
        "- `Ship it` `ship-it` — `When shipping.`",
        "",
        "## Ontology objects",
        "_No matches._",
        "",
        "## Agent templates",
        "_No matches._",
        "",
        '_Scope: max 8 per group, in ONE workspace — this one, with no cross-workspace fan-out. Only knowledge entries are matched on their BODIES; skills, ontology objects and agent templates on names and short metadata only, so a term living inside a SKILL.md or inside a template\'s instructions is not findable here. Drafts are excluded from Skills. Agent templates are the ones you can SEE, across both shelves. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). A group whose read failed still shows "No matches" and is named with reason=partial_read opening this line; no group here is proof of absence._',
      ].join("\n"),
    );
    expect(text).not.toContain("reason=partial_read —");
  });
});

// ─── the cause vocabulary ────────────────────────────────────────────

describe("causeOf says enough to act on and nothing about our internals", () => {
  it("maps the transport's own failures onto short phrases", () => {
    expect(causeOf(apiError(403))).toBe("HTTP 403");
    expect(causeOf(Object.assign(new Error("x"), { name: "DoplTimeoutError" }))).toBe("timed out");
    expect(causeOf(Object.assign(new Error("x"), { name: "DoplAbortError" }))).toBe("cancelled");
    expect(causeOf(Object.assign(new Error("x"), { name: "DoplNetworkError" }))).toBe("unreachable");
    expect(causeOf("nonsense")).toBe("read failed");
  });

  it("never echoes the error's message — that is where the SQL lives", async () => {
    // ⚠ A Postgres error through a 500 body carries column names, a table, a
    // statement fragment — useless to an agent, and it must not end up in a
    // result the model repeats back to a user.
    const leak = Object.assign(
      new Error('DB_ERROR: select "secret_col" from "internal_audit" — permission denied for relation internal_audit'),
      { name: "DoplApiError", status: 500 },
    );
    const text = await callTool(
      registerMapTool,
      healthyMap({ listKbBases: vi.fn(async () => { throw leak; }) }),
      "dopl_map",
      {},
    );

    expect(text).toContain("Knowledge bases (`HTTP 500`)");
    expect(text).not.toContain("internal_audit");
    expect(text).not.toContain("secret_col");
    expect(text).not.toContain("select ");
  });

  it("the notice is one line and carries its cause inside a code span", async () => {
    // ⚠ Anything spliced into our narration renders as a VALUE.
    const text = await callTool(
      registerMapTool,
      healthyMap({ listSkills: vi.fn(async () => { throw apiError(500); }) }),
      "dopl_map",
      {},
    );
    const hits = text.split("\n").filter((l) => l.includes("reason=partial_read —"));
    expect(hits).toHaveLength(1);
    expect(hits[0].startsWith("_reason=partial_read")).toBe(true);
    expect(hits[0].endsWith("_")).toBe(true);
  });
});
