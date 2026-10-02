// @vitest-environment jsdom
/**
 * The 2026-10-01 field wave in the panel (Samuel): a ⋯ on each saved field with
 * "Edit description" (and "Edit options" on a select) — both the TYPE's, edited
 * from a card too — and the three typed kinds — select (only its options),
 * date, link (a real hyperlink).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import type { Ontology, OntologyObject } from "../types";
import { ObjectPanel } from "./object-panel";

afterEach(cleanup);

const CARD_ID = "9f2b1c84-4d7e-4a11-9d3f-6b0c5e8a2d77";
const LANE_ID = "1c0e7a55-92b8-4c2d-8e41-7fa3b6d09c10";

const ONTOLOGY: Ontology = {
  id: "c1",
  slug: "crm",
  name: "CRM",
  purpose: "",
  columnIds: [LANE_ID],
  layout: {},
};

const OPTIONS = ["Even Realities", "Real Kids"];

function graph(card: Partial<OntologyObject>): GraphState {
  const base = { subtitle: "", attributes: [], relationships: [], methods: [], template: [] };
  return {
    ontologies: [ONTOLOGY],
    objects: {
      [LANE_ID]: {
        ...base,
        id: LANE_ID,
        name: "Lead",
        childIds: [CARD_ID],
        template: [
          { key: "company", label: "Company", kind: "enum", options: OPTIONS, description: "Employer" },
        ],
      },
      [CARD_ID]: { ...base, id: CARD_ID, name: "Acme", childIds: [], ...card },
    },
  };
}

function renderPanel(g: GraphState, objectId = CARD_ID, canEdit = true) {
  const dispatch = vi.fn();
  render(
    <ObjectPanel
      objectId={objectId}
      graph={g}
      dispatch={dispatch}
      canEdit={canEdit}
      onSelectObject={vi.fn()}
      onDeleteObject={vi.fn()}
      onClose={vi.fn()}
    />
  );
  return dispatch;
}

describe("a select field", () => {
  const card = graph({
    attributes: [{ key: "company", label: "Company", value: { kind: "enum", value: "" } }],
  });

  it("offers ONLY the type's options, and writes them with the pick", () => {
    const dispatch = renderPanel(card);
    fireEvent.click(screen.getByRole("button", { name: "Value" }));
    const items = screen.getAllByRole("menuitem").map((m) => m.textContent);
    expect(items).toEqual(expect.arrayContaining(OPTIONS));
    expect(items).toHaveLength(OPTIONS.length + 1); // + "—" (unset)
    fireEvent.click(screen.getByRole("menuitem", { name: /Real Kids/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "ATTRIBUTE_UPSERT",
      id: CARD_ID,
      index: 0,
      attribute: {
        key: "company",
        label: "Company",
        value: { kind: "enum", value: "Real Kids" },
        options: OPTIONS,
      },
    });
  });

  it("shows the type's description under the card's row", () => {
    renderPanel(card);
    expect(screen.getByText("Employer")).toBeTruthy();
  });

  it("edits the TYPE's options from the card's ⋯", async () => {
    const dispatch = renderPanel(card);
    fireEvent.click(screen.getByRole("button", { name: "Field actions for Company" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit options/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Add option/ }));
    const inputs = within(dialog).getAllByLabelText("Option");
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "Acme" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "OBJECT_UPDATE",
      id: LANE_ID,
      patch: {
        template: [
          {
            key: "company",
            label: "Company",
            kind: "enum",
            options: [...OPTIONS, "Acme"],
            description: "Employer",
          },
        ],
      },
    });
  });
});

describe("the ⋯ menu", () => {
  // ⚠ ONE FIELD, ONE DESCRIPTION (Samuel, 2026-10-01): it is the TYPE's, so a
  // card's ⋯ writes the type's template and never the card's row.
  it("edits the TYPE's description from a card's field", async () => {
    const dispatch = renderPanel(
      graph({ attributes: [{ key: "company", label: "Company", value: { kind: "enum", value: "" } }] })
    );
    fireEvent.click(screen.getByRole("button", { name: "Field actions for Company" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit description/ }));
    fireEvent.change(await screen.findByLabelText("Field description"), {
      target: { value: "Where they work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "OBJECT_UPDATE",
      id: LANE_ID,
      patch: {
        template: [
          {
            key: "company",
            label: "Company",
            kind: "enum",
            options: OPTIONS,
            description: "Where they work",
          },
        ],
      },
    });
  });

  it("reads the type's description, never a stray per-card copy", () => {
    renderPanel(
      graph({
        attributes: [
          {
            key: "company",
            label: "Company",
            value: { kind: "enum", value: "" },
            // a pre-ruling row: the type cannot see it, so it is ignored
            ...({ description: "Card copy" } as object),
          },
        ],
      })
    );
    expect(screen.getByText("Employer")).toBeTruthy();
    expect(screen.queryByText("Card copy")).toBeNull();
  });

  it("offers no description on a field its type does not have", () => {
    renderPanel(
      graph({ attributes: [{ key: "stage", label: "Stage", value: { kind: "text", value: "New" } }] })
    );
    fireEvent.click(screen.getByRole("button", { name: "Field actions for Stage" }));
    // a text field has no options to edit, and no type field to describe
    expect(screen.queryByRole("menuitem", { name: /Edit options/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Edit description/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Remove field/ })).toBeTruthy();
  });

  it("is on the type's template rows too", () => {
    renderPanel(graph({}), LANE_ID);
    expect(screen.getByRole("button", { name: "Field actions for Company" })).toBeTruthy();
  });

  it("is absent for a viewer", () => {
    renderPanel(
      graph({ attributes: [{ key: "stage", label: "Stage", value: { kind: "text", value: "" } }] }),
      CARD_ID,
      false
    );
    expect(screen.queryByRole("button", { name: /Field actions/ })).toBeNull();
  });
});

describe("a link field", () => {
  it("renders a saved link as a hyperlink that leaves the app", () => {
    renderPanel(
      graph({
        attributes: [
          { key: "site", label: "Site", value: { kind: "link", value: "https://evenrealities.com" } },
        ],
      })
    );
    const a = screen.getByRole("link", { name: "https://evenrealities.com" });
    expect(a.getAttribute("href")).toBe("https://evenrealities.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("never writes a value that is not an http(s) URL", () => {
    const dispatch = renderPanel(
      graph({ attributes: [{ key: "site", label: "Site", value: { kind: "link", value: "" } }] })
    );
    const input = screen.getByLabelText("Value");
    fireEvent.change(input, { target: { value: "evenrealities.com" } });
    fireEvent.blur(input);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/http/);
    fireEvent.change(input, { target: { value: "https://evenrealities.com" } });
    fireEvent.blur(input);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: expect.objectContaining({
          value: { kind: "link", value: "https://evenrealities.com" },
        }),
      })
    );
  });
});

describe("a date field", () => {
  it("is a date input for an editor and a readable day for a viewer", () => {
    const g = graph({ attributes: [{ key: "due", label: "Due", value: { kind: "date", value: "2026-10-01" } }] });
    renderPanel(g);
    expect((screen.getByLabelText("Value") as HTMLInputElement).type).toBe("date");
    cleanup();
    renderPanel(g, CARD_ID, false);
    expect(screen.queryByLabelText("Value")).toBeNull();
    expect(screen.getByText(/2026/).textContent).not.toBe("2026-10-01");
  });
});
