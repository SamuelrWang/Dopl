// @vitest-environment jsdom
/**
 * **THE TRANSCRIPT FILTER — AND THE ONE PROPERTY IT CANNOT BE ALLOWED TO LOSE:
 * "People" IS EXACTLY THE SET OF POSTS WITH NO COLOURED BOX** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md item 6: *"Just users, which would include desktop agents
 * as well: all of the messages that don't have a colored box around them"*).
 *
 * What fails SILENTLY here, and is therefore what this file is for:
 *
 *  - **THE `null` vs `{ color: null }` DISTINCTION** in
 *    `agent-box-rule.ts › agentBoxOf`. An ENDED agent's colour went back to the
 *    channel's bank, so its posts wear a NEUTRAL box — still an agent's. A rule that
 *    answered plain `null` for "no colour" would file every ended agent's post under
 *    People, and nothing on the painting side would notice: a neutral box and a
 *    boxless row are one line of CSS apart and the screenshot still looks plausible.
 *    `§ People` below is that MUTATION-VERIFY case, and each case says what it catches.
 *  - **THE OPTION LIST IS THE LOADED ROWS', NOT THE SESSION INDEX'.** An option that
 *    matches no row filters to a blank transcript, and the index is full of agents that
 *    never spoke in this room.
 *  - **A SELECTION CAN OUTLIVE ITS AGENT.** The transcript is a window; paging can drop
 *    the last post of the agent being filtered on, and the pane would then be blank
 *    under a trigger naming that agent.
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
  filterTranscriptRows,
  resolveTranscriptFilter,
  transcriptFilterAgents,
  transcriptRowAgentId,
  type TranscriptFilter,
} from "./transcript-filter";
import { ChannelsMessagePane } from "./message-pane";
import { PaneHeader } from "./message-pane-header";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { CHANNEL_ID, ME, PEER, member, message, thread } from "./test-fixtures";
import type { AgentIdentity } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type { ChannelMessage } from "../types";

/** LIVE, wearing a colour. */
const SCOUT = "k3v7d2mq";
/** ENDED — its key is back in the bank, so its posts wear the NEUTRAL box. */
const ROVER = "a1b2c3d4";
/** In the machine's index and has posted NOTHING in this room. */
const IDLE = "z9y8x7w6";

const AGENTS: ReadonlyMap<string, AgentIdentity> = new Map([
  [SCOUT, { displayName: "Scout", description: null, ended: false, color: "agent-03" }],
  [ROVER, { displayName: "Rover", description: null, ended: true, color: null }],
  [IDLE, { displayName: "Idle hands", description: null, ended: false, color: "agent-07" }],
]);

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];
const INDEX = indexMembers(MEMBERS, ME, AGENTS);

/**
 * An AGENT post. ⚠ `id === null` is the **"Desktop agent"** case and the reason this
 * helper takes a nullable: an MCP write from a session that belongs to no channel
 * carries no instance id, which is exactly the population Samuel put on the PEOPLE side
 * (`agent-box-rule.ts › agentBoxOf`). The session-key shape is
 * `lib/agent-post-stamp.ts › agentIdOfSessionKey`'s.
 */
function byAgent(id: string | null, over: Partial<ChannelMessage>): ChannelMessage {
  return message({
    authorKind: "agent",
    metadata: id === null ? {} : { session_id: `${CHANNEL_ID}::${id}` },
    ...over,
  });
}

const THREAD = thread({ id: "t-1", title: "UI-kit design" });

const MESSAGES: ChannelMessage[] = [
  message({ id: "m-1", seq: 1, body: "sam line" }),
  byAgent(SCOUT, { id: "m-2", seq: 2, body: "scout line" }),
  byAgent(ROVER, { id: "m-3", seq: 3, body: "rover line" }),
  byAgent(null, { id: "m-4", seq: 4, body: "desktop line" }),
  byAgent(SCOUT, { id: "m-5", seq: 5, body: "scout again" }),
  message({ id: "m-6", seq: 6, authorUserId: PEER, body: "diana line" }),
  // ⚠ A THREAD CARD OPENED BY AN AGENT — the "threads follow the same author rule" case.
  byAgent(SCOUT, {
    id: "m-7",
    seq: 7,
    body: "opened a thread",
    metadata: { session_id: `${CHANNEL_ID}::${SCOUT}`, taskId: THREAD.id },
  }),
];

const ROWS = channelRows(MESSAGES, [THREAD], INDEX, formatChannelTimestamp);

const PEOPLE: TranscriptFilter = { kind: "people" };

/** A row's body, or its KIND in brackets for the rows that are not somebody's words —
 *  so a case that drops a card fails on the card rather than on a length. */
const bodies = (rows: readonly TranscriptRow[]) =>
  rows.map((row) => (row.kind === "message" ? row.body : `[${row.kind}]`));

