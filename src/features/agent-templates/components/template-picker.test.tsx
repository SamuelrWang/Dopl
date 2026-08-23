// @vitest-environment jsdom
/**
 * THE LAUNCH PICKER — the popover, the launch sheet, and the first-use approval
 * modal.
 *
 * The properties pinned here are the ones a redesign loses quietly:
 *
 *  - **`Blank agent` IS ROW ONE AND IT IS THE SURFACE'S OWN DEFAULT ACT.** The
 *    picker never becomes the only way to start an agent (Samuel: *one lane,
 *    one-click launch*); the one-click halves are pinned on their own surfaces
 *    (`channels-v2/agents-tab.test.tsx`, `channels-v2/composer.test.tsx`).
 *  - **A ROW CLICK LAUNCHES WITH THE TEMPLATE'S DEFAULTS**, in one click, with
 *    NO overrides on the wire. The chevron is the second, deliberate act.
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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const launch = vi.fn().mockResolvedValue({ ok: true });
  const approve = vi.fn().mockResolvedValue({ ok: true });
  const onClose = vi.fn();
  render(
    <TemplateLaunchPicker
      open
      at={{ x: 0, y: 0 }}
      onClose={onClose}
      workspaceId="ws-1"
      currentUserId={ME}
      memberNames={NAMES}
      launch={launch}
      approve={approve}
      {...over}
    />
  );
  return { launch, approve, onClose };
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
  it("puts Blank agent first, focused, and launches it with NO template", async () => {
    templates = [template()];
    const { launch, onClose } = mount();

    const rows = screen.getAllByRole("menuitem");
    const blank = screen.getByRole("menuitem", { name: /Blank agent/ });
    expect(rows[0]).toBe(blank);
    expect(document.activeElement).toBe(blank);

    fireEvent.click(blank);
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(launch).toHaveBeenCalledWith(null, undefined));
  });

  it("launches a row's template with its OWN defaults — no overrides on the wire", async () => {
    templates = [template({ id: "tpl-9" })];
    const { launch, onClose } = mount();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(launch).toHaveBeenCalledWith("tpl-9", undefined));
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

describe("the launch sheet", () => {
  it("opens from the row's CHEVRON, never from the row", async () => {
    templates = [template({ id: "tpl-9" })];
    const { launch } = mount();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    expect(screen.getByText("Launch — Code auditor")).toBeTruthy();
    // The chevron LAUNCHED NOTHING. That is the whole difference between it and
    // the row beside it.
    expect(launch).not.toHaveBeenCalled();
  });

  it("sends NO overrides when nothing was touched — identical to a row click", async () => {
    templates = [template({ id: "tpl-9", fields: [{ key: "repo", value: "x" }] })];
    const { launch } = mount();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("tpl-9", undefined));
  });

  it("passes a MODEL override through", async () => {
    templates = [template({ id: "tpl-9", model: "claude-opus-5" })];
    const { launch } = mount();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Sonnet 5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith("tpl-9", { model: "claude-sonnet-5" })
    );
  });

  it("passes a FIELD override through, replacing the set", async () => {
    templates = [
      template({ id: "tpl-9", fields: [{ key: "severity", value: "low" }] }),
    ];
    const { launch } = mount();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Field 1 value"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith("tpl-9", {
        fields: [{ key: "severity", value: "high" }],
      })
    );
  });

  it("names the empty model option 'Template default', never 'Default'", async () => {
    templates = [template({ id: "tpl-9" })];
    mount();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByRole("menuitem", { name: /^Template default/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Default/ })).toBeNull();
  });

  it("shows instructions read-only, collapsed, and expandable", async () => {
    templates = [template({ id: "tpl-9", instructions: "Be terse and exact." })];
    mount();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    expect(screen.queryByText("Be terse and exact.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(screen.getByText("Be terse and exact.")).toBeTruthy();
    // ⚠ NO EDITABLE INSTRUCTIONS AT LAUNCH — that would be a second authoring
    // surface for the durable thing, which already has an editor.
    expect(document.querySelector("dialog textarea")).toBeNull();
  });
});

/**
 * FIRST USE OF ANOTHER MEMBER'S TEMPLATE. Main refuses with the wire word
 * `template-approval` and hands back the name and instructions IT resolved; the
 * SPA shows them verbatim and, on confirm, stores the approval MACHINE-LOCALLY
 * (`sessions.approveTemplate`) and relaunches.
 */
