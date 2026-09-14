// @vitest-environment jsdom
/**
 * THE LAUNCH PICKER — the popover that CHOOSES a template.
 *
 * ⚠ **IT LAUNCHED, AND SINCE 2026-09-13 IT CHOOSES** (Samuel, over the deleted
 * `launch-sheet.tsx`: *"the popup should essentially be the same as that of a
 * normal agent launch, except the template is pre-selected"*). Three whole
 * sections left this file with the act: **the launch sheet** (six cases — the
 * file is deleted and its three jobs are the popup's Model row, its
 * **Instructions** field and the kit's footer), **the first-use approval modal**
 * (seven cases — that question is `channels-v2/use-agent-launch-run.ts ›
 * useLaunchRunner`'s now, on the ONE lane, and is pinned where the lane is), and
 * the two payload cases. What replaces them is one case: a pick hands the ROW up
 * and starts nothing. The WIRING — that the row opens the popup, prefilled, on
 * the tab's thread — is `channels-v2/agents-tab-launch.test.tsx`, because it is a
 * fact about the surface that mounts both.
 *
 * The properties pinned here are the ones a redesign loses quietly:
 *
 *  - **`Blank agent` IS ROW ONE AND IT IS THE SURFACE'S OWN DEFAULT ACT.** The
 *    picker never becomes the only way to start an agent; the halves that start
 *    one are pinned on their own surfaces (`channels-v2/agents-tab-launch.test.tsx`,
 *    `channels-v2/composer.test.tsx`).
 *  - **A ROW CLICK HANDS UP THE WHOLE TEMPLATE**, not its id — the popup prefills
 *    from the row, so a projection here would silently empty three fields.
 *  - **THE AUTHORSHIP MARKER IS IN THE ACCESSIBLE NAME**, not only on the face.
 *    It is the only signal shown to a human before another member's prose runs
 *    on this machine under this operator's credential (§4, injection surface).
 *  - **GROUP HEADERS ONLY WHEN THERE IS SOMETHING TO TELL APART**, in `SECTIONS`
 *    order, with "Public" as the label over the wire value `workspace`.
 *  - **THE SEARCH FIELD APPEARS PAST 8** and never re-hides itself on its own
 *    filtering.
 *
 * `useAgentTemplates` is MOCKED: what this file is about is what the picker
 * renders and which payload it hands the surface, not the transport underneath.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentTemplate } from "../client/types";

let templates: AgentTemplate[] = [];
let listError: unknown = null;
let listLoading = false;

vi.mock("../hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates,
    loading: listLoading,
    error: listError,
    refetch: () => {},
  }),
}));

const { TemplateLaunchPicker, authorMarker, SEARCH_THRESHOLD } = await import(
  "./template-picker"
);

const ME = "user-me";
const THEM = "user-them";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Code auditor",
    description: null,
    instructions: "Audit the diff. Report findings.",
    model: "claude-opus-5",
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const NAMES = new Map([
  [ME, "Sam Wang"],
  [THEM, "Diana Taylor"],
]);

function mount(
  over: Partial<React.ComponentProps<typeof TemplateLaunchPicker>> = {}
) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <TemplateLaunchPicker
      open
      at={{ x: 0, y: 0 }}
      onClose={onClose}
      workspaceId="ws-1"
      currentUserId={ME}
      memberNames={NAMES}
      onPick={onPick}
      {...over}
    />
  );
  return { onPick, onClose };
}

beforeEach(() => {
  templates = [];
  listError = null;
  listLoading = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("what the popover offers", () => {
  it("puts Blank agent first, focused, and chooses NO template", () => {
    templates = [template()];
    const { onPick, onClose } = mount();

    const rows = screen.getAllByRole("menuitem");
    const blank = screen.getByRole("menuitem", { name: /Blank agent/ });
    expect(rows[0]).toBe(blank);
    expect(document.activeElement).toBe(blank);

    fireEvent.click(blank);
    expect(onClose).toHaveBeenCalled();
    // ⚠ `null` IS THE BLANK AGENT and lands on the popup's `None`.
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("hands a row's WHOLE TEMPLATE up, and closes — it starts nothing", () => {
    // 🔒 MUTATION-PROOF: hand up `template.id` instead of the row and the first expectation
    // fails; leave the popover open and the second does. **Handing up the id is the regression
    // that matters**: the popup prefills Name / Description / Instructions FROM THIS OBJECT
    // (`channels-v2/use-agent-launch.ts › applyTemplate`), so an id arrives as three empty fields
    // and a title that cannot name the template.
    templates = [template({ id: "tpl-9" })];
    const { onPick, onClose } = mount();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(templates[0]);
  });

  it("offers ONE control per row — the launch-sheet chevron is gone with the sheet", () => {
    // ⚠ ONE `menuitem` PER TEMPLATE, not two. The chevron's whole job was
    // `launch-sheet.tsx`; a second control opening the same popup would be two ways to do one
    // thing, which is what Samuel's one-launch-surface ruling closes (INVARIANTS §5A).
    templates = [template({ id: "tpl-9" })];
    mount();
    expect(
      screen.queryByRole("menuitem", { name: "Launch options for Code auditor" })
    ).toBeNull();
    // Blank agent, then the one row.
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("renders a model chip only when the template carries a model", () => {
    templates = [
      template({ id: "a", name: "With model", model: "claude-opus-5" }),
      template({ id: "b", name: "No model", model: null }),
    ];
    mount();
    // ⚠ The chip is the SHORT label, and an unset model renders nothing at all
    // rather than "Default" — a row states what a template CARRIES.
    expect(screen.getByText("Opus")).toBeTruthy();
    expect(screen.queryByText("Default")).toBeNull();
  });

  it("says 'could not ask' rather than 'nothing to show' when the read failed", () => {
    listError = new Error("boom");
    mount();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No templates yet.")).toBeNull();
  });
});

/**
 * ⚠ THE MARKER IS A SECURITY SIGNAL, NOT DECORATION. A `team` / `workspace`
 * template's instructions are another member's text about to run on THIS machine
 * under THIS operator's credential, with their tool profile and their knowledge
 * reach. The fence stops WIDENING, not MISDIRECTION — this marker, and the
 * first-use approval below, are what address misdirection, and they do it by
 * informing a human rather than constraining a model.
 */
