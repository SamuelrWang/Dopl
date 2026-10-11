// @vitest-environment jsdom
/**
 * ONE SLUG RULE FOR FIELD KEYS (`field-kinds.ts › fieldKey`): a field added from the object
 * panel's attributes, from a type's Default fields, and from the New object dialog lands at the
 * SAME key for the same label — otherwise a template field and an attribute filled from it stop
 * being one field. Multi-word labels, so the whitespace→hyphen half of the rule is exercised.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { fieldKey } from "../field-kinds";
import type { GraphState } from "../graph-state";
import type { Ontology, OntologyObject } from "../types";
import { NewObjectDialog } from "./new-object-dialog";
import { ObjectPanel } from "./object-panel";

afterEach(cleanup);

const CARD_ID = "9f2b1c84-4d7e-4a11-9d3f-6b0c5e8a2d77";
const LANE_ID = "1c0e7a55-92b8-4c2d-8e41-7fa3b6d09c10";

function object(id: string, name: string, childIds: string[] = []): OntologyObject {
  return { id, name, subtitle: "", attributes: [], relationships: [], methods: [], childIds, template: [] };
}

const ONTOLOGY: Ontology = { id: "c1", slug: "pipeline", name: "Pipeline", purpose: "", columnIds: [LANE_ID], layout: {} };
const GRAPH: GraphState = {
  ontologies: [ONTOLOGY],
  objects: { [LANE_ID]: object(LANE_ID, "Lead", [CARD_ID]), [CARD_ID]: object(CARD_ID, "Acme") },
};

function renderPanel(objectId: string) {
  const dispatch = vi.fn();
  render(
    <ObjectPanel
      objectId={objectId}
      graph={GRAPH}
      dispatch={dispatch}
      canEdit
      onSelectObject={vi.fn()}
      onDeleteObject={vi.fn()}
      onClose={vi.fn()}
    />
  );
  return dispatch;
}

function section(label: string): HTMLElement {
  const s = screen.getByRole("heading", { name: label }).closest("section");
  expect(s).not.toBeNull();
  return s as HTMLElement;
}

describe("fieldKey", () => {
  it("lowercases, trims, and joins words with one hyphen", () => {
    expect(fieldKey("  Next   Step ")).toBe("next-step");
    expect(fieldKey("Owner")).toBe("owner");
  });
});

describe("every place a field is named keys it with fieldKey", () => {
  it("an attribute added on the object panel", () => {
    const dispatch = renderPanel(CARD_ID);
    const well = section("Attributes");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    const inputs = well.querySelectorAll<HTMLInputElement>('input[aria-label="Attribute label"]');
    const name = inputs[inputs.length - 1];
    fireEvent.change(name, { target: { value: "Next Step" } });
    fireEvent.blur(name);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ATTRIBUTE_UPSERT",
        attribute: expect.objectContaining({ key: fieldKey("Next Step"), label: "Next Step" }),
      })
    );
  });

  it("a Default field added on a type", () => {
    const dispatch = renderPanel(LANE_ID);
    const well = section("Default fields");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    const name = within(well).getByLabelText("Field label");
    fireEvent.change(name, { target: { value: "Next Step" } });
    fireEvent.blur(name);
    expect(dispatch).toHaveBeenCalledWith({
      type: "OBJECT_UPDATE",
      id: LANE_ID,
      patch: { template: [{ key: fieldKey("Next Step"), label: "Next Step", kind: "text" }] },
    });
  });

  it("a field named in the New object dialog", async () => {
    const onCreate = vi.fn();
    render(<NewObjectDialog open onDiscard={vi.fn()} onCreate={onCreate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Field" }));
    fireEvent.change(await screen.findByLabelText("Field"), { target: { value: "Next Step" } });
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ template: [{ key: fieldKey("Next Step"), label: "Next Step", kind: "text" }] })
    );
  });
});
