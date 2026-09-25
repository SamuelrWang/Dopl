/**
 * INVARIANT SUITE — ⚠ `dopl_map` fetches the SUMMARY, never the graph. The
 * instructions send every agent here before its first substantive reply, so it
 * is the most-executed read in the product, and a bare `getOntology()` pulls
 * every JSONB column across the wire to render ontology and column names.
 *
 * ⚠ The regression is invisible by every other means: swapping back renders a
 * BYTE-IDENTICAL result and passes every existing map test. So the assertion is
 * on the CALL, and the second test proves the tool cannot be reading the heavy
 * fields even when a client hands them over.
 */

import { describe, it, expect, vi } from "vitest";

import { registerMapFixture } from "./narration-fixtures";
import { callTool, stub } from "./narration-fixtures";

const SUMMARY = {
  ontologies: [
    {
      id: "c-1",
      slug: "playbook",
      name: "Dopl Playbook",
      purpose: "How this workspace is meant to be used.",
      columnIds: ["o-1"],
    },
  ],
  objects: {
    "o-1": { id: "o-1", name: "Surfaces", subtitle: "", childIds: [] },
  },
};

const client = (over: Record<string, unknown> = {}) =>
  stub({
    listKbBases: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    getOntology: vi.fn(async () => SUMMARY),
    ...over,
  });

describe("dopl_map asks for the cheap projection", () => {
  it('calls getOntology with { view: "summary" } — never bare', async () => {
    const c = client();
    await callTool(registerMapFixture, c, "dopl_map", {});
    const getOntology = vi.mocked(
      (c as unknown as { getOntology: (o?: unknown) => unknown }).getOntology,
    );
    expect(getOntology).toHaveBeenCalledTimes(1);
    expect(getOntology).toHaveBeenCalledWith({ view: "summary" });
  });

  it("renders names and containment only — heavy fields change nothing", async () => {
    // ⚠ Same graph as a FULL snapshot with JSONB attached — if the render ever
    // starts reading those fields the two results diverge and the tool stops
    // being safe to feed the summary.
    const heavy = {
      ontologies: [{ ...SUMMARY.ontologies[0], layout: { "o-1": { x: 40, y: 80 } } }],
      objects: {
        "o-1": {
          ...SUMMARY.objects["o-1"],
          attributes: [
            { key: "k", label: "L", value: { kind: "text", value: "x".repeat(4000) } },
          ],
          methods: [{ name: "Do", description: "d", outcome: "o", tools: "t" }],
          template: [{ key: "k", label: "L", kind: "text" }],
          relationships: [{ label: "relates to", targetIds: ["o-1"] }],
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    const lean = await callTool(registerMapFixture, client(), "dopl_map", {});
    const fat = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => heavy) }),
      "dopl_map",
      {},
    );
    expect(fat).toBe(lean);
    expect(lean).toContain("`Dopl Playbook`");
    expect(lean).toContain("(objects: `Surfaces`)");
  });
});

describe("dopl_map reports a clipped ontology read", () => {
  it("says nothing extra when the read was complete", async () => {
    // ⚠ The healthy result must stay byte-identical — a warning that also fires
    // on the happy path teaches agents to skip it.
    const text = await callTool(registerMapFixture, client(), "dopl_map", {});
    expect(text).not.toContain("CLIPPED");
  });

  it("names the clip when the server reports one", async () => {
    const text = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => ({ ...SUMMARY, truncated: true })) }),
      "dopl_map",
      {},
    );
    expect(text).toContain("CLIPPED");
    // ⚠ Must not read as an empty OR a complete workspace.
    expect(text).toContain("`Dopl Playbook`");
  });
});

/**
 * 🔒 **S29c — THE TWO MYSTERY ONTOLOGIES IN A BRAND-NEW CHANNEL.**
 *
 * `createHomeChannel` seeds nothing: what a fresh channel lists is the CALLER'S
 * OWN home shelf, which `service-audience.ts › computeAudience` folds into
 * the read scope exactly as the knowledge lane does. The knowledge lane labels
 * its half; this one rendered the widening and never named it.
 */
describe("dopl_map labels the home shelf", () => {
  const SHELF = {
    ...SUMMARY,
    ontologies: [
      SUMMARY.ontologies[0],
      {
        id: "c-2",
        slug: "my-notes",
        name: "My Notes",
        purpose: "",
        columnIds: [],
      },
    ],
    homeSpaceOntologyIds: ["c-2"],
  };

  it("names the shelf and files only its rows under it", async () => {
    const text = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => SHELF) }),
      "dopl_map",
      {},
    );
    expect(text).toContain("Home shelf");
    // ⚠ ORDER IS THE CLAIM: the container's own rows come first, the shelf after
    // its heading — otherwise the heading appears to cover both.
    expect(text.indexOf("`playbook`")).toBeLessThan(text.indexOf("Home shelf"));
    expect(text.indexOf("Home shelf")).toBeLessThan(text.indexOf("`my-notes`"));
  });

  it("counts every ontology, shelf included — the label splits, it does not filter", async () => {
    const text = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => SHELF) }),
      "dopl_map",
      {},
    );
    expect(text).toContain("## Ontology (2)");
    expect(text).toContain("`my-notes`");
  });

  /**
   * ⚠ **§8 STALE-CACHE — ABSENT IS "NOT ANSWERED", NEVER "NONE".** A payload
   * cached against a server older than this wave carries no
   * `homeSpaceOntologyIds`, and the render must be byte-identical to what it was
   * before the field existed rather than filing every row under one shelf or
   * the other.
   */
  it("a payload with NO homeSpaceOntologyIds renders exactly as before", async () => {
    const before = await callTool(registerMapFixture, client(), "dopl_map", {});
    const stale = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => ({ ...SUMMARY })) }),
      "dopl_map",
      {},
    );
    expect(stale).toBe(before);
    expect(stale).not.toContain("Home shelf");
  });

  it("an EMPTY homeSpaceOntologyIds also renders exactly as before", async () => {
    const before = await callTool(registerMapFixture, client(), "dopl_map", {});
    const none = await callTool(
      registerMapFixture,
      client({ getOntology: vi.fn(async () => ({ ...SUMMARY, homeSpaceOntologyIds: [] })) }),
      "dopl_map",
      {},
    );
    expect(none).toBe(before);
  });

  // ⚠ An id naming no listed ontology files nothing — the label is computed from
  // the SAME admitted list the response carries, so a mismatch is a stale
  // payload, not a row to invent a heading for.
  it("an id matching no listed ontology adds no heading", async () => {
    const text = await callTool(
      registerMapFixture,
      client({
        getOntology: vi.fn(async () => ({ ...SUMMARY, homeSpaceOntologyIds: ["c-99"] })),
      }),
      "dopl_map",
      {},
    );
    expect(text).not.toContain("Home shelf");
  });
});
