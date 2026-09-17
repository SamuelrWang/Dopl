// @vitest-environment jsdom
/**
 * **THE TRANSCRIPT FILTER'S CONTROL — THE MENU, ITS TICKS AND WHERE IT SITS.**
 *
 * Split out of `transcript-filter.test.tsx` 2026-09-16 at the 500-line cap, when
 * Samuel made the picker multi-select. That file keeps the RULE (which rows a
 * selection admits) and needs no DOM; this one keeps everything that renders.
 * Fixtures are shared, not copied: `_transcript-filter-fixtures.ts`.
 *
 * What fails silently here:
 *
 *  - **A PICK THAT REPLACES INSTEAD OF ADDING** — single-select behaviour wearing
 *    checkboxes, which looks right in a screenshot and is the bug Samuel reported.
 *  - **A TICK THAT LIVES ONLY IN PAINT.** `aria-checked` is what a screen reader has.
 *  - **THE COLUMN.** The rows drifted apart because the agents' had a dot and the
 *    keywords' did not; it is asserted as sameness of STRUCTURE, since jsdom has no
 *    layout and a pixel assertion here could not fail honestly.
 *  - **PLACEMENT IS A RULING, NOT A DETAIL** — *"next to the left of the toggle bar for
 *    collapsing the right-side panel"* — and DOM order is invisible to every other test.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ⚠ THE PANE CARRIES THE COMPOSER ALONG and its write layer has its own suite — the
// mock `message-pane.test.tsx` uses, for that file's reason.
vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  TRANSCRIPT_FILTER_ALL,
  TranscriptFilterSelect,
  agentTranscriptFilter,
  transcriptFilterAgents,
  type TranscriptFilter,
} from "./transcript-filter";
import { ChannelsMessagePane } from "./message-pane";
import { PaneHeader } from "./message-pane-header";
import { channelRows } from "./view-model-rows";
import { CHANNEL_ID, message } from "./test-fixtures";
import {
  INDEX,
  MEMBERS,
  PEOPLE,
  ROWS,
  SCOUT,
} from "./_transcript-filter-fixtures";

beforeAll(() => {
  // ⚠ jsdom HAS NO `Element.prototype.scrollTo`, and the pane's pin calls it on mount.
  Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
});
afterEach(cleanup);

describe("§ the control", () => {
  const agents = transcriptFilterAgents(ROWS, INDEX);

  function open(value: TranscriptFilter = TRANSCRIPT_FILTER_ALL) {
    const onChange = vi.fn();
    render(
      <TranscriptFilterSelect value={value} agents={agents} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    return { onChange };
  }

  /** ⚠ `menuitemcheckbox`, NOT `menuitem`: every row is a tick now, and the role is
   *  what says so to a screen reader (`popover-menu.tsx › MenuItem.checked`). */
  const rows = () => screen.getAllByRole("menuitemcheckbox");
  const row = (name: string) => screen.getByRole("menuitemcheckbox", { name });

  it("offers All, People and one entry per agent, in that order", () => {
    open();
    expect(rows().map((el) => el.textContent)).toEqual([
      "All",
      "People",
      "Scout",
      "Rover",
    ]);
  });

  it("paints a live agent's dot from its COLOUR TOKEN and never a literal", () => {
    open();
    const scoutDot = row("Scout").querySelector<HTMLElement>("[data-agent-color]")!;
    // `lib/agent-colors.ts › agentColorVar` is the only place the token name is spelled.
    expect(scoutDot.style.backgroundColor).toBe("var(--agent-color-03)");
    expect(scoutDot.dataset.agentColor).toBe("agent-03");
  });

  it("gives an agent with no colour a GRAY dot, by token", () => {
    open();
    const roverDot = row("Rover").querySelector<HTMLElement>("span[style]")!;
    // ⚠ THE SAME TOKEN `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL` gives the ring and the
    // bar, so the dot in this menu and the accent in the transcript read as one state.
    expect(roverDot.style.backgroundColor).toBe("var(--border-strong)");
    expect(roverDot.dataset.agentColor).toBeUndefined();
  });

  it("reports a SHAPED value, so an agent id can never be read as a keyword", () => {
    const { onChange } = open();
    fireEvent.click(row("Scout"));
    expect(onChange).toHaveBeenCalledWith({ people: false, agentIds: [SCOUT] });
  });

  it("ADDS to the selection instead of replacing it, and stays open to be ticked again", () => {
    // ⚠ THE WHOLE POINT OF THE CHANGE: a second pick that replaced the first would be
    // the old single-select behaviour wearing checkboxes.
    const { onChange } = open(PEOPLE);
    fireEvent.click(row("Scout"));
    expect(onChange).toHaveBeenCalledWith({ people: true, agentIds: [SCOUT] });
    // The menu did not close on the pick — the next tick needs no second trip.
    expect(rows().length).toBe(4);
  });

  it("un-ticks a row that is already on", () => {
    const { onChange } = open({ people: true, agentIds: [SCOUT] });
    fireEvent.click(row("Scout"));
    expect(onChange).toHaveBeenCalledWith({ people: true, agentIds: [] });
  });

  it("carries the tick in `aria-checked`, not only in paint", () => {
    open({ people: true, agentIds: [SCOUT] });
    expect(row("People").getAttribute("aria-checked")).toBe("true");
    expect(row("Scout").getAttribute("aria-checked")).toBe("true");
    expect(row("Rover").getAttribute("aria-checked")).toBe("false");
    // "All" is DERIVED — off precisely because something else is on.
    expect(row("All").getAttribute("aria-checked")).toBe("false");
  });

  it("All is a CLEAR: it empties the selection and is on when nothing else is", () => {
    const { onChange } = open({ people: true, agentIds: [SCOUT] });
    expect(row("All").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row("All"));
    // ⚠ THE SHARED CONSTANT, by identity — the pane memoizes on it.
    expect(onChange).toHaveBeenCalledWith(TRANSCRIPT_FILTER_ALL);
  });

  it("says nothing when All is picked while already unfiltered", () => {
    const { onChange } = open();
    expect(row("All").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row("All"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names a COUNT on the trigger once more than one row is ticked", () => {
    render(
      <TranscriptFilterSelect
        value={{ people: true, agentIds: [SCOUT] }}
        agents={agents}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Filter messages" }).textContent
    ).toContain("2 selected");
  });

  it("wears the selected agent's dot on the TRIGGER, not just in the menu", () => {
    render(
      <TranscriptFilterSelect
        value={agentTranscriptFilter(SCOUT)}
        agents={agents}
        onChange={vi.fn()}
      />
    );
    const trigger = screen.getByRole("button", { name: "Filter messages" });
    expect(trigger.textContent).toContain("Scout");
    expect(
      trigger.querySelector<HTMLElement>("[data-agent-color]")!.style.backgroundColor
    ).toBe("var(--agent-color-03)");
  });
});

