/**
 * "RETURNED NOTHING" vs "COULD NOT ASK" — the two facts `dopl_map` and
 * `dopl_search` used to render identically.
 *
 * Both tools fan out across every domain and caught each read with
 * `.catch(() => [])`. A knowledge service returning 500 therefore produced
 * `## Knowledge bases (0)` / `_None._`, and an agent reported the workspace as
 * empty. Two agents drew exactly that conclusion off this surface.
 *
 * The two halves this suite pins, and they only work as a pair:
 *   1. A failing domain is NAMED, with a short cause, and the result does not
 *      read as an empty workspace.
 *   2. The all-healthy result is BYTE-IDENTICAL to the one without any of this
 *      — no notice, no extra line, no changed spacing. A warning that also
 *      fires on the happy path teaches agents to skip it, which is how the
 *      original silence got installed.
 *
 * Driven through the real registrars with the shared harness; the @dopl/client
 * is hand-stubbed and nothing transports.
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
    listClusters: vi.fn(async () => ({ clusters: [] })),
    listWorkflows: vi.fn(async () => ({ workflows: [] })),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    ...over,
  });

const healthySearch = (over: Record<string, unknown> = {}) =>
  stub({
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => [SKILL]),
    listWorkflows: vi.fn(async () => ({ workflows: [] })),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
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

    expect(text).toContain("PARTIAL READ");
    expect(text).toContain("Knowledge bases (`HTTP 500`)");
    expect(text).toContain("1 of 5 domains could NOT be read");
    // The claim that matters: the reader must not come away believing the
    // workspace has no knowledge bases.
    expect(text).toContain("not absent from the workspace");
    // And the sections that DID answer are untouched.
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

    expect(text).toContain("2 of 5 domains could NOT be read");
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
        "## Workflows (0) — dopl_workflow",
        "_None._",
        "",
        "## Ontology (0 clusters) — dopl_ontology",
        "_None._",
        "",
        '_Scope: ACTIVE items visible to you. Draft skills, trashed items, and team-scoped items you have no grant on are not listed, so these counts are not workspace totals; a domain that could not be read is named in a PARTIAL READ notice opening this line, so with no such notice every section above was read. Authoritative inventory across every status and visibility: dopl_members(op="access_matrix")._',
      ].join("\n"),
    );
    // Said twice on purpose: the substring check is what fails loudly if the
    // pin above is ever "fixed" by pasting in whatever the code now emits.
    expect(text).not.toContain("PARTIAL READ —");
  });

  it("an empty-but-healthy workspace still says nothing failed", async () => {
    const text = await callTool(
      registerMapTool,
      healthyMap({ listKbBases: vi.fn(async () => []), listSkills: vi.fn(async () => []) }),
      "dopl_map",
      {},
    );
    // Genuinely empty is a legitimate answer and must stay distinguishable
    // from the failing case in the OTHER direction too.
    expect(text).toContain("## Knowledge bases (0)");
    expect(text).not.toContain("PARTIAL READ —");
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

    expect(text).toContain("PARTIAL READ");
    expect(text).toContain("Knowledge entries (`HTTP 500`)");
    expect(text).toContain("1 of 4 groups could NOT be read");
    expect(text).toContain("not absent from the workspace");
    // The group still renders, and the hits from the healthy groups survive.
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
        "## Workflows",
        "_No matches._",
        "",
        "## Ontology objects",
        "_No matches._",
        "",
        '_Scope: max 8 per group. Only knowledge entries are matched on their BODIES; skills, workflows and ontology objects on names and trigger metadata only, so a term living inside a SKILL.md or a workflow step is not findable here. Drafts are excluded from Skills. The CHAT ARCHIVE is not searched at all (dopl_chats(op="list", query=...)). A group whose read failed still shows "No matches" and is named in a PARTIAL READ notice opening this line; no group here is proof of absence._',
      ].join("\n"),
    );
    expect(text).not.toContain("PARTIAL READ —");
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
    // A Postgres error surfaced through a 500 body: column names, a table, a
    // fragment of the statement. An agent cannot use any of it, and it must not
    // end up in a result the model will repeat back to a user.
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
    // Same rule the rest of this surface obeys: anything spliced into our
    // narration renders as a value, and nothing in it can open structure.
    const text = await callTool(
      registerMapTool,
      healthyMap({ listSkills: vi.fn(async () => { throw apiError(500); }) }),
      "dopl_map",
      {},
    );
    const hits = text.split("\n").filter((l) => l.includes("PARTIAL READ"));
    expect(hits).toHaveLength(1);
    expect(hits[0].startsWith("_PARTIAL READ")).toBe(true);
    expect(hits[0].endsWith("_")).toBe(true);
  });
});