beforeAll(() => {
  // ⚠ jsdom HAS NO `Element.prototype.scrollTo`, and the pane's pin calls it on mount.
  Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
});
afterEach(cleanup);

describe("§ People — the complement of the coloured box", () => {
  it("excludes EVERY boxed post, the ENDED agent's included", () => {
    // ⚠ **THE MUTATION THIS CATCHES**: make `agentBoxOf` return plain `null` instead of
    // `{ color: null }` when `AgentIdentity.color` is absent — i.e. conflate "no box"
    // with "a neutral box". `rover line` then joins this list and the assertion fails.
    // A second mutation it catches: dropping the `agentId === null` guard, which would
    // pull `desktop line` OUT of People and into a box of its own.
    expect(bodies(filterTranscriptRows(ROWS, INDEX, PEOPLE))).toEqual([
      "sam line",
      "desktop line",
      "diana line",
      "[thread-card]",
    ]);
  });

  it("keeps a human's post and a Desktop agent's, which is the whole of the ruling", () => {
    const people = bodies(filterTranscriptRows(ROWS, INDEX, PEOPLE));
    expect(people).toContain("sam line");
    expect(people).toContain("diana line");
    // *"Just users, which would include desktop agents as well"* — an agent post with
    // no instance id is a channel-less MCP write and wears no box.
    expect(people).toContain("desktop line");
  });

  it("is the exact complement: All is People plus every agent's set, and nothing twice", () => {
    // ⚠ THE PARTITION IS THE PROPERTY, not the three lists separately: a row that fell
    // through every option would be invisible under all of them and no single-list
    // assertion would say so.
    const all = bodies(filterTranscriptRows(ROWS, INDEX, TRANSCRIPT_FILTER_ALL));
    const parts = [
      ...bodies(filterTranscriptRows(ROWS, INDEX, PEOPLE)),
      ...bodies(filterTranscriptRows(ROWS, INDEX, agentTranscriptFilter(SCOUT))),
      ...bodies(filterTranscriptRows(ROWS, INDEX, agentTranscriptFilter(ROVER))),
    ];
    expect([...parts].sort()).toEqual([...all].sort());
  });

  it("a card carries no agent identity, so it files under People and never under an agent", () => {
    // ⚠ NOT AN OVERSIGHT: `view-model-rows.ts › ThreadCardRow` has `author` and no
    // `agent` / `agentId`, so the agent that opened the thread is not a fact this
    // surface holds. Attributing the card by guess would be worse than this.
    expect(bodies(filterTranscriptRows(ROWS, INDEX, PEOPLE))).toContain("[thread-card]");
    expect(
      bodies(filterTranscriptRows(ROWS, INDEX, agentTranscriptFilter(SCOUT)))
    ).not.toContain("[thread-card]");
  });

  it("answers `null` for every row that is not a message", () => {
    for (const row of ROWS.filter((r) => r.kind !== "message")) {
      expect(transcriptRowAgentId(row, INDEX)).toBeNull();
    }
  });
});

describe("§ one agent", () => {
  it("shows only that agent's posts, in transcript order", () => {
    expect(bodies(filterTranscriptRows(ROWS, INDEX, agentTranscriptFilter(SCOUT)))).toEqual([
      "scout line",
      "scout again",
    ]);
  });

  it("an ENDED agent still has its own set — the neutral box is a box", () => {
    expect(bodies(filterTranscriptRows(ROWS, INDEX, agentTranscriptFilter(ROVER)))).toEqual([
      "rover line",
    ]);
  });

  it("All returns the SAME array, not a copy", () => {
    // ⚠ The transcript's pin and paging memoize on `rows`' identity — a fresh array on
    // the default selection re-runs all of it every render.
    expect(filterTranscriptRows(ROWS, INDEX, TRANSCRIPT_FILTER_ALL)).toBe(ROWS);
  });
});

