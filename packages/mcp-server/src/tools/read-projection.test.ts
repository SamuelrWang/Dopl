/**
 * INVARIANT SUITE — the ontology reads that render NAMES fetch the SUMMARY, and
 * a clipped one says so.
 *
 * ⚠ Pinned on the CALL, not the output: swapping `{ view: "summary" }` back to
 * a bare `getOntology()` renders a BYTE-IDENTICAL result and passes every
 * behavioural test while restoring the payload blocker.
 *
 * ⚠ Every whole-workspace ontology read is capped by `ONTOLOGY_READ_LIMITS`,
 * but only the SUMMARY reports the cap (`truncated`) — the full snapshot has
 * always been clipped in silence. Each surface renders the admission where the
 * thing it clipped is.
 *
 * ⚠ NOT covered, deliberately: `op="get"` and `op="anchor"`. Both render
 * through `renderObject`, which reads `attributes`/`relationships`/`template`/
 * `methods` off the target and scans every object's relationships for
 * "Referenced by" backlinks — they MUST keep fetching the whole graph, and
 * "optimizing" them onto the summary is the mistake this header names.
 */

import { describe, it, expect, vi } from "vitest";

import { registerOntologyTool } from "./ontology";
import { registerSearchTool } from "./search";
import { callTool, stub } from "./narration-fixtures";

/** The graph as the cheap projection returns it: names and containment only. */
const SUMMARY = {
  clusters: [
    {
      id: "c-1",
      slug: "pipeline",
      name: "Pipeline",
      purpose: "Who we are talking to.",
      columnIds: ["col-1"],
    },
  ],
  objects: {
    "col-1": { id: "col-1", name: "Lead", subtitle: "", childIds: ["o-1"] },
    "o-1": { id: "o-1", name: "Acme lead", subtitle: "warm intro", childIds: [] },
  },
};

/**
 * ⚠ The SAME graph as a full snapshot with JSONB attached — if a render ever
 * starts reading a heavy field, its two results diverge and it stops being safe
 * to feed the summary.
 */
const HEAVY = {
  clusters: [{ ...SUMMARY.clusters[0], layout: { "col-1": { x: 10, y: 20 } } }],
  objects: {
    "col-1": {
      ...SUMMARY.objects["col-1"],
      attributes: [],
      methods: [],
      template: [{ key: "k", label: "Owner", kind: "text" }],
      relationships: [],
    },
    "o-1": {
      ...SUMMARY.objects["o-1"],
      attributes: [
        { key: "k", label: "Notes", value: { kind: "text", value: "x".repeat(4000) } },
      ],
      methods: [{ name: "Email", description: "d", outcome: "o", tools: "Gmail" }],
      template: [],
      relationships: [{ label: "owned by", targetIds: ["col-1"] }],
      updatedAt: "2026-01-01T00:00:00Z",
    },
  },
};

const ontologyStub = (over: Record<string, unknown> = {}) =>
  stub({ getOntology: vi.fn(async () => SUMMARY), ...over });

const searchStub = (over: Record<string, unknown> = {}) =>
  stub({
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    getOntology: vi.fn(async () => SUMMARY),
    ...over,
  });

/** The `view` argument each call site passed, in call order. */
function viewArgs(client: unknown): unknown[] {
  return vi
    .mocked((client as { getOntology: (o?: unknown) => unknown }).getOntology)
    .mock.calls.map((c) => c[0]);
}

// ─── 1. The call each name-only read makes ───────────────────────────

describe("the name-only ontology reads ask for the cheap projection", () => {
  it('dopl_ontology(op="map") calls getOntology with { view: "summary" }', async () => {
    const c = ontologyStub();
    await callTool(registerOntologyTool, c, "dopl_ontology", { op: "map" });
    expect(viewArgs(c)).toEqual([{ view: "summary" }]);
  });

  it('dopl_ontology(op="resolve") calls getOntology with { view: "summary" }', async () => {
    const c = ontologyStub();
    await callTool(registerOntologyTool, c, "dopl_ontology", {
      op: "resolve",
      query: "acme",
    });
    expect(viewArgs(c)).toEqual([{ view: "summary" }]);
  });

  it('dopl_ontology_admin calls getOntology with { view: "summary" }', async () => {
    // Unreachable in production (every `_admin` op is refused before the
    // handler runs), so this pins the resolvers' honesty, not a payload saving.
    const c = ontologyStub({ deleteOntologyCluster: vi.fn(async () => undefined) });
    await callTool(registerOntologyTool, c, "dopl_ontology_admin", {
      op: "delete_cluster",
      cluster: "pipeline",
    });
    expect(viewArgs(c)).toEqual([{ view: "summary" }]);
  });

  it('dopl_search calls getOntology with { view: "summary" }', async () => {
    const c = searchStub();
    await callTool(registerSearchTool, c, "dopl_search", { query: "acme" });
    expect(viewArgs(c)).toEqual([{ view: "summary" }]);
  });
});

// ─── 2. The detail path is NOT on the summary ────────────────────────

describe("the detail reads still fetch the whole graph", () => {
  it('op="get" asks for no projection — renderObject reads the JSONB', async () => {
    const c = ontologyStub({ getOntology: vi.fn(async () => HEAVY) });
    const text = await callTool(registerOntologyTool, c, "dopl_ontology", {
      op: "get",
      object: "o-1",
    });
    expect(viewArgs(c)).toEqual([undefined]);
    expect(text).toContain("## Actions");
    expect(text).toContain("## Relationships");
  });

  it('op="anchor" asks for no projection — same renderer, same reason', async () => {
    const c = ontologyStub({
      getOntology: vi.fn(async () => HEAVY),
      getOntologyAnchor: vi.fn(async () => HEAVY.objects["o-1"]),
    });
    await callTool(registerOntologyTool, c, "dopl_ontology", { op: "anchor" });
    expect(viewArgs(c)).toEqual([undefined]);
  });
});