describe("the foreign-authorship marker", () => {
  it("is absent on the operator's own template", () => {
    templates = [template({ createdBy: ME })];
    mount();
    const row = screen.getByRole("menuitem", { name: /^Launch Code auditor/ });
    expect(row.getAttribute("aria-label")).toBe("Launch Code auditor");
    expect(screen.queryByText(/^by /)).toBeNull();
  });

  it("names the author on the face AND in the accessible name", () => {
    templates = [template({ createdBy: THEM, visibility: "team" })];
    mount();
    expect(screen.getByText("by Diana Taylor")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", {
        name: "Launch Code auditor (by Diana Taylor)",
      })
    ).toBeTruthy();
  });

  it("still marks a template whose author cannot be named — UNKNOWN is not MINE", () => {
    // A workspace member outside this channel's roster, and a creator who left
    // the workspace (`created_by` SET NULL) reach the same answer.
    expect(authorMarker(template({ createdBy: "user-ghost" }), ME, NAMES)).toBe(
      "by another member"
    );
    expect(authorMarker(template({ createdBy: null }), ME, NAMES)).toBe(
      "by another member"
    );
    expect(authorMarker(template({ createdBy: ME }), ME, NAMES)).toBeNull();
  });
});

describe("grouping and search", () => {
  function named(n: number, over: Partial<AgentTemplate> = {}) {
    return Array.from({ length: n }, (_, i) =>
      template({ id: `t${i}`, name: `Template ${i}`, ...over })
    );
  }

  it("renders NO group header when only one scope is non-empty", () => {
    templates = named(3, { visibility: "private" });
    mount();
    expect(screen.queryByText("Private")).toBeNull();
  });

  it("renders headers in SECTIONS order, with 'Public' over the wire's 'workspace'", () => {
    templates = [
      template({ id: "w", name: "Wide", visibility: "workspace" }),
      template({ id: "p", name: "Mine", visibility: "private" }),
    ];
    mount();
    const headers = screen
      .getAllByText(/^(Private|Team|Public)$/)
      .map((el) => el.textContent);
    expect(headers).toEqual(["Private", "Public"]);
    expect(screen.queryByText("workspace")).toBeNull();
  });

  it("hides the search field at the threshold and shows it past it", () => {
    templates = named(SEARCH_THRESHOLD);
    mount();
    expect(screen.queryByLabelText("Search templates")).toBeNull();
    cleanup();

    templates = named(SEARCH_THRESHOLD + 1);
    mount();
    expect(screen.getByLabelText("Search templates")).toBeTruthy();
  });

  it("filters on name, and does NOT take its own field away mid-word", () => {
    templates = named(SEARCH_THRESHOLD + 1);
    mount();
    const search = screen.getByLabelText("Search templates");
    fireEvent.change(search, { target: { value: "Template 3" } });
    expect(screen.getByRole("menuitem", { name: /^Launch Template 3/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Launch Template 4/ })).toBeNull();
    // ⚠ The threshold reads the WHOLE list, never the filtered one — a field
    // that vanished once its own filter narrowed the list would take the
    // operator's cursor with it.
    expect(screen.getByLabelText("Search templates")).toBeTruthy();
  });
});

/**
 * ⚠ SOURCE READ, like `./template-editor-surface.test.tsx › no concave surfaces`. jsdom
 * loads no stylesheet, so the only honest place to pin a SURFACE ruling is the
 * class strings themselves. That suite already sweeps every file under
 * `features/agent-templates/{components,lib,hooks,client}` — this names THE NEW
 * FILES explicitly so a future move that narrows the sweep cannot quietly drop
 * them from it.
 */
describe("no concave surfaces on the launch path", () => {
  const HERE = path.join(process.cwd(), "src", "features", "agent-templates");
  // ⚠ `launch-sheet.tsx` LEFT THIS LIST ON 2026-09-13 WITH THE FILE (Samuel's one-launch-surface
  // ruling). The sweep in `./template-editor-surface.test.tsx` reads the whole feature; this list
  // is the explicit half, so a path that no longer exists must come off it or every case here
  // fails on `readFileSync`.
  const NEW_FILES = [
    path.join(HERE, "components", "template-picker.tsx"),
    path.join(HERE, "components", "template-approval.tsx"),
    path.join(HERE, "lib", "launch-overrides.ts"),
  ];
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
  ];

  it.each(NEW_FILES)("%s wears no pressed-in recipe", (file) => {
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of FORBIDDEN) {
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ⚠ **"uses the kit's RAISED input recipe for the sheet's fields" LEFT WITH THE SHEET
  // (2026-09-13).** The popup's fields are the POPUP kit's underline
  // (`shared/ui/form-dialog.tsx › UnderlineField`), which is a different recipe with its own pins
  // in `channels-v2/launch-agent-dialog.test.tsx`; asserting `RAISED_INPUT` over a file that no
  // longer exists is not a weaker version of that, it is a `readFileSync` throw.
});
