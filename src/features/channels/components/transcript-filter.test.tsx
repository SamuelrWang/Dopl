/**
 * **THE TRANSCRIPT FILTER'S RULE — AND THE ONE PROPERTY IT CANNOT BE ALLOWED TO LOSE:
 * "People" IS EXACTLY THE SET OF POSTS WITH NO COLOURED BOX** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md item 6: *"Just users, which would include desktop agents
 * as well: all of the messages that don't have a colored box around them"*).
 *
 * ⚠ THE PURE HALF, AND IT NEEDS NO DOM — the CONTROL (its menu, its ticks, its one
 * column, where it sits, the pane around it) is `transcript-filter-menu.test.tsx`,
 * split off 2026-09-16 at the 500-line cap. Fixtures are shared, not copied:
 * `_transcript-filter-fixtures.ts`.
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
 *  - **A UNION READ AS AN INTERSECTION** now that several rows can be ticked at once:
 *    two ticks would show NOTHING, and an empty pane reads as a loading state.
 *  - **THE OPTION LIST IS THE LOADED ROWS', NOT THE SESSION INDEX'.** An option that
 *    matches no row filters to a blank transcript, and the index is full of agents that
 *    never spoke in this room.
 *  - **A SELECTION CAN OUTLIVE ITS AGENT.** The transcript is a window; paging can drop
 *    the last post of an agent that is ticked, and only THAT tick may be dropped.
 */

import { describe, expect, it } from "vitest";

import { indexMembers } from "./view-model";
import {
  TRANSCRIPT_FILTER_ALL,
  agentTranscriptFilter,
  filterTranscriptRows,
  resolveTranscriptFilter,
  transcriptFilterAgents,
  transcriptRowAgentId,
  type TranscriptFilter,
} from "./transcript-filter";
import { ME } from "./test-fixtures";
import {
  INDEX,
  IDLE,
  MEMBERS,
  PEOPLE,
  ROVER,
  ROWS,
  SCOUT,
  bodies,
} from "./_transcript-filter-fixtures";

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

/**
 * **§ SEVERAL AT ONCE — and the decision that "All" is an EMPTY SET, not a value**
 * (Samuel, 2026-09-16: multi-select, and *"'All' option redundant vs per-item rows"*).
 *
 * What fails silently here: a UNION read as an intersection (two ticks would show
 * NOTHING, since a row has one author, and an empty pane under two ticks looks like a
 * loading state); and the empty selection losing its identity, which re-filters the
 * whole transcript on every render forever and shows up as lag rather than as a bug.
 */
describe("§ several at once", () => {
  const scoutAndPeople: TranscriptFilter = { people: true, agentIds: [SCOUT] };

  it("is a UNION: People's posts and the ticked agent's, in transcript order", () => {
    expect(bodies(filterTranscriptRows(ROWS, INDEX, scoutAndPeople))).toEqual([
      "sam line",
      "scout line",
      "desktop line",
      "scout again",
      "diana line",
      "[thread-card]",
    ]);
  });

  it("two agents together, and nobody else", () => {
    const both: TranscriptFilter = { people: false, agentIds: [SCOUT, ROVER] };
    expect(bodies(filterTranscriptRows(ROWS, INDEX, both))).toEqual([
      "scout line",
      "rover line",
      "scout again",
    ]);
  });

  it("every row ticked is the same transcript as none ticked — which is why All is empty", () => {
    // ⚠ THE PROPERTY BEHIND THE DECISION: People plus every agent IS the partition, so a
    // fourth mutually-exclusive "All" value would be a second spelling of this set.
    const everything: TranscriptFilter = { people: true, agentIds: [SCOUT, ROVER] };
    expect(bodies(filterTranscriptRows(ROWS, INDEX, everything))).toEqual(
      bodies(filterTranscriptRows(ROWS, INDEX, TRANSCRIPT_FILTER_ALL))
    );
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

  it("falls back to All when NOTHING in the selection survives", () => {
    expect(resolveTranscriptFilter(agentTranscriptFilter(IDLE), agents)).toBe(
      TRANSCRIPT_FILTER_ALL
    );
  });

  it("drops only the DEAD tick and keeps the rest — the multi-select case", () => {
    // ⚠ THE MUTATION THIS CATCHES: falling back to All wholesale, as the single-select
    // version had to, which would silently throw away ticks the window still answers.
    expect(
      resolveTranscriptFilter({ people: true, agentIds: [SCOUT, IDLE] }, agents)
    ).toEqual({ people: true, agentIds: [SCOUT] });
  });

  it("leaves an empty-agent selection alone, by IDENTITY", () => {
    expect(resolveTranscriptFilter(PEOPLE, agents)).toBe(PEOPLE);
    expect(resolveTranscriptFilter(TRANSCRIPT_FILTER_ALL, [])).toBe(TRANSCRIPT_FILTER_ALL);
  });

  it("honours a selection the loaded rows still answer, by IDENTITY", () => {
    // ⚠ `toBe`, not `toEqual`: a fresh object on the untouched path is a new `useMemo`
    // key in the pane and re-filters the transcript every render.
    const live = agentTranscriptFilter(SCOUT);
    expect(resolveTranscriptFilter(live, agents)).toBe(live);
  });
});
