// @vitest-environment jsdom
/**
 * THE OBJECT PANEL'S FACE (Samuel, 2026-09-12, looking at the panel): *"We need
 * to overhaul the UI of this panel for objects. Firstly, no more indented stuff.
 * also, no need to show the ID in the UI. at the top, it shouldnt be a pill, just
 * have it be the name of the object … For the description, that UI should be the
 * underline. also for the trash and X buttons, just have it be naked icons, no
 * more button UI"*.
 *
 * ⚠ **AND THE FIELD SECTIONS GOT A GROUND ON 2026-09-13** (Samuel, over the same
 * panel): *"each of those items should have the gray background where it sits,
 * kind of like the overview you see. For example, token spend: you can see that
 * it's sitting on a gray box and on top of it are white panels. Each field should
 * be a white bar … Remove the count, the number of items in each … For each line,
 * we should see: the new attribute name, the key, the value field. The 'Add'
 * button should be under it"*.
 *
 * ⚠ **WHAT IS PINNED IS THE ABSENCE OF FOUR THINGS AND THE SOURCE OF FOUR.** The
 * absences — a pill, a uuid, a section FRAME, a button face — are what the
 * 2026-09-12 ruling was about, and every one of them is a class string that reads
 * as harmless when it comes back in a later edit. **The COUNT is a fifth absence
 * now**, and it is pinned as "nothing sits between the label and the well",
 * because a count is exactly what fits there. The sources are the recipes this
 * panel may not re-cut: the popup kit's underline (`board-header-bits.tsx ›
 * InlineUnderlineField` over `shared/ui/form-dialog.module.css`), the 30px text
 * button (`shared/ui/small-action-button.ts › SMALL_TEXT_BUTTON`), and the well's
 * two halves (`shared/ui/section-panel.tsx › SECTION_PANEL_SHELL` /
 * `SECTION_PANEL_GROUND`) — the Token-spend well, reached by import, which is why
 * this file asserts against the CONSTANTS and never against a class string.
 *
 * ⚠ jsdom loads no stylesheet, so the CSS-module half is a CLASS read (`line` /
 * `input`) — the same two-layer pin `shared/ui/form-dialog.test.tsx` uses.
 *
 * ⚠ ONE PANEL, TWO SURFACES: the workspace ontology page and /home mount this
 * same component, so these are not a page's assertions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  SECTION_PANEL_GROUND,
  SECTION_PANEL_SHELL,
} from "@/shared/ui/section-panel";
import type { GraphState } from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";
import { ObjectPanel } from "./object-panel";
import { PANEL_WELL } from "./panel-section";

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
  const dispatch = vi.fn();
  return {
    dispatch,
    ...render(
      <ObjectPanel
        objectId={objectId}
        graph={GRAPH}
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

/** The section's GRAY WELL — the element right under the label. */
function wellOf(label: string): HTMLElement {
  const section = screen.getByRole("heading", { name: label }).closest("section");
  const well = section!.querySelector("div");
  expect(well).not.toBeNull();
  return well as HTMLElement;
}

/** The WHITE BARS in a well — its direct `.bento` children, so the `+ Add`
 *  button and anything a row draws inside itself are not miscounted. */
function bars(well: HTMLElement): HTMLElement[] {
  return Array.from(well.querySelectorAll(":scope > .bento"));
}

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

describe("the section LABEL is still flat, and carries no count", () => {
  it("wears no frame, no inset body and no resize grip of its own", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const section = screen.getByRole("heading", { name: label }).closest("section");
      expect(section).not.toBeNull();
      // ⚠ The `SectionBox` face, by its four parts. The WELL is a CHILD of this
      // element, not this element — the label stands on the panel's own ground.
      expect(section!.className).not.toMatch(/rounded|border|shadow|overflow-hidden/);
      expect(screen.queryByRole("button", { name: `Resize ${label}` })).toBeNull();
    }
  });

  it("keeps the uppercase label and puts the WELL directly under it", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const heading = screen.getByRole("heading", { name: label });
      expect(heading.className).toContain("uppercase");
      expect(heading.className).toContain("text-label");
      // ⚠ THE COUNT'S ABSENCE, PINNED BY GEOMETRY (Samuel, 2026-09-13: *"Remove
      // the count, the number of items in each"*). The label carries no number
      // itself and NOTHING stands between it and the well — which is the slot a
      // returning `meta` span would take.
      expect(heading.textContent).toBe(label);
      expect(heading.nextElementSibling?.className).toBe(PANEL_WELL);
    }
  });

  it("holds no concave well anywhere in the panel", () => {
    const { container } = renderPanel();
    // `FIELD_WELL`'s own class — the inset grey the add rows used to wear.
    expect(container.innerHTML).not.toContain("concave-field");
    // …and no native `<select>`: kinds are a `SelectMenu` text face now.
    expect(container.querySelector("select")).toBeNull();
    // ⚠ EVERY attribute row carries the kind picker now, not just an add row.
    expect(screen.getAllByRole("button", { name: "Attribute type" })).toHaveLength(1);
  });

  it("adds through the 30px text button, not a raised pill", () => {
    renderPanel();
    for (const button of screen.getAllByRole("button", { name: "Add" })) {
      expect(button.className).toContain("h-[var(--action-h-sm)]");
      expect(button.className).not.toContain("btn-light");
    }
  });
});

