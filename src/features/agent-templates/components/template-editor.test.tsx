// @vitest-environment jsdom
/**
 * THE EDITOR — the fields, the body they become, and the surface rule.
 *
 * ⚠ THE LAST DESCRIBE IS A SOURCE READ, NOT A RENDER. Samuel's ruling for this
 * page (2026-08-22) is that **nothing on it is pressed in** — no `FIELD_WELL`,
 * no `.concave-field`, no `.concave-track`, no `SECTION_BOX_INSET`. That is a
 * property of the CLASS STRINGS, not of the DOM: jsdom loads no stylesheet, so a
 * rendered assertion would pass against a concave field and prove nothing. The
 * same shape as the token-purity checks elsewhere in this tree
 * (`billing/components/billing-page-screen.test.tsx › what the page deliberately
 * leaves out`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AgentTemplate } from "../client/types";
import { draftToCreateBody, type TemplateDraft } from "../lib/template-draft";
import { SECTIONS_CONTAINER } from "../lib/visibility";
import { TemplateEditor } from "./template-editor";

const TEAMS = [
  { id: "team-1", name: "Platform" },
  { id: "team-2", name: "Growth" },
];
const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: "Runs the checklist",
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "dopl" }],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/**
 * ⚠ `await`ed because `ModalShell` mounts a FRAME after `open` flips (it
 * animates in), so nothing is in the DOM on the render that asked for it — the
 * same reason `channels-v2/thread-manage.test.tsx` awaits its confirm.
 */
async function open(over: Partial<React.ComponentProps<typeof TemplateEditor>> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  render(
    <TemplateEditor
      open
      session={1}
      template={null}
      teams={TEAMS}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      {...over}
    />
  );
  await screen.findByRole("dialog");
  return { onSave, onDelete, onClose };
}

