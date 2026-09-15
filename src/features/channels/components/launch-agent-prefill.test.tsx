// @vitest-environment jsdom
/**
 * THE NEW-AGENT POPUP'S TEMPLATE PREFILL AND ITS INSTRUCTIONS FIELD (2026-09-13, Samuel's ruling
 * over the deleted `launch-sheet.tsx`).
 *
 * ⚠ ITS OWN FILE ON THE SEAM `launch-agent-dialog-runtime.test.tsx` already took: that file owns
 * the Runtime row's contract, `launch-agent-dialog.test.tsx` owns the field list, the selectors'
 * defaults, the payload parity and the two exits, and this owns **what a TEMPLATE does to the
 * form**. The dialog's suite stood at 429 of the 500-line cap; these cases did not fit, and
 * shaving their comments to make them fit would have been the cap deciding what a review may say.
 *
 * Samuel, verbatim, because these cases exist for these sentences: *"we should add an Instructions
 * field in the New agent popup. That should be a field under description, but don't make it like
 * multiple lines as the default height. it will only increase in height if the user types more. So
 * basically have that, so when a user clicks a template, all of those fields would be pre-filled.
 * And instead of the popup saying New Agent, it should say New (name of template) Agent. … an
 * individual agent from that template might have a different name the user might want to set. … The
 * agent popup will just have the name prefilled and the user can change the name if they want."*
 *
 * The four properties, all of which fail silently:
 *
 *  - **PICKING A TEMPLATE FILLS NAME, DESCRIPTION AND INSTRUCTIONS**, and the heading names it.
 *  - **AN EDITED FIELD IS NEVER OVERWRITTEN.** The only rule under which *"all of those fields
 *    would be pre-filled"* and *"the user can change the name if they want"* are both true — and
 *    the test is EDITED-SINCE-THE-LAST-PREFILL, not "non-empty", because the Name arrives holding
 *    the mint's `#<id>`.
 *  - **"None" PREFILLS NOTHING AND CLEARS NOTHING.** A selector going back to its first option may
 *    not blank three fields the operator can see.
 *  - **THE INSTRUCTIONS REACH THE WIRE ONLY WHEN THEY DIFFER FROM THE TEMPLATE'S OWN**
 *    (`use-agent-launch-run.ts › launchOverridesOf`) — `overridesFor`'s rule, applied to a third
 *    field: the field arrives PREFILLED, so a non-empty test would send the template's own prose
 *    back on every template launch.
 */

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));
// ⚠ THE DESKTOP REPORTS NOTHING HERE, deliberately: no Runtime row, no posture model. Every case
// in this file is about the three TEXT fields and the Template row, and a runtime pill in the tree
// would only add a way for these cases to fail for somebody else's reason.
vi.mock("../hooks/use-channel-launch-posture", () => ({
  useChannelLaunchPosture: () => ({
    posture: { model: null },
    modelSupported: false,
    runtimeSupported: false,
    runtimes: [],
    runtime: "",
    connected: [],
    connectedKnown: false,
    defaultRuntime: "",
  }),
}));

import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import { DIALOG_TITLE_AS_TYPED } from "@/shared/ui/standard-dialog";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, ME } from "./test-fixtures";

const MINTED = "k3v7d2mq";
const MEMBERS = [member({ userId: ME, displayName: "Sam Wang" })];

const mintAgentId = vi.fn();

function stubBridge() {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId,
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

function launcher(): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
  };
}

