// @vitest-environment jsdom
/**
 * A HAIRLINE BETWEEN EVERY SETTING, ON BOTH SETTINGS FACES (Samuel, 2026-09-13):
 * *"in the settings tab for channels and threads. In between each setting, add a
 * horizontal line, like how we have in the channel info area."*
 *
 * ⚠ **ITS OWN FILE for `settings-agent-face.test.tsx`'s REASON, not a new one:**
 * `settings-tab.test.tsx` is already past the 500-line cap (INVARIANTS §1) and the
 * cases here span BOTH faces — the channel tab and the thread tab — so neither of
 * those suites is the honest home for them.
 *
 * ⚠ **THE ASSERTION IS A MEASUREMENT, NOT A LIST OF ROWS**, the shape this tab's other
 * sweeps take (`› a settings panel, not documentation`, `› no bold, no underline`).
 * Every row on both faces carries `data-settings-row` and every hairline carries
 * `data-settings-divider`, so `lines === rows - 1` goes red for a row added later that
 * arrives unseparated, and for a hairline that survives a row's deletion.
 *
 * ⚠ **WHAT "RENDERED" MEANS HERE, AND WHY IT IS NOT A CSS ASSERTION.** Each row draws
 * its OWN leading line and `first:hidden` suppresses the one at the top of a group
 * (`settings-agent-rows.tsx › SettingDivider` states why a render-time `:first-child`
 * beats a flag: half these rows are gated on a bridge, so which row is first is not
 * knowable where they are written). {@link renderedLines} models exactly that rule —
 * first child AND carrying the class — over the real DOM, so it counts the lines a
 * person SEES rather than the nodes React emitted.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChannelsSettingsTab } from "./settings-tab";
import { ChannelAgentsSettings } from "./settings-channel-agents";
import { ChannelsThreadSettingsTab } from "./thread-settings-tab";
import { agentView } from "./settings-agent-harness";
import { channel, member, thread as makeThread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const noop = () => {};

const rows = (root: HTMLElement) => root.querySelectorAll("[data-settings-row]").length;

/** The hairlines a reader actually sees — see the header. */
function renderedLines(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-settings-divider]")].filter(
    (line) =>
      !(
        line.className.includes("first:hidden") &&
        line.parentElement?.firstElementChild === line
      )
  );
}

/** The desktop-only rows too, so the Working Folder row is in the column. */
const FOLDER = {
  label: "~/Downloads",
  custom: false,
  busy: false,
  onChoose: noop,
  onClear: noop,
};

describe("the channel face — a line between every setting", () => {
  it("draws rows − 1 lines over the Agent Settings column", () => {
    const { container } = agentView({ folder: FOLDER });
    // ⚠ A FLOOR, so the measurement cannot pass by rendering nothing: jsdom is a
    // plain browser, so this is Tool use + Messaging + Tool access + Working Folder.
    expect(rows(container)).toBeGreaterThanOrEqual(4);
    expect(renderedLines(container)).toHaveLength(rows(container) - 1);
  });

  it("never above the first row, and never below the last", () => {
    const { container } = agentView({ folder: FOLDER });
    for (const group of container.querySelectorAll<HTMLElement>("[data-settings-row]")) {
      // Every row's own line is its immediate previous sibling — so a line can only
      // ever sit BETWEEN rows, never at the foot of a group.
      expect(group.previousElementSibling?.hasAttribute("data-settings-divider")).toBe(true);
    }
    const lines = [...container.querySelectorAll<HTMLElement>("[data-settings-divider]")];
    expect(lines.every((line) => line.nextElementSibling !== null)).toBe(true);
    // The suppressed one is the group's first child, and it is the ONLY suppressed one.
    expect(lines.length - renderedLines(container).length).toBe(1);
  });

  it("🔒 separates the responder row from the block above it — `continues`, not a heading", () => {
    // ⚠ THE CASE THE `first:hidden` RULE WOULD OTHERWISE GET WRONG. That row is the
    // first child of its OWN container but not the first setting a reader sees, and
    // the "AGENTS" label that used to be the break is deleted (same ruling).
    const { container } = render(
      <ChannelAgentsSettings
        members={[member({ userId: PEER }), member({ userId: ME })]}
        currentUserId={ME}
        onSetUnaddressedResponder={noop}
      />
    );
    expect(rows(container)).toBe(1);
    expect(renderedLines(container)).toHaveLength(1);
  });

  it("draws rows − 1 lines over the Channel action rows", () => {
    const { container } = render(
      <ChannelsSettingsTab
        channel={channel()}
        canManage
        isChannelOwner
        onInvite={noop}
        onToggleVisibility={noop}
        onRequestDelete={noop}
        onRequestLeave={noop}
      />
    );
    // Add members, Make private, Delete channel. ⚠ FOUR rows / 3 lines until
    // 2026-09-17, when the Archive row went with the feature (R-21).
    expect(rows(container)).toBe(3);
    expect(renderedLines(container)).toHaveLength(2);
  });
});

describe("the thread face — the same line, from the same recipe", () => {
  const mount = (over: { canSetMode?: boolean; canDelete?: boolean } = {}) =>
    render(
      <ChannelsThreadSettingsTab
        thread={makeThread()}
        canSetMode={over.canSetMode ?? true}
        canDelete={over.canDelete ?? true}
        onSetMode={noop}
        onRequestDelete={noop}
      />
    );

  it("puts one line between Mode and Delete thread", () => {
    const { container } = mount();
    expect(rows(container)).toBe(2);
    expect(renderedLines(container)).toHaveLength(1);
  });

  it("🔒 draws no line for a reader who only gets ONE of the two rows", () => {
    // A non-creator manager sees Delete alone (no dead rows, INVARIANTS §5). A line
    // above the only row would be a rule framing the box — the thing he did not ask
    // for — and this is the gate `:first-child` is carrying.
    const { container } = mount({ canSetMode: false });
    expect(rows(container)).toBe(1);
    expect(renderedLines(container)).toHaveLength(0);
  });
});

describe("the responder row's copy", () => {
  const panel = () =>
    render(
      <ChannelAgentsSettings
        members={[member({ userId: ME })]}
        currentUserId={ME}
        onSetUnaddressedResponder={noop}
      />
    );

  it("🔒 is named Responder, and the AGENTS heading is gone", () => {
    // Samuel, 2026-09-13: *"also remove the header line Agents"*, and *"this line is
    // really long and sticks out"* over the label this replaces.
    const { container } = panel();
    expect(screen.getByText("Responder")).toBeTruthy();
    expect(container.textContent).not.toContain("Answers my unaddressed messages");
    // ⚠ BY TEXT NODE, NOT BY A `container.textContent` REGEX. The heading's own words
    // would sit flush against the row's ("AgentsResponder"), so `/\bAgents\b/` has no
    // word boundary to find and the mutation passed — measured 2026-09-13.
    expect(screen.queryByText("Agents")).toBeNull();
  });

  it("🔒 keeps the long sentence on the control's name and title — nothing is lost", () => {
    // The scope the old label carried in the word "MY" has to stay reachable: it is
    // the accessible name, and `SelectMenu` renders it as the trigger's `title` when
    // the selected option has no description of its own.
    panel();
    const trigger = screen.getByLabelText(
      "Who answers my unaddressed messages in this channel"
    );
    expect(trigger.getAttribute("title")).toBe(
      "Who answers my unaddressed messages in this channel"
    );
  });
});
