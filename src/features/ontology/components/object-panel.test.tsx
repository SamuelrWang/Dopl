// @vitest-environment jsdom
/**
 * The object panel's face: one white card; the type as a quiet eyebrow beside naked delete and
 * close; name and description edited in place; each section a muted caption title over hairline
 * rows on the card, keyed rows on the label / value grid. Asserted against the imported constants,
 * so a local copy of a recipe fails. Both the workspace ontology page and /home mount it.
 *
 * jsdom loads no stylesheet, so the CSS-module half is a class read (`line` / `input…`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import type { GraphState } from "../graph-state";
import type { Ontology, OntologyObject } from "../types";
import { ObjectPanel } from "./object-panel";
import { PANEL_GRID, PANEL_ROW } from "./panel-section";

afterEach(cleanup);

/** A real-shaped uuid — the panel must print it nowhere. */
const CARD_ID = "9f2b1c84-4d7e-4a11-9d3f-6b0c5e8a2d77";
const LANE_ID = "1c0e7a55-92b8-4c2d-8e41-7fa3b6d09c10";

function object(id: string, name: string, childIds: string[] = []): OntologyObject {
  return {
    id,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds,
    template: [],
  };
}

const ONTOLOGY: Ontology = {
  id: "c1",
  slug: "pipeline",
  name: "Pipeline",
  purpose: "",
  columnIds: [LANE_ID],
  layout: {},
};

const CARD: OntologyObject = {
  ...object(CARD_ID, "Acme"),
  subtitle: "The deal",
  attributes: [{ key: "stage", label: "Stage", value: { kind: "text", value: "New" } }],
  relationships: [{ label: "owned by", targetIds: [] }],
  methods: [{ name: "Send email", description: "", outcome: "", tools: "" }],
};

const GRAPH: GraphState = {
  ontologies: [ONTOLOGY],
  objects: { [LANE_ID]: object(LANE_ID, "Lead", [CARD_ID]), [CARD_ID]: CARD },
};

function renderPanel(objectId = CARD_ID, canEdit = true, graph = GRAPH) {
  const dispatch = vi.fn();
  return {
    dispatch,
    ...render(
      <ObjectPanel
        objectId={objectId}
        graph={graph}
        dispatch={dispatch}
        canEdit={canEdit}
        onSelectObject={vi.fn()}
        onDeleteObject={vi.fn()}
        onClose={vi.fn()}
      />
    ),
  };
}

const SECTIONS = ["Attributes", "Relationships", "Actions"] as const;

function sectionOf(label: string): HTMLElement {
  const section = screen.getByRole("heading", { name: label }).closest("section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

/** A section's rows: the elements wearing the row recipe, so `+ Add` is never counted. */
function rows(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll<HTMLElement>("div")).filter((el) =>
    PANEL_ROW.split(" ").every((c) => el.classList.contains(c))
  );
}

describe("the card and its header", () => {
  it("is one white card", () => {
    const { container } = renderPanel();
    expect((container.firstElementChild as HTMLElement).className).toContain("white-card");
  });

  it("names the object TYPE as a muted eyebrow, with no pill around it", () => {
    renderPanel();
    const eyebrow = screen.getByText("Lead");
    expect(eyebrow.className).toContain("text-caption");
    expect(eyebrow.className).toContain("text-text-muted");
    expect(eyebrow.className).not.toMatch(/rounded-full|border|bg-|uppercase/);
  });

  it("prints the uuid NOWHERE a person can read it — not even in a title", () => {
    const { container } = renderPanel();
    expect(container.innerHTML).not.toContain(CARD_ID);
    expect(container.innerHTML).not.toContain(LANE_ID);
  });

  it("gives Delete and Close the naked icon button", () => {
    renderPanel();
    for (const name of [/^Delete /, "Close"] as const) {
      expect(screen.getByRole("button", { name }).className).toBe(NAKED_ICON_BUTTON);
    }
  });

  it("edits the name and the description in place, in the header", () => {
    const { dispatch } = renderPanel();
    const header = screen.getByLabelText("Object name").closest("header")!;
    expect(within(header).getByLabelText("Description")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Object name"), { target: { value: "Acme Co" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "OBJECT_UPDATE",
      id: CARD_ID,
      patch: { name: "Acme Co" },
    });
  });
});