/**
 * **§ ONE COLUMN — every row starts at the same x** (Samuel, 2026-09-16: *"agent
 * entries start at different x-offsets; align every row to one consistent column"*).
 *
 * ⚠ THE BUG WAS STRUCTURAL: "All" and "People" had a check column and no dot, the agent
 * rows had both, so their labels sat one dot-plus-gap to the right. It is asserted as
 * SAMENESS OF STRUCTURE rather than as pixels — jsdom has no layout, and a pixel
 * assertion here would be a screenshot test that cannot fail honestly.
 */
describe("§ one column", () => {
  it("gives every row the same leading mark, with the same two slots", () => {
    render(
      <TranscriptFilterSelect
        value={TRANSCRIPT_FILTER_ALL}
        agents={transcriptFilterAgents(ROWS, INDEX)}
        onChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    for (const el of screen.getAllByRole("menuitemcheckbox")) {
      const marks = el.querySelectorAll("[data-row-mark]");
      // ⚠ EXACTLY ONE, and the checkbox is never the kit's `showCheck` tick beside it:
      // two marks would be a third x-offset and two sentences for one state.
      expect(marks.length).toBe(1);
      // Box + dot slot, on the keyword rows as much as on the agents' — the empty dot
      // is what holds the column.
      expect(marks[0]!.children.length).toBe(2);
      // The mark is the row's FIRST child: nothing may be inserted ahead of it.
      expect(el.firstElementChild!.contains(marks[0]!)).toBe(true);
    }
  });
});

describe("§ where it sits", () => {
  it("renders immediately LEFT of the info-pane collapse toggle", () => {
    // ⚠ Samuel placed it against that control by name, and DOM ORDER is the whole of
    // that ruling — no other case in this tree can see it.
    const { container } = render(
      <PaneHeader
        channelName="Website"
        threadTitle={null}
        favorited={false}
        chrome="page"
        transcriptFilter={<button type="button">FILTER</button>}
        onToggleFavorite={vi.fn()}
        onExitThread={vi.fn()}
      />
    );
    const buttons = [...container.querySelectorAll("button")];
    const filter = buttons.findIndex((b) => b.textContent === "FILTER");
    const toggle = buttons.findIndex(
      (b) => b.getAttribute("aria-label") === "Channel info"
    );
    expect(filter).toBeGreaterThanOrEqual(0);
    expect(toggle).toBe(filter + 1);
  });

  it("is absent from the pop-out window's header, which carries no controls", () => {
    const { container } = render(
      <PaneHeader
        channelName="Website"
        threadTitle="UI-kit design"
        favorited={false}
        chrome="window"
        transcriptFilter={<button type="button">FILTER</button>}
        onToggleFavorite={vi.fn()}
        onExitThread={vi.fn()}
      />
    );
    expect(container.textContent).not.toContain("FILTER");
  });
});

describe("§ in the pane", () => {
  type Props = React.ComponentProps<typeof ChannelsMessagePane>;

  function paneProps(over: Partial<Props> = {}): Props {
    return {
      channelId: CHANNEL_ID,
      workspaceId: "ws-1",
      channelName: "Website",
      thread: null,
      rows: ROWS,
      index: INDEX,
      members: MEMBERS,
      loading: false,
      scrollTarget: null,
      favorited: false,
      gate: { begin: vi.fn(), end: vi.fn() },
      onToggleFavorite: vi.fn(),
      onToggleInfo: vi.fn(),
      onExitThread: vi.fn(),
      onOpenThread: vi.fn(),
      ...over,
    };
  }

  it("hides every boxed post when People is picked", () => {
    render(<ChannelsMessagePane {...paneProps()} />);
    expect(screen.getByText("scout line")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "People" }));
    expect(screen.queryByText("scout line")).toBeNull();
    expect(screen.queryByText("rover line")).toBeNull();
    expect(screen.getByText("sam line")).toBeTruthy();
    expect(screen.getByText("desktop line")).toBeTruthy();
  });

  it("shows one agent's posts and drops the rest", () => {
    render(<ChannelsMessagePane {...paneProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Scout" }));
    expect(screen.getByText("scout line")).toBeTruthy();
    expect(screen.queryByText("sam line")).toBeNull();
    expect(screen.queryByText("rover line")).toBeNull();
  });

  it("offers NO control in a room where no agent has posted", () => {
    // Label + control only — and a control whose two answers are one set is neither.
    const humansOnly = channelRows(
      [message({ id: "m-1", seq: 1, body: "sam line" })],
      [],
      INDEX,
      formatChannelTimestamp
    );
    render(<ChannelsMessagePane {...paneProps({ rows: humansOnly })} />);
    expect(screen.queryByRole("button", { name: "Filter messages" })).toBeNull();
  });

  it("keeps the selection PER CHANNEL — another room opens unfiltered", () => {
    const { rerender } = render(<ChannelsMessagePane {...paneProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "People" }));
    expect(screen.queryByText("scout line")).toBeNull();
    // The same mount, a different channel: the filter must not travel.
    rerender(<ChannelsMessagePane {...paneProps({ channelId: "ch-2" })} />);
    expect(screen.getByText("scout line")).toBeTruthy();
    // ⚠ AND COMING BACK RESTORES IT — that is what "persists per channel" buys.
    rerender(<ChannelsMessagePane {...paneProps()} />);
    expect(screen.queryByText("scout line")).toBeNull();
  });
});
