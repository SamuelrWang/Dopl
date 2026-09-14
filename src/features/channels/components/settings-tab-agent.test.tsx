// @vitest-environment jsdom
/**
 * THE AGENT HALF OF THE SETTINGS TAB — Tool access, the Working Folder row, and
 * the Launch-agents control.
 *
 * ⚠ Split out of `settings-tab.test.tsx` (2026-09-14, 500-line cap), which keeps
 * the CHANNEL rows and the two absence suites; that file's header carries the
 * two deleted suites this pair inherits and the minimal-copy bound both halves
 * are held to. Shared helpers live in `_settings-tab-fixtures.ts` — neither half
 * keeps a second copy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { agentView, copy, desktopSource, disabled } from "./settings-agent-harness";
import { noop, row } from "./_settings-tab-fixtures";
import { UNRESOLVED_TOOL_PROFILE } from "../constants";

afterEach(cleanup);

const TOOL_PROFILES = desktopSource("tool-profiles.js");

/** The Working Folder picker. ⚠ By `aria-label`: its visible text is a path, so the
 *  accessible name states the act instead (`settings-desktop-rows.tsx`). */
const folderPicker = () =>
  screen.getByLabelText("Change the working folder for this channel's agents");

/**
 * ⚠ TOOL ACCESS IS A DROPDOWN SINCE 2026-09-06 (item 6), SO ITS OPTIONS ONLY EXIST
 * WHILE THE MENU IS OPEN. This helper opens it first, which is also what a person
 * does — and it is the reason the three cases below could not simply be repointed
 * from `role="radio"` to `role="menuitem"`: the old radiogroup rendered all three
 * options standing on the tab, and the whole point of item 6 is that they no longer
 * do. A helper that hid the open step would let a case pass against a control that
 * never opens.
 */
const toolAccessTrigger = () =>
  screen.getByLabelText("Tool access for agents on this channel");
const openToolAccess = () => {
  fireEvent.click(toolAccessTrigger());
};
const option = (name: RegExp | string) => screen.getByRole("menuitem", { name });

