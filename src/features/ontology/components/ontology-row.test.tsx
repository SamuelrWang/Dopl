// @vitest-environment jsdom
/**
 * The four states of a pointer value (`field-list.tsx › FieldValue`), pinned for both the `ref`
 * and the `knowledge` branch: resolved · present but nameless · absent · no targets at all.
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { OntologyRow } from "./ontology-row";

/**
 * Mocked so `nameOf` can give all three of its answers: a name, `null` (absent) and `""` (present
 * with no usable name). `""`, not whitespace: only the empty string separates `name === null` from
 * a truthiness test.
 */
vi.mock("../hooks/use-workspace-resources", () => ({
  useWorkspaceResources: () => ({
    workspaceId: "w",
    knowledge: [],
    skills: [],
    homeSpace: true,
    nameOf: (id: string) =>
      id === "kb-named" ? "Sales playbook" : id === "kb-blank" ? "" : null,
  }),
  OntologyResourcesProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);

const base = (id: string, name: string): OntologyObject =>
  ({
    id,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
    template: [],
  }) as unknown as OntologyObject;

/** One attribute per state, so one render covers all four in a branch. */
const subjectWith = (kind: "ref" | "knowledge", ids: Record<string, string[]>): OntologyObject =>
  ({
    ...base("subject", "Subject"),
    attributes: [
      { key: "a", label: "No targets", value: { kind, value: [] } },
      { key: "b", label: "All absent", value: { kind, value: ids.absent } },
      { key: "c", label: "Partly absent", value: { kind, value: ids.partial } },
      { key: "d", label: "Present but nameless", value: { kind, value: ids.blank } },
    ],
  }) as unknown as OntologyObject;

const REF_SUBJECT = subjectWith("ref", {
  absent: ["ghost"],
  partial: ["named", "ghost"],
  blank: ["nameless"],
});

const KB_SUBJECT = subjectWith("knowledge", {
  absent: ["kb-ghost"],
  partial: ["kb-named", "kb-ghost"],
  blank: ["kb-blank"],
});

const graphFor = (subject: OntologyObject): GraphState =>
  ({
    ontologies: [],
    objects: {
      subject,
      named: base("named", "Northwind"),
      // In the graph with no usable name: present, not absent. `""` for the reason on the mock.
      nameless: base("nameless", ""),
      // `ghost` is deliberately absent from this map.
    },
  }) as unknown as GraphState;

function renderRow(subject: OntologyObject) {
  return render(
    <OntologyRow
      objectId="subject"
      graph={graphFor(subject)}
      selected={false}
      onSelect={() => {}}
    />
  );
}

describe.each([
  ["ref", REF_SUBJECT, "Northwind"],
  ["knowledge", KB_SUBJECT, "Sales playbook"],
])("OntologyRow — %s pointer states", (_kind, subject, resolvedName) => {
  it("renders a marker for a field with NO targets, never a blank cell", () => {
    renderRow(subject);
    expect(screen.getAllByText("Empty")).toHaveLength(1);
  });

  it("says what it lost when every target is absent", () => {
    renderRow(subject);
    expect(screen.getAllByText(/not in this ontology/).length).toBeGreaterThan(0);
  });

  it("reports the loss BESIDE what resolved when only some targets are absent", () => {
    renderRow(subject);
    expect(screen.getByText(resolvedName)).toBeTruthy();
    // Two fields lose one target each; the nameless field loses none (a miscount reads 3).
    expect(screen.getAllByText("1 not in this ontology")).toHaveLength(2);
  });

  it("renders a nameless target as a chip, not as a loss", () => {
    // By the chip's `title`: a blank field LABEL renders an em-dash too.
    renderRow(subject);
    expect(screen.getByTitle("—")).toBeTruthy();
  });
});
