// @vitest-environment jsdom
/** The Rows group header: a viewer reads the type's default fields, and both folds name what they
 *  control. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OntologyObject } from "../types";
import { OntologyRowsGroupHeader } from "./ontology-rows-group-header";

afterEach(cleanup);

const TYPE: OntologyObject = {
  id: "type-lead",
  name: "",
  subtitle: "",
  attributes: [],
  relationships: [],
  methods: [],
  childIds: [],
  template: [{ key: "stage", label: "Stage", kind: "enum", options: ["New"] }],
};

function renderHeader(canEdit: boolean) {
  render(
    <OntologyRowsGroupHeader
      column={TYPE}
      graph={{ ontologies: [], objects: { [TYPE.id]: TYPE } }}
      dispatch={vi.fn()}
      canEdit={canEdit}
      open
      onToggleOpen={vi.fn()}
      recordsId="records-1"
      onSelect={vi.fn()}
      onCreateObject={vi.fn()}
    />
  );
}

describe("OntologyRowsGroupHeader", () => {
  it("shows a viewer the type's default fields behind their own fold", () => {
    renderHeader(false);
    const toggle = screen.getByRole("button", { name: "Show default fields for Untitled object" });
    const fold = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(fold?.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(fold?.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("Stage")).toBeTruthy();
    expect(screen.getByText("Select")).toBeTruthy();
  });

  it("points the records chevron at the records fold", () => {
    renderHeader(true);
    const chevron = screen.getByRole("button", { name: "Collapse Untitled object" });
    expect(chevron.getAttribute("aria-controls")).toBe("records-1");
  });
});
