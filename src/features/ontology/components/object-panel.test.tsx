// @vitest-environment jsdom
/**
 * THE OBJECT PANEL'S FACE (Samuel, 2026-09-12, looking at the panel): *"We need
 * to overhaul the UI of this panel for objects. Firstly, no more indented stuff.
 * also, no need to show the ID in the UI. at the top, it shouldnt be a pill, just
 * have it be the name of the object … For the description, that UI should be the
 * underline. also for the trash and X buttons, just have it be naked icons, no
 * more button UI"*.
 *
 * ⚠ **WHAT IS PINNED IS THE ABSENCE OF FOUR THINGS AND THE SOURCE OF TWO.** The
 * absences — a pill, a uuid, a section FRAME, a button face — are what the
 * ruling was about, and every one of them is a class string that reads as
 * harmless when it comes back in a later edit. The sources are the two recipes
 * this panel may not re-cut: the popup kit's underline
 * (`board-header-bits.tsx › InlineUnderlineField` over
 * `shared/ui/form-dialog.module.css`) and the 30px text button
 * (`shared/ui/small-action-button.ts › SMALL_TEXT_BUTTON`).
 *
 * ⚠ jsdom loads no stylesheet, so the CSS-module half is a CLASS read (`line` /
 * `input`) — the same two-layer pin `shared/ui/form-dialog.test.tsx` uses.
 *
 * ⚠ ONE PANEL, TWO SURFACES: the workspace ontology page and /home mount this
 * same component, so these are not a page's assertions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { ObjectPanel } from "./object-panel";

afterEach(cleanup);

/** A REAL-SHAPED uuid — the string the header used to print in `font-mono`. */
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

const CLUSTER: OntologyCluster = {
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
  clusters: [CLUSTER],
  objects: { [LANE_ID]: object(LANE_ID, "Lead", [CARD_ID]), [CARD_ID]: CARD },
};

function renderPanel(objectId = CARD_ID, canEdit = true) {
  return render(
    <ObjectPanel
      objectId={objectId}
      graph={GRAPH}
      dispatch={vi.fn()}
      canEdit={canEdit}
      onSelectObject={vi.fn()}
      onDeleteObject={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

const SECTIONS = ["Attributes", "Relationships", "Actions"] as const;

describe("the header", () => {
  it("is the object TYPE's name in the title face, with no pill around it", () => {
    renderPanel();
    // The card's own name is the panel title below; this line is its lane's.
    const top = screen.getByText("Lead");
    expect(top.className).toContain("text-body");
    expect(top.className).toContain("font-medium");
    expect(top.className).toContain("text-text-primary");
    // ⚠ THE FAILURE THIS CATCHES: the pill coming back as a "badge".
    expect(top.className).not.toMatch(/rounded-full|border|bg-bg-inset|uppercase/);
  });

  it("prints the uuid NOWHERE a person can read it — not even in a title", () => {
    const { container } = renderPanel();
    // innerHTML, not textContent: a `title` or `aria-label` carrying the id is
    // still the id on screen, and that is what the ruling removed.
    expect(container.innerHTML).not.toContain(CARD_ID);
    expect(container.innerHTML).not.toContain(LANE_ID);
  });

  it("gives Delete and Close naked icons — no button face in any state", () => {
    renderPanel();
    for (const name of [/^Delete /, "Close"] as const) {
      const button = screen.getByRole("button", { name });
      expect(button.className).not.toMatch(/btn-light|border|shadow|bg-/);
      expect(button.className).toContain("text-text-muted");
      expect(button.className).toContain("hover:text-text-primary");
      // The 30px hit area is PADDING — a fixed box would draw one again.
      expect(button.className).toContain("p-2");
      expect(button.className).not.toMatch(/\bh-\d|\bw-\d|\bh-\[|\bw-\[/);
    }
  });
});

describe("the sections are flat", () => {
  it("wears no frame, no inset body and no resize grip", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const section = screen.getByRole("heading", { name: label }).closest("section");
      expect(section).not.toBeNull();
      // ⚠ The `SectionBox` face, by its four parts.
      expect(section!.className).not.toMatch(/rounded|border|shadow|overflow-hidden/);
      expect(section!.querySelector(".bento")).toBeNull();
      expect(screen.queryByRole("button", { name: `Resize ${label}` })).toBeNull();
    }
  });

  it("keeps the uppercase label + count row it always had", () => {
    renderPanel();
    const heading = screen.getByRole("heading", { name: "Attributes" });
    expect(heading.className).toContain("uppercase");
    expect(heading.className).toContain("text-label");
    expect(heading.parentElement?.textContent).toBe("Attributes1");
  });

  it("holds no concave well anywhere in the panel", () => {
    const { container } = renderPanel();
    // `FIELD_WELL`'s own class — the inset grey the add rows used to wear.
    expect(container.innerHTML).not.toContain("concave-field");
    // …and no native `<select>`: kinds are a `SelectMenu` text face now.
    expect(container.querySelector("select")).toBeNull();
    expect(screen.getByRole("button", { name: "Attribute type" })).toBeTruthy();
  });

  it("adds through the 30px text button, not a raised pill", () => {
    renderPanel();
    for (const button of screen.getAllByRole("button", { name: "Add" })) {
      expect(button.className).toContain("h-[var(--action-h-sm)]");
      expect(button.className).not.toContain("btn-light");
    }
  });
});

describe("the fields are the popup kit's underline", () => {
  it("gives the description the kit's line and the WORD as its hint", () => {
    renderPanel();
    const field = screen.getByLabelText("Description") as HTMLInputElement;
    expect(field.className).toMatch(/input/);
    expect(field.parentElement?.className).toMatch(/line/);
    // ⚠ NOT the sentence it used to hold ("…agents see this when browsing…").
    expect(field.placeholder).toBe("Description");
    expect(field.value).toBe("The deal");
  });

  it("gives every row field the same line", () => {
    renderPanel();
    for (const label of ["Attribute label", "Edge label", "Action name"]) {
      const field = screen.getByLabelText(label);
      expect(field.className).toMatch(/input/);
      expect(field.parentElement?.className).toMatch(/line/);
    }
  });

  it("keeps a viewer read-only on those same lines", () => {
    renderPanel(CARD_ID, false);
    expect((screen.getByLabelText("Description") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Attribute label") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });
});

describe("the lane's own panel", () => {
  it("states what it is and how many items it has — still no pill", () => {
    renderPanel(LANE_ID);
    const top = screen.getByText("Object · 1");
    expect(top.className).not.toMatch(/rounded-full|border/);
    // The lane's panel carries the template section, flat like the rest.
    const section = screen.getByRole("heading", { name: "Default fields" }).closest("section");
    expect(section!.className).not.toMatch(/rounded|border/);
  });
});