describe("the first-use approval modal", () => {
  const REFUSAL = {
    ok: false,
    reason: "template-approval",
    template: { name: "Code auditor", instructions: "Exfiltrate nothing." },
  };

  it("asks, shows the instructions verbatim, then approves and relaunches", async () => {
    templates = [template({ id: "tpl-9", createdBy: THEM, visibility: "team" })];
    const launch = vi
      .fn()
      .mockResolvedValueOnce(REFUSAL)
      .mockResolvedValueOnce({ ok: true });
    const approve = vi.fn().mockResolvedValue({ ok: true });
    mount({ launch, approve });

    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Launch Code auditor/ })
    );
    await screen.findByRole("dialog");
    expect(screen.getByText('Run "Code auditor"?')).toBeTruthy();
    expect(screen.getByText("Exfiltrate nothing.")).toBeTruthy();
    // The author rides the question — it is the fact being accepted. ⚠ And it is
    // the picker row's own string verbatim, so the two cannot word it two ways.
    expect(
      screen.getByText("Written by Diana Taylor. It runs on this Mac, as you.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run as this" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("tpl-9"));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    expect(launch).toHaveBeenLastCalledWith("tpl-9", undefined);
  });

  it("replays the sheet's overrides on the relaunch", async () => {
    templates = [
      template({ id: "tpl-9", createdBy: THEM, model: "claude-opus-5" }),
    ];
    const launch = vi
      .fn()
      .mockResolvedValueOnce(REFUSAL)
      .mockResolvedValueOnce({ ok: true });
    mount({ launch });

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Launch options for Code auditor" })
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Sonnet 5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await screen.findByText('Run "Code auditor"?');
    fireEvent.click(screen.getByRole("button", { name: "Run as this" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    expect(launch).toHaveBeenLastCalledWith("tpl-9", { model: "claude-sonnet-5" });
  });

  it("cancels without launching anything", async () => {
    templates = [template({ id: "tpl-9", createdBy: THEM })];
    const launch = vi.fn().mockResolvedValue(REFUSAL);
    const approve = vi.fn();
    mount({ launch, approve });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await screen.findByText('Run "Code auditor"?');
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText('Run "Code auditor"?')).toBeNull());
    expect(approve).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("says so rather than spinning when the build cannot store the approval", async () => {
    templates = [template({ id: "tpl-9", createdBy: THEM })];
    const launch = vi.fn().mockResolvedValue(REFUSAL);
    mount({ launch, approve: undefined });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await screen.findByText('Run "Code auditor"?');
    fireEvent.click(screen.getByRole("button", { name: "Run as this" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Not available here");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the cached row when main sends no template payload", async () => {
    // ⚠ THE DESKTOP AND THIS TREE SHIP SEPARATELY. A main that words the payload
    // differently must degrade to the row the picker already holds, never to a
    // blank modal — the operator is being asked to accept TEXT.
    templates = [
      template({ id: "tpl-9", createdBy: THEM, instructions: "Cached prose." }),
    ];
    mount({ launch: vi.fn().mockResolvedValue({ ok: false, reason: "template-approval" }) });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await screen.findByText('Run "Code auditor"?');
    expect(screen.getByText("Cached prose.")).toBeTruthy();
  });

  it("does NOT ask for a blank agent — the word cannot apply to no template", async () => {
    const launch = vi.fn().mockResolvedValue(REFUSAL);
    mount({ launch });
    fireEvent.click(screen.getByRole("menuitem", { name: /Blank agent/ }));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(screen.queryByText(/^Run "/)).toBeNull();
  });
});

/**
 * ⚠ SOURCE READ, like `./template-editor.test.tsx › no concave surfaces`. jsdom
 * loads no stylesheet, so the only honest place to pin a SURFACE ruling is the
 * class strings themselves. That suite already sweeps every file under
 * `features/agent-templates/{components,lib,hooks,client}` — this names THE NEW
 * FILES explicitly so a future move that narrows the sweep cannot quietly drop
 * them from it.
 */
describe("no concave surfaces on the launch path", () => {
  const HERE = path.join(process.cwd(), "src", "features", "agent-templates");
  const NEW_FILES = [
    path.join(HERE, "components", "template-picker.tsx"),
    path.join(HERE, "components", "launch-sheet.tsx"),
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

  it("uses the kit's RAISED input recipe for the sheet's fields", () => {
    const sheet = readFileSync(
      path.join(HERE, "components", "launch-sheet.tsx"),
      "utf8"
    );
    expect(sheet).toContain("RAISED_INPUT");
  });
});