// ─── 3. Names only: the heavy fields change nothing ──────────────────

describe("the switched renders read names and containment only", () => {
  it('op="map" renders identically from a summary and a full snapshot', async () => {
    const lean = await callTool(registerOntologyTool, ontologyStub(), "dopl_ontology", {
      op: "map",
    });
    const fat = await callTool(
      registerOntologyTool,
      ontologyStub({ getOntology: vi.fn(async () => HEAVY) }),
      "dopl_ontology",
      { op: "map" },
    );
    expect(fat).toBe(lean);
    expect(lean).toContain("`Lead`");
    expect(lean).toContain("`Acme lead`");
  });

  it('op="resolve" renders identically from a summary and a full snapshot', async () => {
    const args = { op: "resolve", query: "acme" };
    const lean = await callTool(registerOntologyTool, ontologyStub(), "dopl_ontology", args);
    const fat = await callTool(
      registerOntologyTool,
      ontologyStub({ getOntology: vi.fn(async () => HEAVY) }),
      "dopl_ontology",
      args,
    );
    expect(fat).toBe(lean);
    expect(lean).toContain("(`Lead` · id: `o-1`)");
  });

  it("dopl_search renders identically from a summary and a full snapshot", async () => {
    const args = { query: "acme" };
    const lean = await callTool(registerSearchTool, searchStub(), "dopl_search", args);
    const fat = await callTool(
      registerSearchTool,
      searchStub({ getOntology: vi.fn(async () => HEAVY) }),
      "dopl_search",
      args,
    );
    expect(fat).toBe(lean);
    expect(lean).toContain("(`Lead` · id: `o-1`)");
  });
});

// ─── 4. A clipped read says so, on every surface that can see it ─────

const clipped = (over: Record<string, unknown> = {}) => ({
  getOntology: vi.fn(async () => ({ ...SUMMARY, truncated: true })),
  ...over,
});

describe("a clipped ontology read is reported, not absorbed", () => {
  it("says nothing extra on the healthy path — a warning that always fires is skipped", async () => {
    const map = await callTool(registerOntologyTool, ontologyStub(), "dopl_ontology", {
      op: "map",
    });
    const resolve = await callTool(registerOntologyTool, ontologyStub(), "dopl_ontology", {
      op: "resolve",
      query: "acme",
    });
    const miss = await callTool(registerOntologyTool, ontologyStub(), "dopl_ontology", {
      op: "resolve",
      query: "nothing-matches-this",
    });
    const search = await callTool(registerSearchTool, searchStub(), "dopl_search", {
      query: "acme",
    });
    for (const text of [map, resolve, miss, search]) expect(text).not.toContain("CLIPPED");
  });

  it('op="map" names the clip beside the clusters it clipped', async () => {
    const text = await callTool(
      registerOntologyTool,
      stub(clipped()),
      "dopl_ontology",
      { op: "map" },
    );
    expect(text).toContain("CLIPPED");
    // ⚠ Still renders what it DID get — a clip is not an error.
    expect(text).toContain("`Lead`");
  });

  it('op="map" does not call an unestablished empty graph empty', async () => {
    const text = await callTool(
      registerOntologyTool,
      stub({ getOntology: vi.fn(async () => ({ clusters: [], objects: {}, truncated: true })) }),
      "dopl_ontology",
      { op: "map" },
    );
    expect(text).toContain("CLIPPED");
    expect(text).not.toContain("the graph is empty");
  });

  it('op="resolve" marks a clipped MISS — the false negative that reads as a fact', async () => {
    const text = await callTool(
      registerOntologyTool,
      stub(clipped()),
      "dopl_ontology",
      { op: "resolve", query: "nothing-matches-this" },
    );
    expect(text).toContain("CLIPPED");
    expect(text).toContain("No object's name or subtitle contains");
  });

  it('op="resolve" keeps the clip distinct from its own 20-match cap', async () => {
    const text = await callTool(
      registerOntologyTool,
      stub(clipped()),
      "dopl_ontology",
      { op: "resolve", query: "acme" },
    );
    // ⚠ Cap notice absent, clip notice present — "narrow the query" is the
    // wrong instruction for rows no query returns.
    expect(text).toContain("CLIPPED");
    expect(text).not.toContain("Showing");
  });

  it("dopl_search marks the clip on the ontology group it qualifies", async () => {
    const text = await callTool(
      registerSearchTool,
      searchStub(clipped()),
      "dopl_search",
      { query: "no-such-object" },
    );
    expect(text).toContain("CLIPPED");
    // ⚠ The clip is what makes the miss readable as "not searched" rather than
    // "not there".
    expect(text).toContain("## Ontology objects");
  });

  it("dopl_ontology_admin reports a cascade count it could not complete", async () => {
    const text = await callTool(
      registerOntologyTool,
      stub(clipped({ deleteOntologyCluster: vi.fn(async () => undefined) })),
      "dopl_ontology_admin",
      { op: "delete_cluster", cluster: "pipeline" },
    );
    expect(text).toContain("CLIPPED");
    expect(text).toContain("a floor, not the cascade");
  });
});