describe("Tool access — every profile says what it means, in a few words", () => {
  // ⚠ 2026-09-06 (item 6): the row is a DROPDOWN named "Tool access" now. The three
  // containment lines are NOT lost — they ride `TOOL_PROFILE_OPTIONS.description` into
  // the `SelectMenu`, which is where this tab already says per-option copy belongs
  // ("where a person reads them while choosing"). The eye popover carries the same
  // words for a reader who is not choosing. This case still asserts the lines are
  // present and still cross-checks them against what each profile actually grants.
  it("shows all three with their short lines, and matches what each is granted", () => {
    // ⚠ THE MENU IS OPENED FIRST, because the lines live INSIDE it now. Asserting
    // them against the closed tab would be asserting the thing item 6 removed.
    const { container } = agentView();
    openToolAccess();
    for (const label of ["Full access", "Dopl only", "Read only"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeTruthy();
    }
    const text = document.body.textContent ?? "";
    // ⚠ Never a bare enum name — asserted on the TAB, not the open menu, because the
    // menu's own `value` attributes are not rendered text and never were.
    for (const value of ["full", "dopl_only", "read_only"]) {
      expect(container.textContent ?? "").not.toContain(value);
    }
    // ⚠ THE ONLY PER-OPTION DESCRIPTIONS LEFT IN THE PRODUCT, ≤5 words each
    // (Samuel, 2026-08-19). Tool access keeps them because it is the CONTAINMENT
    // pick, and they now sit where a person reads them while choosing.
    expect(text).toContain("Everything, including connected apps");
    expect(text).toContain("Files, web, and Dopl");
    expect(text).toContain("Local files only");
    expect(TOOL_PROFILES).toContain("full: [],");
    // ⚠ REPOINTED 2026-09-02 (Wave B batch 1). `full`'s one flag used to be spelled inline as
    // `if (p === 'full') return ['--disallowedTools', UNIVERSAL_HARD_DENY…`. The fourth profile
    // (`channel_agent`) takes the SAME one-flag shape over a longer list, so that branch became
    // a predicate plus the shared deny builder. What this case is about is unchanged and is
    // asserted over both lines: `full` is granted everything except the deny floor.
    expect(TOOL_PROFILES).toMatch(
      /if \(isUnboundedProfile\(p\)\) return \['--disallowedTools', buildDeniedTools\(p\)/
    );
    expect(TOOL_PROFILES).toMatch(
      /if \(p === 'full'\) return \[\.\.\.UNIVERSAL_HARD_DENY\];/
    );
    expect(TOOL_PROFILES).toContain(
      "dopl_only: [...READ_BUILTINS, ...WEB_TOOLS, ...DOPL_SAFE_TOOLS]"
    );
    expect(TOOL_PROFILES).toContain("read_only: [...READ_BUILTINS]");
  });

  it("does not generalize the deny floor, which differs between the two lanes", () => {
    // ⚠ `full` carries UNIVERSAL_HARD_DENY, but the SDK lane's SESSION_HARD_DENY
    // is BROADER on purpose — so "destructive tools are always denied" would be
    // true on one lane and wrong on the other. The copy describes what is
    // GRANTED instead, and ranks nothing as the safe answer.
    const text = copy();
    expect(text).not.toMatch(/always denied|never allowed|hard.?den/i);
    expect(text).not.toMatch(/\bsafe\b|\bsecure\b|\bprotected\b/i);
    expect(text).not.toMatch(/recommended|safest|safer|most secure/i);
    expect(TOOL_PROFILES).toContain(
      "const UNIVERSAL_HARD_DENY = [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS]"
    );
    expect(TOOL_PROFILES).toContain("dopl_only MORE dangerous than full");
  });

  it("marks exactly one profile checked, and resolves an absent one the DESKTOP's way", () => {
    // ⚠ Desktop `normalizeProfile` resolves unknown/missing to read_only. A web
    // fallback of `"full"` is a fail-OPEN label over a session the machine runs
    // read_only. One answer, both sides.
    expect(UNRESOLVED_TOOL_PROFILE).toBe("read_only");
    expect(TOOL_PROFILES).toMatch(
      /function normalizeProfile[\s\S]*?return 'read_only';/
    );
    agentView({ profile: UNRESOLVED_TOOL_PROFILE });
    // ⚠ THE TRIGGER IS THE STATEMENT NOW, not three standing options: a closed
    // dropdown names exactly one profile, which is a stronger version of "marks
    // exactly one checked" than three `aria-checked` reads were.
    expect(toolAccessTrigger().textContent).toContain("Read only");
    // ⚠ **THE THREE `aria-checked` READS ARE DELETED, NOT REPAIRED (2026-09-07).** They were
    // `role="radio"` semantics and this control is a `SelectMenu`: `popover-menu.tsx › MenuItem`
    // renders `role="menuitem"` with NO `aria-checked` at all — it marks the active option with a
    // check glyph and a selected background — so all three reads returned `null` and the case was
    // asserting against a property this menu has never had. The comment above already says what
    // replaced them, and it is the stronger claim: a CLOSED dropdown names exactly one profile,
    // which is "exactly one is checked" stated where the operator actually reads it.
    // ⚠ WHAT IS KEPT is that the roster is not silently narrowed — the pick must still be
    // reachable, and a menu that dropped an option would leave the trigger telling the truth.
    openToolAccess();
    expect(option(/Read only/)).toBeTruthy();
    expect(option(/Full access/)).toBeTruthy();
    expect(option(/Dopl only/)).toBeTruthy();
  });

  it("picks through the caller's cloud mutation, and refuses a re-pick", () => {
    const onSetToolProfile = vi.fn();
    agentView({ onSetToolProfile });
    openToolAccess();
    fireEvent.click(option(/Read only/));
    expect(onSetToolProfile).toHaveBeenCalledWith("read_only");
    // Already-selected is a no-op, not a second write. ⚠ `full` is the fixture's
    // profile, so re-picking it must write nothing — the guard lives in the row's
    // own `onChange` as well as in `SelectMenu`, deliberately: this write routes
    // through the posture WARNING, and firing that dialog for a no-op pick would
    // train the operator to dismiss it.
    openToolAccess();
    fireEvent.click(option(/Full access/));
    expect(onSetToolProfile).toHaveBeenCalledTimes(1);
  });

  it("goes inert while the durable write is in flight", () => {
    const onSetToolProfile = vi.fn();
    agentView({ toolProfileBusy: true, onSetToolProfile });
    // ⚠ THE TRIGGER IS WHAT GOES INERT — a disabled dropdown never opens, so there
    // is no option to click. That is a stricter refusal than the old disabled
    // radios, which were still in the tree and still clickable by a test.
    expect(disabled(toolAccessTrigger())).toBe(true);
    fireEvent.click(toolAccessTrigger());
    expect(screen.queryByRole("menuitem", { name: /Read only/ })).toBeNull();
    expect(onSetToolProfile).not.toHaveBeenCalled();
  });
});

describe("the Working Folder row", () => {
  /**
   * ⚠ THE DEFAULT IS NOW A REAL DIRECTORY, NOT A WORD THIS TREE OWNS (2026-09-05,
   * task 15). `label` was `null` here and the row printed "Sandbox (default)" over
   * it — naming a place that does not exist, on the one row that claims to say
   * where the operator's agent runs. Main answers the EFFECTIVE folder always
   * (`channel-dirs.js › resolvedDirLabel`, read through the same function that
   * produces the spawn cwd), and `custom` carries the question the null was
   * standing in for. ⚠ Do not reintroduce a literal default label in this file: an
   * assertion this suite can spell is one the renderer could invent again.
   */
  const folder = {
    label: "~/Downloads" as string | null,
    custom: false,
    busy: false,
    onChoose: noop,
    onClear: noop,
  };

  it("names the EFFECTIVE default folder, and the NAME is the picker button", () => {
    // ⚠ 2026-09-06 (item 4): the separate "Change folder…" button is DELETED and the
    // folder name itself — underlined text, a real `<button>` — opens the picker. The
    // row is a NAME and a CONTROL on one line, which is the shape this tab states.
    // What this case pinned before is unchanged: the label is a real directory, never
    // a word this tree invented.
    const text = copy({ folder: { ...folder } });
    expect(text).toContain("Working Folder");
    expect(text).toContain("~/Downloads");
    expect(text).not.toContain("Sandbox");
    expect(row("Change folder…")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Change the working folder for this channel's agents",
      })
    ).toBeTruthy();
    // ⚠ GATED ON `custom`, NOT on having a label to show — the reset must not be
    // offered on a channel that is already on the default.
    expect(row("Use default")).toBeNull();
  });

  it("shows the abbreviated label and both actions once a folder is set", () => {
    // ⚠ The bridge only ever hands back an abbreviation; the absolute path never
    // reaches this page, so the row renders what it was given and no more.
    const onChoose = vi.fn();
    const onClear = vi.fn();
    const { container } = agentView({
      folder: {
        ...folder,
        label: "~/Downloads/repo",
        custom: true,
        onChoose,
        onClear,
      },
    });
    expect(container.textContent).toContain("~/Downloads/repo");
    // ⚠ 2026-09-06 (item 4): the folder NAME is the picker button now. "Use default"
    // is unchanged and still gated on `custom` — kept deliberately, since it is the
    // only way back to the desktop default once a folder is set.
    // ⚠ THE PICKER IS NAMED BY ITS `aria-label`, NOT BY ITS TEXT, and that is deliberate:
    // the visible content is a PATH, so the accessible name states the ACT instead
    // (`settings-desktop-rows.tsx`). Querying it by the path found nothing.
    fireEvent.click(folderPicker());
    fireEvent.click(row("Use default")!);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("says the picker is open rather than looking idle", () => {
    agentView({ folder: { ...folder, label: "~/repo", custom: true, busy: true } });
    // ⚠ Named by the ACT, worded by the STATE — see the case above.
    expect(folderPicker().textContent).toContain("Opening picker…");
    expect(disabled(folderPicker())).toBe(true);
  });
});

/**
 * ORCHESTRATOR LAUNCHES — the one PER-MACHINE control on a per-channel tab
 * (2026-08-22).
 *
 * ⚠ THE FAILURE THIS GUARDS IS A MISREAD, NOT A CRASH. Every other group here
 * governs `(this channel, this Mac)`. An operator who reads this one the same
 * way turns it on "for #website" and has in fact handed an external Claude
 * session their whole machine, every channel. **The GROUP LABEL is the entire
 * correction**, which is why it is asserted rather than left to review — and why
 * it is a heading rather than an explainer sentence the minimal-copy bound above
 * would (rightly) reject.
 */
/**
 * ⚠ **REWRITTEN 2026-09-06 (settings overhaul, item 9): THE TWO SWITCHES ARE ONE
 * DROPDOWN.** The docblock above is kept because its WARNING is unchanged and is
 * now what this suite exists to hold: an operator who reads a machine-wide control
 * as per-channel has handed an external session their whole machine.
 *
 * The old correction was a GROUP LABEL. Item 2 deleted every group label on this
 * tab, so that correction had to move or die — and it moved into the OPTION LABELS
 * themselves ("In this channel" / "In every channel"), which is a stronger place
 * for it: the scope is now the thing the operator PICKS rather than a heading above
 * the thing they pick. The verbatim machine-wide sentence also rides the row's eye
 * popover by ruling (`settings-help.tsx › SETTINGS_HELP["Launch agents"]`).
 */
describe("Launch agents — one control, two records, scope in the options", () => {
  const view = (
    over: {
      chain?: boolean;
      orch?: boolean;
      busy?: boolean;
      onChain?: (on: boolean) => void;
      onOrch?: (on: boolean) => void;
    } = {}
  ) =>
    agentView({
      agentChain: {
        on: over.chain ?? false,
        busy: over.busy ?? false,
        onToggle: over.onChain ?? noop,
      },
      orchestrator: {
        on: over.orch ?? false,
        busy: over.busy ?? false,
        onToggle: over.onOrch ?? noop,
      },
    });

  const trigger = () =>
    screen.getByLabelText("Whether agents may launch further agents, and where");

  it("is ONE row, and the deleted switches are gone for good", () => {
    view();
    expect(screen.getByText("Launch agents")).toBeTruthy();
    expect(screen.queryByText("Orchestrator launches")).toBeNull();
    expect(screen.queryByText("May launch agents")).toBeNull();
    expect(screen.queryByText("On this Mac, every channel")).toBeNull();
  });

  it("derives its value from BOTH records, asking the machine-wide one first", () => {
    // ⚠ THE ORDER IS THE HONEST ONE AND IS THE POINT OF THIS CASE. While the
    // machine-wide flag is on, launching IS possible here whatever the per-channel
    // flag says — so reporting "Cannot launch agents" over an armed machine would be
    // the control lying about the machine's actual state.
    view();
    expect(trigger().textContent).toContain("Cannot launch agents");
    cleanup();
    view({ chain: true });
    expect(trigger().textContent).toContain("In this channel");
    cleanup();
    view({ chain: true, orch: true });
    expect(trigger().textContent).toContain("In every channel");
    cleanup();
    // ⚠ THE INCOHERENT PAIR: chaining off, machine armed. It must NOT read "Cannot".
    view({ chain: false, orch: true });
    expect(trigger().textContent).toContain("In every channel");
  });

  it("EVERY pick writes both records, and neither write is a no-op", () => {
    // ⚠ A CONTROL THAT DOES NOT FULLY DETERMINE WHAT IT CLAIMS TO SET is the
    // illegibility defect item 8 removed, in the other lane. Picking "Cannot" over an
    // armed machine must disarm the machine, or the label is false.
    const onChain = vi.fn();
    const onOrch = vi.fn();
    view({ chain: true, orch: true, onChain, onOrch });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("Cannot launch agents"));
    expect(onChain).toHaveBeenCalledWith(false);
    expect(onOrch).toHaveBeenCalledWith(false);
  });

  it("writes only what actually changes", () => {
    // The two records are separate stores with separate in-flight states, so writing
    // a value that is already set spends a round-trip and flickers the row for nothing.
    const onChain = vi.fn();
    const onOrch = vi.fn();
    view({ chain: true, orch: false, onChain, onOrch });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText("In every channel"));
    expect(onChain).not.toHaveBeenCalled(); // already on
    expect(onOrch).toHaveBeenCalledWith(true);
  });

  /** ⚠ A second pick landing on top of an unsettled write is the case worth
   *  refusing — this grants a capability, so the last word must be main's.
   *  ⚠ EITHER record being in flight disables the row: one control now stands for
   *  both, so it cannot be half-live. */
  it("goes inert while EITHER write is in flight", () => {
    for (const busy of [{ chainBusy: true }, { orchBusy: true }]) {
      const onChain = vi.fn();
      agentView({
        agentChain: { on: false, busy: !!busy.chainBusy, onToggle: onChain },
        orchestrator: { on: false, busy: !!busy.orchBusy, onToggle: noop },
      });
      expect(disabled(trigger())).toBe(true);
      cleanup();
    }
  });

  it("renders NOTHING without both bridges — a half-wired dropdown is worse than none", () => {
    // ⚠ THE ONE PLACE THIS TAB DEPARTS FROM "hide what has no bridge, show the rest".
    // A dropdown that could set only one of the two records would offer picks that
    // silently do half of what they say.
    agentView({ agentChain: { on: true, busy: false, onToggle: noop }, orchestrator: null });
    expect(screen.queryByText("Launch agents")).toBeNull();
    cleanup();
    agentView({ agentChain: null, orchestrator: { on: true, busy: false, onToggle: noop } });
    expect(screen.queryByText("Launch agents")).toBeNull();
  });
});