const field = (selector: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

/**
 * ⚠ SCOPED BY DIALOG NAME, ALWAYS. Adding a field opens a SECOND
 * `StandardDialog` over the editor (2026-08-27), so from that moment "Cancel"
 * is two buttons and `getByRole` on the bare name throws. Every add-field
 * interaction goes through this helper, or through
 * `within(screen.getByRole("dialog", { name: "Add field" }))`.
 */
async function addField(key: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  const dialog = await screen.findByRole("dialog", { name: "Add field" });
  fireEvent.change(field("#add-field-key"), { target: { value: key } });
  fireEvent.change(field("#add-field-value"), { target: { value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
}

afterEach(cleanup);

describe("what the editor renders", () => {
  it("carries every field a template IS", async () => {
    await open();
    expect(field("#agent-template-name")).toBeTruthy();
    expect(field("#agent-template-description")).toBeTruthy();
    expect(field("#agent-template-instructions")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add field" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach" })).toBeTruthy();
  });

  it("loads an existing template's values, chips included", async () => {
    await open({ template: template() });
    expect(field("#agent-template-name").value).toBe("Release captain");
    expect(field("#agent-template-instructions").value).toBe("Be terse.");
    expect(field('input[aria-label="Field 1 key"]').value).toBe("repo");
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
  });

  it("offers Delete only when there is something to delete", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    cleanup();
    await open({ template: template() });
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("puts the server's own wording on the alert line", async () => {
    await open({ error: "A template with that name already exists." });
    expect(screen.getByRole("alert").textContent).toBe(
      "A template with that name already exists."
    );
  });
});

describe("the visibility scopes the mount offers", () => {
  it("is the workspace's three by default, in `SECTIONS` order", async () => {
    await open();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Private", "Team", "Public"]);
  });

  it("🔒 is ONE inside a link container, and it is not called Public", async () => {
    // ⚠ A container has no teams (INVARIANTS §4A), so `team` there is a scope
    // that can never resolve to anybody — and `workspace` means "the other
    // people in this relationship", not "everyone in your company".
    // 🔒 ⚠ IT WAS **TWO** UNTIL 2026-08-27. `private` went with the /home pane's
    // per-channel private section: a container is not navigable, so a private
    // container template is now reachable from no surface at all — offering the
    // option would create write-only rows. The array IS the control, so the
    // array is where that door closes (`lib/visibility.ts`).
    await open({ sections: SECTIONS_CONTAINER });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Shared in this channel"]);
  });

  it("takes its LABELS from `lib/visibility.ts`, never from a literal here", async () => {
    // The point of the prop is that the container's headings and the pane's
    // headings are one array. A component hand-typing "Shared in this channel"
    // would pass every assertion above and drift on the first rename.
    await open({ sections: SECTIONS_CONTAINER });
    for (const section of SECTIONS_CONTAINER) {
      expect(screen.getByRole("tab", { name: section.label })).toBeTruthy();
    }
  });
});

describe("the team picker", () => {
  it("is ABSENT until the scope is Team", async () => {
    await open();
    // The Team SCOPE is a `tab` and always exists; the PICKER is the "Add team"
    // button and must not, or the editor asks for a grant it will discard.
    expect(screen.getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add team" })).toBeNull();
  });

  it("appears the moment the operator picks Team, and takes MORE than one", async () => {
    // ⚠ MULTI, because the server's `teamIds` is a set — a single-value control
    // would drop every other grant on the next save.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    fireEvent.click(screen.getByRole("button", { name: "Add team" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Growth" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "team",
      teamIds: ["team-1", "team-2"],
    });
  });

  it("refuses Save while a Team template names no team", async () => {
    await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    const save = screen.getByRole("button", { name: "Create template" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(
      (screen.getByRole("button", { name: "Create template" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("the save payload", () => {
  it("is the trimmed name plus the scope, and nothing the operator left empty", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "  Scout  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({ name: "Scout", visibility: "private" });
  });

  it("carries instructions, custom fields and attached bases", async () => {
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.change(field("#agent-template-instructions"), {
      target: { value: "Search first." },
    });
    await addField("repo", "dopl");
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft)).toEqual({
      name: "Scout",
      visibility: "private",
      instructions: "Search first.",
      fields: [{ key: "repo", value: "dopl" }],
      knowledgeBaseIds: ["kb-2"],
    });
  });

  it("adds nothing when the Add-field dialog is abandoned", async () => {
    // ⚠ THE OLD SHAPE OF THIS TEST ("drops a field ROW the operator added and
    // abandoned") described the inline `+` that appended a blank pair. Adding
    // is a dialog since 2026-08-27, so an abandoned add leaves no row at all —
    // the `cleanFields` backstop it used to exercise stays pinned in
    // `../lib/template-draft.test.ts`, where it does not depend on the chrome.
    const { onSave } = await open();
    fireEvent.change(field("#agent-template-name"), { target: { value: "Scout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    const draft = onSave.mock.calls[0][0] as TemplateDraft;
    expect(draftToCreateBody(draft).fields).toBeUndefined();
  });

  it("refuses a pair with no key — the value alone would vanish at save", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog", { name: "Add field" });
    const add = () => within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    fireEvent.change(field("#add-field-key"), { target: { value: "repo" } });
    expect(add().disabled).toBe(false);
  });
});

describe("delete is behind the confirm, and the copy says HARD", () => {
  it("does not fire until the confirmation is taken", async () => {
    const { onDelete } = await open({ template: template() });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // ⚠ The confirm is its own `ModalShell`, so it too arrives a frame later.
    const confirm = await screen.findByRole("button", { name: "Delete template" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("permanently deletes");
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("no concave surfaces", () => {
  // ⚠ SOURCE READ. jsdom loads no stylesheet, so the only honest place to pin a
  // SURFACE ruling is the class strings themselves.
  const ROOT = path.join(process.cwd(), "src", "features", "agent-templates");
  // ⚠ The UI half only. `server/` renders nothing and has no surface to get
  // wrong; sweeping it would make this suite fail for reasons that are not the
  // ruling, in a directory this page does not own.
  const UI_DIRS = ["components", "lib", "hooks", "client"];
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
    "SectionBox",
    // ⚠ ADDED 2026-09-01. `shared/ui/usage-meter.tsx › UsageMeter` IS a concave
    // surface — its whole recipe is a `.concave-track` well — so importing it
    // was a way to ship one past a sweep that only reads class STRINGS. Naming
    // the component closes that hole, and the sanctioned exception below is
    // what keeps the one Samuel ordered.
    "UsageMeter",
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      // The rule is about what the feature SHIPS; this file names the strings it
      // forbids, and a test asserting on itself is a false positive by
      // construction.
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
      return [full];
    });
  }

  /**
   * ⚠ THE SWEEP REACHES ACROSS TREES, AND IT HAS TO (2026-08-26, Q4 of
   * `docs/specs/home-agents-tab.plan.md`). The /home Agents face lives in the
   * SPA — a separate vitest project — but it renders THIS feature's panels and
   * cards, so a `SectionBox` there breaks the same ruling. This is a
   * `readFileSync` over SOURCE, not an import: the root project runs with
   * `process.cwd()` at the repo root, so the files resolve with no module
   * graph, no alias and no second config. **A mirrored sweep in the SPA suite
   * was the alternative and is worse** — two lists of forbidden recipes drift,
   * and the one that matters is whichever the author did not open.
   *
   * ⚠ **THE SWEEP IS /home's NOW, NOT JUST THE AGENTS FACE'S (2026-08-27).**
   * `knowledge-panels.tsx` joined it the day Samuel ruled the Knowledge
   * sections flat: they were `SectionBox` — a header strip over a CONCAVE inset
   * body — and are `shared/ui/section-panel.tsx › SectionPanel` on the page's
   * flat panel gray since. That is the same "nothing here is pressed in" rule
   * arriving on the second tab, so it is pinned the same way.
   *
   * ⚠ **DERIVED FROM THE DIRECTORY SINCE 2026-08-30, AND THE REASON IS A MISS.**
   * This was a HAND-TYPED LIST OF FIVE, under the sentence "a /home file that
   * renders a surface belongs in it" — and it did not contain
   * `pages/home/link-out-panel.tsx`, which renders a surface and was wearing
   * `FIELD_WELL`, the first entry in `FORBIDDEN`. **The enforcement mechanism
   * drifted from the ruling, not the ruling from the code**, and a list that
   * only a human adds to cannot catch the file the human did not think of. The
   * membership test is now the one the sentence always stated: every `.tsx` in
   * `pages/home/`, minus an explicit opt-out that has to say why.
   */
  const HOME_DIR = path.join(
    process.cwd(),
    "apps",
    "desktop-ui",
    "src",
    "pages",
    "home"
  );

  /**
   * ⚠ MAY ONLY EVER SHRINK, and each entry names a reason that is about the
   * file NOT BEING A SURFACE — never about it being inconvenient to fix.
   * `.test.tsx` files are excluded by the same rule `sources()` applies in this
   * tree: the suite names the strings it forbids, so a test asserting on itself
   * is a false positive by construction.
   */
  const HOME_NOT_SURFACES = new Set([
    // Render MACHINERY for the suites next to it — providers and fixtures, no
    // surface of its own. Deliberately not a `.test.tsx` name so vitest does
    // not collect it, which is why the extension filter cannot catch it.
    "home-test-harness.tsx",
  ]);

  /**
   * 🔒 **THE ONE SANCTIONED CONCAVE SURFACE ON /home (Samuel, 2026-09-01), AND
   * IT IS AN AMENDMENT TO THE RULING RATHER THAN A HOLE IN IT.**
   *
   * The Overview face's credit bar was built as an approximation of the billing
   * surface's — a hand-rolled track with a raised fill — precisely BECAUSE of
   * the no-concave rule. Samuel's correction is that the reference IS the spec:
   * the bar must be `billing/components/billing-usage-pane.tsx`'s "MCP credits"
   * meter, which is `shared/ui/usage-meter.tsx › UsageMeter`, which is a
   * `.concave-track`. A design reference cloned exactly beats a local surface
   * rule, and he said so after seeing the approximation.
   *
   * ⚠ **SCOPED TO ONE FILE AND ONE RECIPE.** Every other /home surface is still
   * swept, and this file is still swept for every OTHER forbidden string — the
   * exception is the pair, not the file. Widening it needs another ruling.
   */
  const HOME_CONCAVE_SANCTIONED: ReadonlyMap<string, string> = new Map([
    ["overview-sections.tsx", "UsageMeter"],
  ]);

  const HOME_FILES = readdirSync(HOME_DIR)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .filter((name) => !HOME_NOT_SURFACES.has(name))
    .sort()
    .map((name) => path.join(HOME_DIR, name));

  const FILES = [...UI_DIRS.flatMap((dir) => sources(path.join(ROOT, dir))), ...HOME_FILES];

  it("finds source files to check (a silent empty sweep would pass forever)", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  // ⚠ THE DERIVATION ITSELF IS ASSERTED. A scan that answered `[]` — a moved
  // directory, a changed extension convention — would make every /home case
  // below vacuously green, which is a quieter version of the miss that caused
  // the derivation in the first place.
  it("derives the /home surfaces, and reaches BOTH tabs' files", () => {
    expect(HOME_FILES.length).toBeGreaterThan(10);
    for (const name of ["knowledge-panels.tsx", "agent-panels.tsx", "link-out-panel.tsx"]) {
      expect(HOME_FILES).toContain(path.join(HOME_DIR, name));
    }
  });

  // …and the opt-out may not outlive its entries: a name that is no longer in
  // the directory is a comment claiming a fact.
  it.each([...HOME_NOT_SURFACES])("the opt-out entry %s still exists", (name) => {
    expect(existsSync(path.join(HOME_DIR, name))).toBe(true);
  });

  it.each(FILES)("%s wears no pressed-in recipe", (file) => {
    const source = readFileSync(file, "utf8");
    // Comments EXPLAIN the ruling by naming the classes it bans, so the check
    // runs over code lines only.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const sanctioned = HOME_CONCAVE_SANCTIONED.get(path.basename(file));
    for (const forbidden of FORBIDDEN) {
      // ⚠ ONE recipe is excused in ONE file, by name — see
      // `HOME_CONCAVE_SANCTIONED`. Everything else in that file is still swept.
      if (forbidden === sanctioned) continue;
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * ⚠ **THE EXCEPTION HAS TO BE LOAD-BEARING OR IT IS JUST A HOLE.** If the
   * credit bar ever stops using the billing meter, the carve-out must go with
   * it — otherwise the next surface to reach for `UsageMeter` in that file
   * inherits a permission nobody granted it.
   */
  it.each([...HOME_CONCAVE_SANCTIONED])(
    "the sanctioned concave surface %s really does use %s",
    (name, recipe) => {
      const file = path.join(HOME_DIR, name);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(recipe);
    }
  );

  /**
   * ⚠ THE RECIPE MOVED, THE RULE DID NOT (2026-08-27). `RAISED_INPUT` was
   * promoted out of `template-editor-rows.tsx` into `shared/ui/wells.ts` when
   * the four /home dialogs standardised onto this page's face, so the assertion
   * follows it: the SHARED recipe must still be built from `RAISED_WELL`, and
   * this page's rows must still be wearing that recipe rather than a fork.
   */
  it("uses the kit's RAISED well for its inputs", () => {
    const wells = readFileSync(
      path.join(process.cwd(), "src", "shared", "ui", "wells.ts"),
      "utf8"
    );
    expect(wells).toContain("export const RAISED_INPUT = `${RAISED_WELL}");
    const rows = readFileSync(path.join(ROOT, "components", "template-editor-rows.tsx"), "utf8");
    expect(rows).toContain("RAISED_INPUT");
  });

  /**
   * ⚠ THE SAME RULE, ARRIVING ON THE BUTTONS (Samuel, 2026-08-28). The dialog's
   * in-body controls — Add field, a row's Remove, the chip picker's
   * Attach/Add-team — hand-wrote THREE different heights and radii for one
   * class of control; they wear `shared/ui/open-scale-button.tsx`, the KB card
   * Open scale that /home's section buttons already carry. Source read for the
   * same reason as the sweep above: the pill is CSS, and jsdom loads none.
   *
   * ⚠ **WHAT THIS DELIBERATELY DOES NOT PIN** is the FOOTER. `DIALOG_BTN_*` is
   * the `StandardDialog` contract for both this dialog's pair and the Add-field
   * card's, and Delete is ink with no face at all by an older ruling of
   * Samuel's — a pill in either place would be this dialog closing differently
   * from every other one in the tree.
   */
  it("wears the kit's 26px pill on the buttons inside its body", () => {
    const rows = readFileSync(path.join(ROOT, "components", "template-editor-rows.tsx"), "utf8");
    expect(rows).toContain("OpenScaleButton");
    expect(rows).toContain("OpenScaleIconButton");
    // A hand-written pill FACE is what the ruling replaced, and the kit's
    // module is the only place that declaration lives now. The static CHIP
    // keeps its own rounded badge — it is not a button and never was.
    expect(rows).not.toContain("btn-light");
  });
});