/**
 * THE 2026-09-13 GROUND. ⚠ The well is asserted against the two IMPORTED halves,
 * never against `"rounded-[14px] bg-home-panel"`: what the ruling bought is that
 * this panel's well and the /home Token-spend well are ONE recipe, and a test that
 * spelled the tokens out would pass on a local copy of them.
 */
describe("each field section is a gray well of white bars", () => {
  it("builds the well out of the Token-spend well's own two halves", () => {
    expect(PANEL_WELL).toContain(SECTION_PANEL_SHELL);
    expect(PANEL_WELL).toContain(SECTION_PANEL_GROUND);
  });

  it("gives Attributes / Relationships / Actions that well, one per section", () => {
    renderPanel();
    for (const label of SECTIONS) {
      expect(wellOf(label).className).toBe(PANEL_WELL);
    }
  });

  it("draws every row as a white bar on it, and the Add button under them", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const well = wellOf(label);
      // The fixture carries exactly one of each.
      expect(bars(well)).toHaveLength(1);
      const add = within(well).getByRole("button", { name: "Add" });
      // ⚠ UNDER THE ROWS: the button is the well's LAST child, never a composer
      // strip above them or a footer outside the well.
      expect(well.lastElementChild).toBe(add);
    }
  });

  it("puts the row's fields ON the bar — the underline is inside it", () => {
    renderPanel();
    const bar = bars(wellOf("Attributes"))[0];
    const name = bar.querySelector('input[aria-label="Attribute label"]');
    expect(name).not.toBeNull();
    expect((name as HTMLInputElement).value).toBe("Stage");
    expect(bar.querySelector('[aria-label="Attribute type"]')).not.toBeNull();
    expect((bar.querySelector('input[aria-label="Value"]') as HTMLInputElement).value).toBe("New");
  });

  it("gives the lane's Default fields the same well", () => {
    renderPanel(LANE_ID);
    expect(wellOf("Default fields").className).toBe(PANEL_WELL);
  });

  it("shows a viewer the bars and no Add button at all", () => {
    renderPanel(CARD_ID, false);
    const well = wellOf("Attributes");
    expect(bars(well)).toHaveLength(1);
    expect(within(well).queryByRole("button", { name: "Add" })).toBeNull();
  });
});

/**
 * `+ Add` — **A ROW, NOT A COMPOSER** (Samuel, 2026-09-13: *"I have to put text
 * into 'new attribute', and when I click 'Add', the field for value comes up. I
 * don't like this"*).
 */
describe("+ Add appends an empty row with every cell on it", () => {
  it("shows name, kind and value at once, all empty", () => {
    renderPanel();
    const well = wellOf("Attributes");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    const row = bars(well)[1];
    expect(row).not.toBeUndefined();
    expect((row.querySelector('input[aria-label="Attribute label"]') as HTMLInputElement).value).toBe("");
    expect(row.querySelector('[aria-label="Attribute type"]')).not.toBeNull();
    // ⚠ THE CELL THAT USED TO NOT EXIST YET.
    expect((row.querySelector('input[aria-label="Value"]') as HTMLInputElement).value).toBe("");
  });

  it("writes nothing until the row is named, then through the SAME upsert", () => {
    const { dispatch } = renderPanel();
    const well = wellOf("Attributes");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    const name = bars(well)[1].querySelector('input[aria-label="Attribute label"]')!;

    // An unnamed row leaving focus is NOT persisted — it has no `key` to be
    // addressed at (`panel-section.tsx › useDraftRows`).
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

  it("removes the row again with its naked ✕", () => {
    renderPanel();
    const well = wellOf("Attributes");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    expect(bars(well)).toHaveLength(2);
    const remove = within(bars(well)[1]).getByRole("button", { name: "Remove" });
    expect(remove.className).toContain("group-hover:opacity-100");
    fireEvent.click(remove);
    expect(bars(well)).toHaveLength(1);
  });

  it("appends an empty bar in Relationships and Actions too", () => {
    renderPanel();
    for (const label of ["Relationships", "Actions"] as const) {
      const well = wellOf(label);
      fireEvent.click(within(well).getByRole("button", { name: "Add" }));
      expect(bars(well)).toHaveLength(2);
    }
    // The new action bar carries all four of its fields, not just a name.
    const action = bars(wellOf("Actions"))[1];
    for (const field of ["Action name", "Action description", "Action outcome", "Action tools"]) {
      expect(action.querySelector(`input[aria-label="${field}"]`)).not.toBeNull();
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
    // The lane's panel carries the template section, its LABEL flat like the rest.
    const section = screen.getByRole("heading", { name: "Default fields" }).closest("section");
    expect(section!.className).not.toMatch(/rounded|border/);
  });
});
