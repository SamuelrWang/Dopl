/**
 * INVARIANT SUITE — ⚠ `dopl_map` fetches the SUMMARY, never the graph. The
 * instructions send every agent here before its first substantive reply, so it
 * is the most-executed read in the product, and a bare `getOntology()` pulls
 * every JSONB column across the wire to render cluster and column names.
 *
 * ⚠ The regression is invisible by every other means: swapping back renders a
 * BYTE-IDENTICAL result and passes every existing map test. So the assertion is
 * on the CALL, and the second test proves the tool cannot be reading the heavy
 * fields even when a client hands them over.
 */

import { describe, it, expect, vi } from "vitest";

import { registerMapTool } from "./map";
import { callTool, stub } from "./narration-fixtures";

const SUMMARY = {
  clusters: [
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
    await callTool(registerMapTool, c, "dopl_map", {});
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
      clusters: [{ ...SUMMARY.clusters[0], layout: { "o-1": { x: 40, y: 80 } } }],
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
    const lean = await callTool(registerMapTool, client(), "dopl_map", {});
    const fat = await callTool(
      registerMapTool,
      client({ getOntology: vi.fn(async () => heavy) }),
      "dopl_map",
      {},
    );
    expect(fat).toBe(lean);
    expect(lean).toContain("`Dopl Playbook`");
    expect(lean).toContain("(columns: `Surfaces`)");
  });
});

describe("dopl_map reports a clipped ontology read", () => {
  it("says nothing extra when the read was complete", async () => {
    // ⚠ The healthy result must stay byte-identical — a warning that also fires
    // on the happy path teaches agents to skip it.
    const text = await callTool(registerMapTool, client(), "dopl_map", {});
    expect(text).not.toContain("CLIPPED");
  });

  it("names the clip when the server reports one", async () => {
    const text = await callTool(
      registerMapTool,
      client({ getOntology: vi.fn(async () => ({ ...SUMMARY, truncated: true })) }),
      "dopl_map",
      {},
    );
    expect(text).toContain("CLIPPED");
    // ⚠ Must not read as an empty OR a complete workspace.
    expect(text).toContain("`Dopl Playbook`");
  });
});