describe("§ the options come from the loaded rows", () => {
  it("names each agent that POSTED, once, in first-post order", () => {
    expect(transcriptFilterAgents(ROWS, INDEX).map((a) => a.agentId)).toEqual([
      SCOUT,
      ROVER,
    ]);
  });

  it("offers NO option for an agent the index knows and the transcript does not", () => {
    // ⚠ The ruling is *"one entry per agent that has posted in the loaded transcript"*,
    // and the mechanical reason is that `IDLE`'s option would filter to nothing.
    expect(transcriptFilterAgents(ROWS, INDEX).map((a) => a.agentId)).not.toContain(IDLE);
  });

  it("takes the agent's LIVE name and colour off the index, never off the row", () => {
    const [scout, rover] = transcriptFilterAgents(ROWS, INDEX);
    expect(scout).toMatchObject({ label: "Scout", color: "agent-03" });
    // The key went back to the bank when the session ended — hence `null`, hence gray.
    expect(rover).toMatchObject({ label: "Rover", color: null });
  });

  it("falls back to the canonical unnamed FACE for an agent this machine has no name for", () => {
    // A peer's agent in a web tree: the index is empty, the post is still theirs.
    // ⚠ **IT WAS `#<id>` UNTIL 2026-09-15** — the raw instance id, in a dropdown a person reads.
    // Samuel: *"I want to make it so that the user really doesnt see it"*, so both unnamed rows
    // now read `New Agent` (`attribution-pill.tsx › attributionName`, the ONE face this list
    // shares with the transcript beneath it).
    // ⚠ **AND YES, THE TWO OPTIONS NOW READ THE SAME**, which is honest rather than a
    // regression: this index knows nothing about either agent, so there is nothing to tell them
    // apart with. ⚠ **IT IS ALSO THE PEER CASE ONLY.** This machine's own agents cannot both be
    // `New Agent` — Samuel's uniqueness ruling stores the second as `New Agent-1`
    // (`main/agent-name-unique.js`) — so an unnamed pair here is two agents whose names live on
    // a machine this web tree cannot ask.
    const bare = indexMembers(MEMBERS, ME);
    expect(transcriptFilterAgents(ROWS, bare).map((a) => a.label)).toEqual([
      "New Agent",
      "New Agent",
    ]);
  });
});

describe("§ a selection that outlived its agent", () => {
  const agents = transcriptFilterAgents(ROWS, INDEX);

  it("falls back to All rather than leaving the pane blank", () => {
    expect(resolveTranscriptFilter(agentTranscriptFilter(IDLE), agents)).toBe(
      TRANSCRIPT_FILTER_ALL
    );
  });

  it("leaves both keywords alone", () => {
    expect(resolveTranscriptFilter(PEOPLE, agents)).toBe(PEOPLE);
    expect(resolveTranscriptFilter(TRANSCRIPT_FILTER_ALL, [])).toBe(TRANSCRIPT_FILTER_ALL);
  });

  it("honours a selection the loaded rows still answer", () => {
    expect(resolveTranscriptFilter(agentTranscriptFilter(SCOUT), agents)).toEqual(
      agentTranscriptFilter(SCOUT)
    );
  });
});

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

  it("offers All, People and one entry per agent, in that order", () => {
    open();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "All",
      "People",
      "Scout",
      "Rover",
    ]);
  });

  it("paints a live agent's dot from its COLOUR TOKEN and never a literal", () => {
    open();
    const scoutDot = screen
      .getByRole("menuitem", { name: "Scout" })
      .querySelector<HTMLElement>("[data-agent-color]")!;
    // `lib/agent-colors.ts › agentColorVar` is the only place the token name is spelled.
    expect(scoutDot.style.backgroundColor).toBe("var(--agent-color-03)");
    expect(scoutDot.dataset.agentColor).toBe("agent-03");
  });

  it("gives an agent with no colour a GRAY dot, by token", () => {
    open();
    const roverDot = screen
      .getByRole("menuitem", { name: "Rover" })
      .querySelector<HTMLElement>("span[style]")!;
    // ⚠ THE SAME TOKEN `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL` gives the ring and the
    // bar, so the dot in this menu and the accent in the transcript read as one state.
    expect(roverDot.style.backgroundColor).toBe("var(--border-strong)");
    expect(roverDot.dataset.agentColor).toBeUndefined();
  });

  it("reports a SHAPED value, so an agent id can never be read as a keyword", () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Scout" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "agent", agentId: SCOUT });
  });

  it("says nothing when the current option is re-picked", () => {
    const { onChange } = open({ kind: "people" });
    fireEvent.click(screen.getByRole("menuitem", { name: "People" }));
    expect(onChange).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("menuitem", { name: "People" }));
    expect(screen.queryByText("scout line")).toBeNull();
    expect(screen.queryByText("rover line")).toBeNull();
    expect(screen.getByText("sam line")).toBeTruthy();
    expect(screen.getByText("desktop line")).toBeTruthy();
  });

  it("shows one agent's posts and drops the rest", () => {
    render(<ChannelsMessagePane {...paneProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter messages" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Scout" }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "People" }));
    expect(screen.queryByText("scout line")).toBeNull();
    // The same mount, a different channel: the filter must not travel.
    rerender(<ChannelsMessagePane {...paneProps({ channelId: "ch-2" })} />);
    expect(screen.getByText("scout line")).toBeTruthy();
    // ⚠ AND COMING BACK RESTORES IT — that is what "persists per channel" buys.
    rerender(<ChannelsMessagePane {...paneProps()} />);
    expect(screen.queryByText("scout line")).toBeNull();
  });
});
