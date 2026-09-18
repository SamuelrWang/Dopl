// @vitest-environment jsdom
/**
 * ObjectPanel face rulings (Samuel): 2026-09-12 no pill, no uuid on screen, no
 * section frame, naked icon buttons, underlined description; 2026-09-13 each field
 * section is a gray well of white bars and the item count is gone.
 *
 * Asserted against the imported constants, never a class string, so this panel and
 * /home stay one recipe: the popup kit's underline (`board-header-bits.tsx ›
 * InlineUnderlineField` over `shared/ui/form-dialog.module.css`), the 30px text
 * button (`shared/ui/small-action-button.ts › SMALL_TEXT_BUTTON`) and the well's
 * two halves (`shared/ui/section-panel.tsx › SECTION_PANEL_SHELL` /
 * `SECTION_PANEL_GROUND`).
 *
 * jsdom loads no stylesheet, so the CSS-module half is a class read (`line` /
 * `input`). Both the workspace ontology page and /home mount this component.
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

/** The well is the section itself — the label sits inside the gray. */
function wellOf(label: string): HTMLElement {
  const section = screen.getByRole("heading", { name: label }).closest("section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

/** The white bars in a well — direct `.bento` children only, so `+ Add` and a
 *  row's own inner markup are not miscounted. */
function bars(well: HTMLElement): HTMLElement[] {
  return Array.from(well.querySelectorAll(":scope > div > .bento"));
}

describe("the header", () => {
  it("is the object TYPE's name in the title face, with no pill around it", () => {
    renderPanel();
    // The card's own name is the panel title below; this line is its lane's.
    const top = screen.getByText("Lead");
    expect(top.className).toContain("text-body");
    expect(top.className).toContain("font-medium");
    expect(top.className).toContain("text-text-primary");
    // catches the pill coming back as a "badge".
    expect(top.className).not.toMatch(/rounded-full|border|bg-bg-inset|uppercase/);
  });

  it("prints the uuid NOWHERE a person can read it — not even in a title", () => {
    const { container } = renderPanel();
    // innerHTML, not textContent: an id in a `title`/`aria-label` is still on screen.
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
      // the 30px hit area is padding — a fixed box would draw a face again.
      expect(button.className).toContain("p-2");
      expect(button.className).not.toMatch(/\bh-\d|\bw-\d|\bh-\[|\bw-\[/);
    }
  });
});

describe("the section LABEL sits in the gray, and carries no count", () => {
  it("wears no hairline, no inset body and no resize grip", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const section = screen.getByRole("heading", { name: label }).closest("section");
      expect(section).not.toBeNull();
      // the `SectionBox` face by its parts; the section is the Token-spend well
      // now, so that well's radius and `--home-panel` fill are allowed.
      expect(section!.className).not.toMatch(/\bborder|shadow|overflow-hidden/);
      expect(screen.queryByRole("button", { name: `Resize ${label}` })).toBeNull();
    }
  });

  it("keeps the uppercase label INSIDE the well, as Token spend does", () => {
    renderPanel();
    for (const label of SECTIONS) {
      const heading = screen.getByRole("heading", { name: label });
      expect(heading.className).toContain("uppercase");
      expect(heading.className).toContain("text-label");
      // count removed (Samuel, 2026-09-13): no number on the label and nothing
      // between it and the well, which is the slot a returning `meta` span takes.
      expect(heading.textContent).toBe(label);
      expect(heading.closest("section")?.className).toBe(PANEL_WELL);
      // the label is the well's first content — on the gray, not above it.
      expect(heading.closest("section")?.firstElementChild?.contains(heading)).toBe(true);
    }
  });

  it("holds no concave well anywhere in the panel", () => {
    const { container } = renderPanel();
    // `FIELD_WELL`'s own class.
    expect(container.innerHTML).not.toContain("concave-field");
    // kinds are a `SelectMenu` text face, not a native `<select>`.
    expect(container.querySelector("select")).toBeNull();
    // every attribute row carries the kind picker, not just an add row.
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
 * The 2026-09-13 ground. Asserted against the two imported halves, never against
 * `"rounded-[14px] bg-home-panel"`: spelled-out tokens would pass on a local copy.
 */
describe("each field section is a gray well of white bars", () => {
  it("builds the well out of the Token-spend well's geometry and /home's fill — no hairline", () => {
    expect(PANEL_WELL).toContain(SECTION_PANEL_SHELL);
    expect(PANEL_WELL).toContain("bg-home-panel");
    // no border (Samuel, 2026-09-13): the Overview's well has none.
    expect(PANEL_WELL).not.toMatch(/\bborder/);
    expect(PANEL_WELL).not.toContain(SECTION_PANEL_GROUND);
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
      // under the rows: the button is the rows column's last child, not a
      // composer strip above them or a footer outside the well.
      expect(well.lastElementChild?.lastElementChild).toBe(add);
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

/** `+ Add` appends a row, not a composer (Samuel, 2026-09-13). */
describe("+ Add appends an empty row with every cell on it", () => {
  it("shows name, kind and value at once, all empty", () => {
    renderPanel();
    const well = wellOf("Attributes");
    fireEvent.click(within(well).getByRole("button", { name: "Add" }));
    const row = bars(well)[1];
    expect(row).not.toBeUndefined();
    expect((row.querySelector('input[aria-label="Attribute label"]') as HTMLInputElement).value).toBe("");
    expect(row.querySelector('[aria-label="Attribute type"]')).not.toBeNull();
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

/**
 * Samuel, 2026-09-14: more room under the description, no gray rule on row cells
 * (black line on focus only), row ordered `Attribute : Value Dropdown`.
 *
 * Opposite halves of one ruling — the Description takes the board header's 36px
 * action face while the row cells lose their resting rule — so both are stated
 * against the shared module's class names (jsdom loads no stylesheet).
 */
describe("the 2026-09-14 field ruling", () => {
  it("gives the Description the board header's 36px face, not a hand-cut padding", () => {
    renderPanel();
    const field = screen.getByLabelText("Description");
    // catches a hand-cut `pb-2` here: identical until the header's face changes.
    expect(field.className).toMatch(/inputAction/);
    expect(field.className).not.toMatch(/inputQuiet/);
    expect(field.className).not.toMatch(/\bp[btxy]?-\d/);
  });

  it("leaves every ROW cell with no rule at rest — Description keeps its gray", () => {
    renderPanel();
    for (const label of ["Attribute label", "Value", "Edge label", "Action name", "Action tools"]) {
      expect(screen.getByLabelText(label).className).toMatch(/inputQuiet/);
    }
    expect(screen.getByLabelText("Description").className).not.toMatch(/inputQuiet/);
  });

  it("draws the black line only while a row cell is focused, and takes it away on blur", () => {
    renderPanel();
    const field = screen.getByLabelText("Attribute label");
    const line = field.parentElement!;
    expect(line.className).toMatch(/line/);
    expect(line.className).not.toMatch(/lineActive/);
    fireEvent.focus(field);
    expect(line.className).toMatch(/lineActive/);
    fireEvent.blur(field);
    expect(line.className).not.toMatch(/lineActive/);
  });

  it("orders the attribute row label : value dropdown ✕, with the colon a glyph", () => {
    renderPanel();
    const cells = Array.from(bars(wellOf("Attributes"))[0].children);
    expect(cells[0].querySelector('input[aria-label="Attribute label"]')).not.toBeNull();
    // the colon is the panel's, not the label's: typed into the label it would be
    // slugged into `key` and written to the server.
    expect(cells[1].textContent).toBe(":");
    expect(cells[1].getAttribute("aria-hidden")).toBe("true");
    expect((screen.getByLabelText("Attribute label") as HTMLInputElement).value).toBe("Stage");
    expect(cells[2].querySelector('input[aria-label="Value"]')).not.toBeNull();
    // the reorder: the kind picker no longer sits between label and value.
    expect(cells[3].getAttribute("aria-label")).toBe("Attribute type");
  });

  it("keeps that shape for a picker kind and for a viewer", () => {
    const REF_CARD: OntologyObject = {
      ...object(CARD_ID, "Acme"),
      attributes: [
        { key: "owner", label: "Owner", value: { kind: "ref", value: [LANE_ID] } },
      ],
    };
    render(
      <ObjectPanel
        objectId={CARD_ID}
        graph={{ clusters: [CLUSTER], objects: { [LANE_ID]: object(LANE_ID, "Lead"), [CARD_ID]: REF_CARD } }}
        dispatch={vi.fn()}
        canEdit={false}
        onSelectObject={vi.fn()}
        onDeleteObject={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const cells = Array.from(bars(wellOf("Attributes"))[0].children);
    // a ref value is a chip strip, not a field; the colon still sits in front.
    expect(cells[1].textContent).toBe(":");
    expect(cells[2].textContent).toContain("Lead");
    expect(cells[2].querySelector("input")).toBeNull();
    expect((screen.getByLabelText("Attribute label") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
  });
});

describe("the lane's own panel", () => {
  it("states what it is and how many items it has — still no pill", () => {
    renderPanel(LANE_ID);
    const top = screen.getByText("Object · 1");
    expect(top.className).not.toMatch(/rounded-full|border/);
    // The lane's panel carries the template section, in the same well as the rest.
    const section = screen.getByRole("heading", { name: "Default fields" }).closest("section");
    expect(section!.className).toBe(PANEL_WELL);
  });
});