describe("each section is a caption title over hairline rows", () => {
  it("titles the section in muted caption ink, with no count and no frame", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const heading = screen.getByRole("heading", { name: label });
      expect(heading.className).toContain("text-caption");
      expect(heading.className).toContain("text-text-muted");
      expect(heading.textContent).toBe(label);
      expect(sectionOf(label).className).not.toMatch(/\bborder|shadow|bg-|rounded/);
    }
  });

  it("draws one hairline row per item and the Add button under them", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const section = sectionOf(label);
      expect(rows(section)).toHaveLength(1);
      const add = within(section).getByRole("button", { name: "Add" });
      expect(add.parentElement?.lastElementChild).toBe(add);
    }
  });

  it("lays keyed rows on the label / value grid", () => {
    renderPanel();
    for (const label of ["Attributes", "Relationships"] as const) {
      const row = rows(sectionOf(label))[0];
      for (const c of PANEL_GRID.split(" ")) expect(row.classList).toContain(c);
    }
  });

  it("orders the attribute row label, then value, kind and menu — no colon glyph", () => {
    renderPanel();
    const [labelCell, valueCell] = Array.from(rows(sectionOf("Attributes"))[0].children);
    expect(labelCell.querySelector('input[aria-label="Attribute label"]')).not.toBeNull();
    expect(valueCell.querySelector('input[aria-label="Value"]')).not.toBeNull();
    expect(valueCell.querySelector('[aria-label="Attribute type"]')).not.toBeNull();
    expect(screen.queryByText(":")).toBeNull();
  });

  it("holds no native select and no concave well", () => {
    const { container } = renderPanel();
    expect(container.innerHTML).not.toContain("concave-field");
    expect(container.querySelector("select")).toBeNull();
  });

  it("gives the lane's Default fields a caption and the same rows", () => {
    renderPanel(LANE_ID);
    expect(screen.getByText("Object · 1")).toBeTruthy();
    expect(
      within(sectionOf("Default fields")).getByText(
        "New objects of this type start with these fields, ready to fill."
      )
    ).toBeTruthy();
  });

  it("shows a viewer the rows and no Add button at all", () => {
    renderPanel(CARD_ID, false);
    const section = sectionOf("Attributes");
    expect(rows(section)).toHaveLength(1);
    expect(within(section).queryByRole("button", { name: "Add" })).toBeNull();
  });
});

describe("+ Add appends an empty row with every cell on it", () => {
  it("shows label, value and kind at once, all empty", () => {
    renderPanel();
    const section = sectionOf("Attributes");
    fireEvent.click(within(section).getByRole("button", { name: "Add" }));
    const row = rows(section)[1];
    expect((row.querySelector('input[aria-label="Attribute label"]') as HTMLInputElement).value).toBe("");
    expect(row.querySelector('[aria-label="Attribute type"]')).not.toBeNull();
    expect((row.querySelector('input[aria-label="Value"]') as HTMLInputElement).value).toBe("");
  });

  it("writes nothing until the row is named, then through the SAME upsert", () => {
    const { dispatch } = renderPanel();
    const section = sectionOf("Attributes");
    fireEvent.click(within(section).getByRole("button", { name: "Add" }));
    const name = rows(section)[1].querySelector('input[aria-label="Attribute label"]')!;

    fireEvent.blur(name);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Owner" } });
    fireEvent.blur(name);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ATTRIBUTE_UPSERT",
      id: CARD_ID,
      index: null,
      attribute: { key: "owner", label: "Owner", value: { kind: "text", value: "" } },
    });
  });

  it("removes the draft again with its ✕, revealed on hover or focus", () => {
    renderPanel();
    const section = sectionOf("Attributes");
    fireEvent.click(within(section).getByRole("button", { name: "Add" }));
    expect(rows(section)).toHaveLength(2);
    const remove = within(rows(section)[1]).getByRole("button", { name: "Remove" });
    expect(remove.className).toContain("group-hover:opacity-100");
    expect(remove.className).toContain("focus-visible:opacity-100");
    fireEvent.click(remove);
    expect(rows(section)).toHaveLength(1);
  });

  it("appends an empty row in Relationships and Actions too", () => {
    renderPanel();
    for (const label of ["Relationships", "Actions"] as const) {
      const section = sectionOf(label);
      fireEvent.click(within(section).getByRole("button", { name: "Add" }));
      expect(rows(section)).toHaveLength(2);
    }
    const action = rows(sectionOf("Actions"))[1];
    for (const field of ["Action name", "Action description", "Action outcome", "Action tools"]) {
      expect(action.querySelector(`input[aria-label="${field}"]`)).not.toBeNull();
    }
  });
});

describe("the fields are the popup kit's quiet underline", () => {
  it("gives the description the word as its hint and the secondary ink", () => {
    renderPanel();
    const field = screen.getByLabelText("Description") as HTMLInputElement;
    expect(field.placeholder).toBe("Description");
    expect(field.value).toBe("The deal");
    expect(field.className).toMatch(/inputSecondary/);
  });

  it("draws no rule at rest on any field, the ink line only while focused", () => {
    renderPanel();
    for (const label of ["Description", "Attribute label", "Value", "Edge label", "Action name"]) {
      expect(screen.getByLabelText(label).className).toMatch(/inputQuiet/);
    }
    const field = screen.getByLabelText("Attribute label");
    const line = field.parentElement!;
    expect(line.className).not.toMatch(/lineActive/);
    fireEvent.focus(field);
    expect(line.className).toMatch(/lineActive/);
    fireEvent.blur(field);
    expect(line.className).not.toMatch(/lineActive/);
  });

  it("keeps a viewer read-only on those same lines", () => {
    renderPanel(CARD_ID, false);
    expect((screen.getByLabelText("Description") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Attribute label") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("shows a viewer a ref value as chips, with no picker", () => {
    const REF_CARD: OntologyObject = {
      ...object(CARD_ID, "Acme"),
      attributes: [{ key: "owner", label: "Owner", value: { kind: "ref", value: [LANE_ID] } }],
    };
    renderPanel(CARD_ID, false, {
      ontologies: [ONTOLOGY],
      objects: { [LANE_ID]: object(LANE_ID, "Lead"), [CARD_ID]: REF_CARD },
    });
    const [, valueCell] = Array.from(rows(sectionOf("Attributes"))[0].children);
    expect(valueCell.textContent).toContain("Lead");
    expect(valueCell.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
  });
});
