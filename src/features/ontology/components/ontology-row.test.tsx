// @vitest-environment jsdom
/**
 * The field NAME wears a black rectangular pill in the Rows display (Samuel
 * #3031, Rows view chosen in #3079). First coverage this component has had.
 *
 * What is pinned is the TOKEN PAIR, not a colour: `bg-surface-cta` /
 * `text-text-on-cta` is the app's existing ink/on-ink pair, so a brand change
 * moves the pill with it and a literal hex would not. A test on "black" would
 * pass against a minted `#000`, which is the thing the brief forbade.
 *
 * Three things here are easy to break and silent when broken:
 * - RECTANGLE, not a lozenge. `rounded-[4px]`, never `rounded-pill`.
 * - EDGES ARE NOT FIELDS. Relationship labels share this `<dt>` and must stay
 *   italic and unpilled — he asked for field names.
 * - The ellipsis belongs INSIDE the pill. `truncate` on the `<dt>` would clip an
 *   inline-block child square instead of ellipsing it, so the pill owns it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { OntologyRow } from "./ontology-row";

afterEach(cleanup);

const OBJECT: OntologyObject = {
  id: "o1",
  name: "Acme Corp",
  subtitle: "A lead",
  attributes: [
    { key: "stage", label: "Stage", value: { kind: "text", value: "Qualified" } },
    // A long one: the pill has to truncate without widening the column.
    {
      key: "owner",
      label: "Account owner of record",
      value: { kind: "text", value: "Sam" },
    },
  ],
  relationships: [{ label: "member of", targetIds: ["o2"] }],
  methods: [],
  childIds: [],
  template: [],
} as OntologyObject;

const GRAPH: GraphState = {
  ontologies: [],
  objects: {
    o1: OBJECT,
    o2: { ...OBJECT, id: "o2", name: "Pipeline", attributes: [], relationships: [] },
  },
} as unknown as GraphState;

const renderRow = () =>
  render(
    <OntologyRow objectId="o1" graph={GRAPH} selected={false} onSelect={vi.fn()} />
  );

describe("the field name wears a black pill in Rows", () => {
  it("draws the label on the published gray token, not a hex", () => {
    renderRow();
    const label = screen.getByText("Stage");
    expect(label.className).toContain("bg-text-secondary");
    expect(label.className).toContain("text-text-on-invert");
    // A minted colour would pass a "looks gray" assertion. This cannot.
    expect(label.className).not.toMatch(/\[#|bg-black|text-white|bg-gray-/);
  });

  it("is MID gray — not either darker fill he already rejected", () => {
    renderRow();
    // Both were shipped and both came back as "reads black" (#3162, #3186).
    // Pinned by name: they are a shade apart on screen, so a revert to either
    // would look "still fine" in review while undoing what he asked for twice.
    const cls = screen.getByText("Stage").className;
    expect(cls).not.toContain("surface-cta"); // #1c2127, 16.20:1
    expect(cls).not.toContain("home-frame"); // #2f3542, 12.29:1
  });

  it("is a RECTANGLE with a small radius, never a lozenge", () => {
    renderRow();
    const label = screen.getByText("Stage");
    expect(label.className).toContain("rounded-[4px]");
    expect(label.className).not.toMatch(/rounded-(pill|full)/);
  });

  it("leaves relationship labels alone — edges are not fields", () => {
    renderRow();
    const edge = screen.getByText("member of");
    expect(edge.className).toContain("italic");
    expect(edge.className).not.toContain("bg-surface-cta");
  });

  it("truncates INSIDE the pill, so a long name cannot widen the column", () => {
    renderRow();
    const label = screen.getByText("Account owner of record");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("max-w-full");
    // The <dt> must NOT also truncate: it would clip the pill square.
    const dt = label.closest("dt");
    expect(dt).not.toBeNull();
    expect(dt?.className).toContain("w-40");
    expect(dt?.className).not.toContain("truncate");
  });

  it("does not touch the value", () => {
    renderRow();
    const value = screen.getByText("Qualified");
    expect(value.className).not.toContain("bg-surface-cta");
    expect(value.textContent).toBe("Qualified");
  });
});