/** One template row as the roster hands it over. */
function auditor(over: Record<string, unknown> = {}) {
  return {
    id: "tpl-9",
    workspaceId: "ws-1",
    name: "Code auditor",
    description: "Audits the diff.",
    instructions: "Read the diff. Report findings.",
    model: null,
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

function Harness({ newAgent }: { newAgent: AgentLaunchControls }) {
  const panel = useAgentLaunch();
  // ⚠ `toggle` IS THE OPENER because it is what MINTS — the same reason
  // `launch-agent-dialog.test.tsx`'s harness uses it.
  useEffect(() => {
    panel.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      openThreadId="t-1"
      channelId="ch-1"
      workspaceId="ws-1"
      currentUserId={ME}
      members={MEMBERS}
    />
  );
}

const nameField = () => screen.getByLabelText("Agent name") as HTMLInputElement;
const descField = () => screen.getByLabelText("Agent description") as HTMLTextAreaElement;
const instrField = () => screen.getByLabelText("Agent instructions") as HTMLTextAreaElement;
const pill = (name: string | RegExp) => screen.getByRole("tab", { name });
const selected = (row: string) =>
  screen.getByRole("tablist", { name: row }).querySelector('[aria-selected="true"]')?.textContent;

async function open() {
  const controls = launcher();
  render(<Harness newAgent={controls} />);
  // ⚠ **THE MINT NO LONGER SHOWS UP IN THE NAME FIELD (Samuel, 2026-09-15: *"The name should be
  // blank"*), so this waited on a prefill that is gone.** The id is still minted and still
  // forwarded on the launch — it is the agent's ADDRESS — it is simply not rendered, so the
  // readiness signal is the CALL plus its settle rather than a value on screen.
  await waitFor(() => expect(mintAgentId).toHaveBeenCalled());
  // ⚠ AND THE DIALOG'S OWN MOUNT — `ModalShell` reveals on a rAF, which the old prefill
  // assertion happened to wait out as a side effect. The Launch button is the one control every
  // one of these popups has.
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
  return controls;
}

beforeEach(() => {
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  templateList.templates = [auditor()];
  stubBridge();
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
  templateList.templates = [];
});

// ── 1. THE INSTRUCTIONS FIELD ────────────────────────────────────────────────

describe("the Instructions field", () => {
  it("sits UNDER Description and starts at ONE row, growing with its own text", async () => {
    await open();
    // ⚠ ORDER IS SAMUEL'S (*"a field under description"*) and is asserted over the rendered tree
    // rather than over the source, so a reshuffle of the JSX cannot pass.
    const labels = screen
      .getAllByText(/^(Name|Description|Instructions|Template)$/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Name", "Description", "Instructions", "Template"]);
    // ⚠ **ONE ROW, AND THE GROWTH IS CSS** (*"don't make it like multiple lines as the default
    // height. it will only increase in height if the user types more"*): `rows=1` plus the kit's
    // `field-sizing: content` (`shared/ui/form-dialog.module.css › .inputMultiline`). jsdom loads
    // no stylesheet, so `rows` is the half that can be asserted on a rendered tree — and it is the
    // half a caller can get wrong, since `minRows` is what the old Description row raised.
    expect(instrField().rows).toBe(1);
    expect(instrField().tagName).toBe("TEXTAREA");
  });

  it("carries the operator's OWN prose onto the wire as an instructions override", async () => {
    // 🔒 MUTATION-PROOF: drop `overrides.instructions` from `launchOverridesOf` and only this case
    // fails — the untouched and template-equal cases below both expect it ABSENT.
    const controls = await open();
    fireEvent.change(instrField(), { target: { value: "Only look at the migrations." } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(vi.mocked(controls.launchAgent).mock.calls[0][2]).toEqual({
      instructions: "Only look at the migrations.",
    });
  });

  it("sends NOTHING when it was never touched, and nothing when it still equals the template's", async () => {
    // ⚠ THE SECOND HALF IS THE ONE THAT REGRESSES. A prefilled field plus a non-empty test sends
    // the template's own prose back on every template launch — a payload that only LOOKS like a
    // decision, and one that goes stale the moment the template is edited between open and Launch.
    const controls = await open();
    fireEvent.click(pill("Code auditor"));
    expect(instrField().value).toBe("Read the diff. Report findings.");
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(vi.mocked(controls.launchAgent).mock.calls[0][2]).toBeUndefined();
  });
});

// ── 2. THE PREFILL ───────────────────────────────────────────────────────────

describe("picking a template", () => {
  it("fills Name, Description and Instructions, and names itself in the heading", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy();
    fireEvent.click(pill("Code auditor"));
    expect(nameField().value).toBe("Code auditor");
    expect(descField().value).toBe("Audits the diff.");
    expect(instrField().value).toBe("Read the diff. Report findings.");
    // ⚠ THE STRING IS THE ACCESSIBLE NAME and the Title Case an operator reads is CSS
    // (`standard-dialog.tsx › DIALOG_TITLE` carries `capitalize`), which is why this matches the
    // value rather than "New Code Auditor Agent".
    expect(screen.getByRole("dialog", { name: "New Code auditor agent" })).toBeTruthy();
  });

  it("DISPLAYS the template's model without stamping it — the row moves, the wire does not", async () => {
    // ⚠ THE ONE FIELD DELIBERATELY LEFT OUT OF THE PREFILL. `effectiveModel` shows the template's
    // model while `panel.model` stays `''`, so main's precedence chain
    // (`session-launch-op.js`: overrides > template > channel > SDK) stays the one authority.
    // 🔒 MUTATION-PROOF: add `setModel(template.model)` to `applyTemplate` and the second half
    // fails while the first still passes.
    templateList.templates = [auditor({ model: "claude-opus-5" })];
    const controls = await open();
    fireEvent.click(pill("Code auditor"));
    expect(selected("Agent model")).toBe("Opus 5");
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(vi.mocked(controls.launchAgent).mock.calls[0][2]).toBeUndefined();
  });

  it("never overwrites a field the operator EDITED — the name included", async () => {
    // ⚠ *"an individual agent from that template might have a different name the user might want to
    // set."* The mint's `#<id>` is NOT an edit, which is the distinction the `touched` ref exists
    // for: a non-empty test would make the Name unprefillable, and a blind overwrite would take the
    // operator's own name away every time they browsed a second template.
    await open();
    fireEvent.change(nameField(), { target: { value: "Migrations reviewer" } });
    fireEvent.change(descField(), { target: { value: "Mine." } });
    fireEvent.click(pill("Code auditor"));
    expect(nameField().value).toBe("Migrations reviewer");
    expect(descField().value).toBe("Mine.");
    // The one field they did not touch still fills in.
    expect(instrField().value).toBe("Read the diff. Report findings.");
  });

  it("re-prefills from the NEXT template, because clicking past one is not editing it", async () => {
    templateList.templates = [auditor(), auditor({ id: "tpl-2", name: "Scribe", description: "Writes it up.", instructions: "Summarise." })];
    await open();
    fireEvent.click(pill("Code auditor"));
    fireEvent.click(pill("Scribe"));
    expect(nameField().value).toBe("Scribe");
    expect(descField().value).toBe("Writes it up.");
    expect(instrField().value).toBe("Summarise.");
  });
});

// ── 3. "None" ────────────────────────────────────────────────────────────────

/**
 * 🔒 **THE HEADING CARRIES A NAME THE OPERATOR TYPED, SO ITS CASING IS LEFT ALONE**
 * (2026-09-14; `shared/ui/standard-dialog.tsx › DIALOG_TITLE_AS_TYPED`).
 *
 * ⚠ **THE KIT'S DEFAULT IS `text-transform: capitalize`** (Samuel's Title-Case ruling for
 * AUTHORED headings), and it rewrites the first letter of EVERY word — so a template named
 * "iOS Coder" rendered "New IOS Coder Agent": the dialog misspelling the row it is about. The
 * string is never cased in JS (it is `ModalShell`'s `aria-label` too), so the fix is the opt-out
 * prop, and the pin is the CLASS rather than the text.
 *
 * 🔒 MUTATION-PROOF: drop `titleCase={false}` from `launch-agent-dialog.tsx` and the heading
 * takes `DIALOG_TITLE` — which carries `capitalize` — and this fails.
 */
describe("the heading's casing", () => {
  it("renders the template's name as typed, never Title-Cased by CSS", async () => {
    templateList.templates = [auditor({ id: "tpl-ios", name: "iOS Coder" })];
    await open();
    fireEvent.click(pill(/iOS Coder/));
    const heading = await screen.findByRole("heading", { name: "New iOS Coder agent" });
    // ⚠ THE CLASS, NOT THE RENDERED PIXELS: jsdom applies no `text-transform`, so an assertion
    // on `textContent` would pass against the capitalising face and prove nothing.
    expect(heading.className).not.toContain("capitalize");
    expect(heading.className).toBe(DIALOG_TITLE_AS_TYPED);
  });
});

describe("clearing the template", () => {
  it("keeps whatever is in the three fields, and takes the heading back", async () => {
    // 🔒 MUTATION-PROOF: make `applyTemplate(null)` prefill from an empty template (drop its early
    // return) and all three values blank — three fields the operator can see, cleared by a
    // selector going back to its first option, with no undo.
    const controls = await open();
    fireEvent.click(pill("Code auditor"));
    fireEvent.change(instrField(), { target: { value: "Mine now." } });
    fireEvent.click(pill("None"));
    expect(nameField().value).toBe("Code auditor");
    expect(descField().value).toBe("Audits the diff.");
    expect(instrField().value).toBe("Mine now.");
    expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy();
    // ⚠ AND THE WIRE FOLLOWS THE SELECTOR: no template, and the typed prose is an override in its
    // own right (the BLANK lane's instructions are a known gap in MAIN, not here — F-695).
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    const [, templateId, overrides] = vi.mocked(controls.launchAgent).mock.calls[0];
    expect(templateId).toBeNull();
    expect(overrides).toEqual({ instructions: "Mine now." });
  });
});

// ── 4. CLOSING IS DISCARDING, BY WHICHEVER EXIT (2026-09-14) ─────────────────

/**
 * 🔒 **THE THREE EXITS ARE ONE PATH.** Escape and the backdrop reached `reset()`
 * (`launch-agent-dialog.tsx › discard`); the Bot icon and the pop-out's `+` — the same control
 * that OPENED the form — reached a bare `setOpen(false)`. So a dialog dismissed by its own
 * button kept every typed field, the instructions BASELINE and the `touched` flags, and the
 * reopen MINTED A SECOND ID under the first one's name.
 *
 * ⚠ **IT DRIVES THE HOOK, NOT THE DIALOG.** The defect is in `use-agent-launch.ts`'s two close
 * paths; mounting the form would add a scrim and a portal to assert a state transition.
 */
function ToggleHarness() {
  const panel = useAgentLaunch();
  return (
    <div>
      <button type="button" onClick={panel.toggle}>
        toggle
      </button>
      <button type="button" onClick={() => panel.applyTemplate?.(auditor())}>
        pick
      </button>
      <output data-testid="state">
        {panel.open ? "open" : "shut"}|{panel.name}|{panel.description}|
        {panel.instructions ?? ""}|{panel.templateId ?? ""}|{panel.agentId ?? ""}
      </output>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent ?? "";
const toggle = () => fireEvent.click(screen.getByRole("button", { name: "toggle" }));

describe("closing the popup with the control that opened it", () => {
  /**
   * 🔒 MUTATION-PROOF: put `setOpen(false)` back in `toggle`'s open branch and this fails on the
   * very first assertion — the typed name survives a close it should not have survived.
   */
  it("discards the typed identity, exactly as Escape does", async () => {
    mintAgentId.mockResolvedValue({ ok: true, agentId: MINTED });
    render(<ToggleHarness />);
    toggle();
    // ⚠ **THE PANEL'S VISIBLE SIGNAL IS THE ID, NOT `#<id>`, SINCE 2026-09-15** — the name field
    // opens blank (Samuel: *"The name should be blank"*) and this harness prints `panel.agentId`
    // in the same `state()` string, which is the half that was ever load-bearing here.
    await waitFor(() => expect(state()).toContain(MINTED));
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(state()).toContain("Code auditor");

    toggle();
    expect(state()).toBe("shut|||||");
  });

  /**
   * 🔒 **AND THE REOPEN DOES NOT MINT A SECOND ID UNDER THE FIRST ONE'S NAME** — the 2026-08-27
   * two-draw bug arriving by another road. With the state cleared, the fresh mint's `typed === ""`
   * guard fires and the panel shows ONE agent's address over that same agent's name.
   */
  it("re-prefills from the new mint, and a template still fills the fields in", async () => {
    mintAgentId.mockResolvedValue({ ok: true, agentId: MINTED });
    render(<ToggleHarness />);
    toggle();
    await waitFor(() => expect(state()).toContain(MINTED));
    toggle();

    mintAgentId.mockResolvedValue({ ok: true, agentId: "zz99yy88" });
    toggle();
    await waitFor(() => expect(state()).toContain("zz99yy88"));
    // ⚠ NO TRACE OF THE FIRST DRAW: the name and the id are the SAME agent's.
    expect(state()).not.toContain(MINTED);
    // ⚠ AND `touched` WENT WITH IT, so a template pick prefills again rather than finding a
    // field the operator is believed to have typed.
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(state()).toContain("Code auditor");
  });
});
