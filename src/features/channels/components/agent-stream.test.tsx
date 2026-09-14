// @vitest-environment jsdom
/**
 * THE AGENT'S WORK STREAM — the lane every agent surface renders (Samuel,
 * 2026-08-22).
 *
 * The properties here fail QUIETLY, which is why each one is pinned:
 *
 *  - **A FRAME THIS BUILD HAS NEVER HEARD OF STILL RENDERS.** The desktop's
 *    `kind` vocabulary is still growing and the two trees ship separately, so an
 *    unknown kind is the NORMAL case for a window of time after every desktop
 *    release. Dropping those frames leaves an agent that looks idle while it
 *    works, and nothing anywhere says a line was skipped.
 *  - **PUBLIC AND PRIVATE DO NOT LOOK ALIKE.** Only the `sent` lane reached the
 *    counterparty. A private steer wearing the sent box would let an operator
 *    believe the other party read something they never saw — the worst thing this
 *    surface can get wrong.
 *  - **ONE POST IS ONE ROW.** The transcript row and the narration echo describe
 *    the same act; rendering both says it happened twice.
 *  - **THE LOG LANE IS BOUNDED IN BOTH DIRECTIONS.** Collapsed, so a tool result
 *    cannot push the post off screen; and bounded when expanded, so "show more"
 *    on a megabyte of JSON does not destroy the stream it was meant to explain.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentStream, NARRATION_EMPTY, NARRATION_UNSUPPORTED } from "./agent-stream";
import { toolRunLabel } from "./agent-stream-log";
import { buildAgentStream, frameLane, groupStreamItems } from "./agent-stream-model";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { message } from "./test-fixtures";

afterEach(cleanup);

function frame(over: Partial<AgentNarrationEntry> = {}): AgentNarrationEntry {
  return { at: 1_000, kind: "assistant", text: "thinking about it", ...over };
}

/**
 * A frame carrying a kind THIS BUILD'S TYPE DOES NOT KNOW.
 *
 * ⚠ THE CAST IS THE SUBJECT, not a convenience. `AgentNarrationEntry.kind` is a
 * closed union in this tree and an OPEN vocabulary on the wire — main can emit a
 * seventh value any day, and the type cannot know. Every case below that uses
 * this is asserting what happens when it does.
 */
function wildFrame(kind: string, over: Partial<AgentNarrationEntry> = {}) {
  return { ...frame(over), kind } as unknown as AgentNarrationEntry;
}

function renderStream(
  over: Partial<React.ComponentProps<typeof AgentStream>> = {}
) {
  return render(
    <AgentStream
      entries={[]}
      supported
      sent={[]}
      threadTitle="UI-kit design"
      {...over}
    />
  );
}

describe("frameLane — an alias table with a fallback, not a closed switch", () => {
  it("maps today's five kinds", () => {
    expect(frameLane(frame({ kind: "assistant" }))).toBe("thinking");
    expect(frameLane(frame({ kind: "tool" }))).toBe("tool");
    expect(frameLane(frame({ kind: "result" }))).toBe("tool");
    expect(frameLane(frame({ kind: "post" }))).toBe("sent");
    expect(frameLane(frame({ kind: "status" }))).toBe("note");
  });

  it("maps the vocabulary the desktop is growing", () => {
    for (const kind of ["thinking", "step"]) {
      expect(frameLane(wildFrame(kind))).toBe("thinking");
    }
    for (const kind of ["command", "tool_use", "tool_result"]) {
      expect(frameLane(wildFrame(kind))).toBe("tool");
    }
    for (const kind of ["operator", "steer", "user"]) {
      expect(frameLane(wildFrame(kind))).toBe("operator");
    }
    for (const kind of ["private", "reply"]) {
      expect(frameLane(wildFrame(kind))).toBe("private");
    }
  });

  it("falls back to a NOTE for a kind it has never heard of", () => {
    // ⚠ The normal case after any desktop release. It must not throw and must
    // not drop the line.
    expect(frameLane(wildFrame("awaiting_handoff"))).toBe("note");
    expect(frameLane(wildFrame(undefined as unknown as string))).toBe("note");
  });

  it("lets an explicit LANE outrank the kind — audience decides", () => {
    // ⚠ `kind` describes the shape of the event; `lane` says who can SEE it.
    // When they disagree, the one about audience wins, because audience is the
    // fact this surface must never infer wrongly.
    const raw = { ...frame({ kind: "assistant" }), lane: "private" };
    expect(frameLane(raw as AgentNarrationEntry)).toBe("private");
    const posted = { ...frame({ kind: "assistant" }), lane: "channel" };
    expect(frameLane(posted as AgentNarrationEntry)).toBe("sent");
  });
});

describe("buildAgentStream — one post is one row", () => {
  const post = message({
    id: "m-1",
    authorUserId: "u-me",
    authorKind: "agent",
    body: "Renamed btn/secondary.",
    createdAt: "2026-08-22T10:00:02.000Z",
  });

  it("drops the narration ECHO when the transcript carries the post", () => {
    // ⚠ Both describe one act. The transcript row wins because it is the thing
    // that actually exists on the server: an id, the stored body, an agreed
    // timestamp.
    const items = buildAgentStream({
      entries: [frame({ kind: "post", text: "Renamed btn/secondary." })],
      sent: [post],
    });
    expect(items.filter((i) => i.lane === "sent")).toHaveLength(1);
    expect(items[0].key).toBe("m:m-1");
  });

  it("KEEPS the echo when there is no transcript to read", () => {
    // ⚠ Otherwise a surface with narration and no messages read shows an agent
    // that thinks and runs tools and never says anything.
    const items = buildAgentStream({
      entries: [frame({ kind: "post", text: "posted this" })],
      sent: [],
    });
    expect(items.filter((i) => i.lane === "sent")).toHaveLength(1);
  });

  it("interleaves frames and posts in TIME order, stably", () => {
    const items = buildAgentStream({
      entries: [
        frame({ at: Date.parse("2026-08-22T10:00:01.000Z"), text: "first" }),
        frame({ at: Date.parse("2026-08-22T10:00:03.000Z"), text: "third" }),
      ],
      sent: [post],
    });
    expect(items.map((i) => i.lane)).toEqual(["thinking", "sent", "thinking"]);
  });

  it("survives a null feed and an unparseable stamp without dropping anything", () => {
    expect(buildAgentStream({ entries: null, sent: [post] })).toHaveLength(1);
    const items = buildAgentStream({
      entries: null,
      sent: [message({ id: "m-bad", createdAt: "not-a-date" })],
    });
    // ⚠ A message with a bad timestamp is still a message — it sorts first
    // rather than vanishing.
    expect(items).toHaveLength(1);
  });
});

describe("the two absences are worded differently", () => {
  it("says NOTHING YET when the feed was asked and is empty", () => {
    renderStream({ entries: [] });
    expect(screen.getByText(NARRATION_EMPTY)).toBeTruthy();
  });

  it("says THIS BUILD CANNOT SHOW IT when there was nothing to ask", () => {
    renderStream({ entries: null, supported: false });
    expect(screen.getByText(NARRATION_UNSUPPORTED)).toBeTruthy();
  });

  it("still renders the SENT lane on a build with no narration op", () => {
    // ⚠ The transcript is a server read and does not need the bridge. An agent
    // that posted must never read as an agent that did nothing.
    renderStream({
      entries: null,
      supported: false,
      sent: [message({ id: "m-1", body: "I posted this." })],
    });
    expect(screen.getByText("I posted this.")).toBeTruthy();
    // …and it still says the WORK lane could not be asked for, so a short list
    // does not imply a quiet agent.
    expect(screen.getByText(NARRATION_UNSUPPORTED)).toBeTruthy();
  });
});

describe("the lanes look different, and the sent box is the loud one", () => {
  it("wraps a post in the v1 box, banner naming where it went", () => {
    renderStream({ sent: [message({ id: "m-1", body: "shipped it" })] });
    expect(screen.getByText("Sent to UI-kit design")).toBeTruthy();
    expect(screen.getByText("shipped it")).toBeTruthy();
  });

  it("names the CHANNEL when there is no thread title to name", () => {
    renderStream({
      threadTitle: null,
      sent: [message({ id: "m-1", body: "shipped it" })],
    });
    expect(screen.getByText("Posted to channel")).toBeTruthy();
  });

  it("renders the private 1:1 exchange PLAIN — my side right, the agent's left", () => {
    renderStream({
      entries: [
        wildFrame("operator", { text: "check the spec" }),
        wildFrame("private", { at: 2000, text: "on it" }),
      ],
    });
    // ⚠ MY TURN CARRIES NO WORD AT ALL SINCE 2026-08-27 (Samuel). It wore a blue
    // "You" in a label column; the SIDE is the signal now, and the avatar is the
    // identity. A label saying who the viewer is, on every line they type, is the
    // thing that made the row read as a log entry about them.
    expect(screen.queryByText("You")).toBeNull();
    // ⚠ THE ROW, NOT THE NEAREST DIV (updated 2026-08-31). The bubble became a
    // block container when the body started rendering markdown, so the text's
    // closest `div` is now the bubble; `justify-end` has always lived on the ROW
    // outside it. What is being pinned is unchanged: my turn is on the right.
    expect(screen.getByText("check the spec").closest("div.justify-end")).not.toBeNull();
    // ⚠ AND THE AGENT'S SIDE CARRIES NOTHING BUT THE TEXT (Samuel, 2026-08-27,
    // second pass). The quote bar and the "Agent" marker went with the "You"
    // label: ALIGNMENT is what tells the two sides apart now, and a rule plus a
    // noun on top of that restates what the layout already says.
    expect(screen.queryByText("Agent")).toBeNull();
    // ⚠ THE BLOCK, NOT THE LEAF (updated 2026-08-31). The body renders through
    // the transcript's markdown renderer now, which splits every text run into
    // leaf spans so a mention can be tinted — so the row's type and the absence
    // of chrome are pinned on the paragraph the renderer produced.
    const agentLine = screen.getByText("on it").closest("p") as HTMLElement;
    expect(agentLine.className).not.toMatch(/border-l/);
    expect(agentLine.className).toMatch(/text-text-primary/);
    // ⚠ THE WHOLE POINT: a private line must not wear the sent box's banner.
    expect(screen.queryByText(/^Sent to /)).toBeNull();
    expect(screen.queryByText("Posted to channel")).toBeNull();
  });

  /**
   * MY TURN WEARS MY FACE, AND NOTHING ELSE (Samuel, live review 2026-08-27).
   *
   * ⚠ NO NAME, NO EMAIL. The avatar is the identity; a name beside it is the
   * viewer's own name quoted back at them on every line they type.
   * ⚠ AND AN UNRESOLVED VIEWER RENDERS NO FACE rather than a placeholder — the
   * host reads it off the transcript (`view-model.ts › viewerPerson`) and a
   * viewer who has never posted has no hydrated row. Unknown is not empty.
   */
  it("puts the viewer's AVATAR on their own turn, and no name", () => {
    renderStream({
      entries: [wildFrame("operator", { text: "check the spec" })],
      viewer: {
        userId: "u-me",
        email: "me@dopl.dev",
        displayName: "Samuel Wang",
        avatarUrl: null,
      },
    });
    // The initials fallback IS the avatar when there is no image.
    expect(screen.getByText("S")).toBeTruthy();
    expect(screen.queryByText("Samuel Wang")).toBeNull();
    expect(screen.queryByText("me@dopl.dev")).toBeNull();
  });

  it("renders my turn with NO face when the viewer could not be resolved", () => {
    const { container } = renderStream({
      entries: [wildFrame("operator", { text: "check the spec" })],
    });
    expect(screen.getByText("check the spec")).toBeTruthy();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("renders an unknown frame's TEXT rather than dropping the line", () => {
    renderStream({
      entries: [wildFrame("awaiting_handoff")],
    });
    expect(screen.getByText(/thinking about it/)).toBeTruthy();
  });

  it("shortens a tool name at render and marks a failed one", () => {
    renderStream({
      entries: [
        frame({ kind: "tool", tool: "mcp__dopl__dopl_channel", text: "{}" }),
        frame({ at: 2000, kind: "result", ok: false, text: "boom" }),
      ],
    });
    // ⚠ Behind the run's chevron since 2026-08-27 — but UNCHANGED once opened.
    fireEvent.click(screen.getByRole("button", { name: toolRunLabel(1) }));
    expect(screen.getByText("dopl_channel")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
  });

  /**
   * THE AGENT'S OWN WORDS STAND ALONE (Samuel, live review 2026-08-27).
   *
   * ⚠ A bold "says" sat in the label column of every `thinking` row — a speech
   * verb attached to a machine, restating what the lane already is, in front of
   * the one thing in this lane a person actually reads. The text is `text-primary`
   * now, with nothing beside it.
   */
  it("gives the agent's own words NO label and the primary ink", () => {
    renderStream({ entries: [frame({ text: "tests are green" })] });
    expect(screen.queryByText("says")).toBeNull();
    const line = screen.getByText("tests are green");
    expect(line.className).toMatch(/text-text-primary/);
  });
});

/**
 * CONSECUTIVE TOOL ACTIVITY IS ONE GRAY ROW (Samuel, live review 2026-08-27).
 *
 * ⚠ THE FAILURE IT REPLACES: every tool call rendered its own row of raw JSON, so
 * an agent doing ordinary work buried the POST the operator opened the panel to
 * read. Collapsed by default, opening onto exactly the rows that were there.
 *
 * ⚠ AND NOTHING IS DROPPED. The count is real, the break is any non-tool lane, and
 * a failed call still says so on the row inside — a summary that HID a failure
 * would be worse than the noise it replaced.
 */
describe("a run of tool activity collapses into one row", () => {
  const run = [
    frame({ at: 1, kind: "tool", tool: "ToolSearch", text: '{"query":"x"}' }),
    frame({ at: 2, kind: "result", ok: true, text: "[1,2,3]" }),
    frame({ at: 3, kind: "tool", tool: "Bash", text: "npm test" }),
    frame({ at: 4, kind: "result", ok: true, text: "158 passed" }),
  ];

  it("counts tool USES, not frames — a call and its result are one", () => {
    const groups = groupStreamItems(
      buildAgentStream({ entries: run, sent: [] })
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].tools).toBe(2);
  });

  it("BREAKS the run on any non-tool lane — a said line is never swallowed", () => {
    const groups = groupStreamItems(
      buildAgentStream({
        entries: [
          run[0],
          frame({ at: 2, kind: "assistant", text: "now the tests" }),
          run[2],
        ],
        sent: [],
      })
    );
    expect(groups.map((g) => g.tools)).toEqual([1, null, 1]);
  });

  it("is COLLAPSED by default — the payloads are not on screen", () => {
    renderStream({ entries: run });
    expect(screen.getByRole("button", { name: toolRunLabel(2) })).toBeTruthy();
    expect(screen.queryByText("npm test")).toBeNull();
    expect(screen.queryByText("158 passed")).toBeNull();
  });

  it("opens onto the SAME detailed rows, and closes again", () => {
    renderStream({ entries: run });
    const summary = screen.getByRole("button", { name: toolRunLabel(2) });
    fireEvent.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("ToolSearch")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    fireEvent.click(summary);
    expect(screen.queryByText("npm test")).toBeNull();
  });

  it("keeps the 'Show more' ceiling INSIDE an expanded payload", () => {
    renderStream({
      entries: [frame({ kind: "tool", tool: "Bash", text: "x".repeat(400) })],
    });
    fireEvent.click(screen.getByRole("button", { name: toolRunLabel(1) }));
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });
});

describe("the log lane is bounded in both directions", () => {
  const LONG = "x".repeat(400);

  it("collapses a long line and offers to expand it", () => {
    renderStream({ entries: [frame({ text: LONG })] });
    const shown = screen.getByText(/x+…/);
    expect(shown.textContent!.length).toBeLessThan(LONG.length);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("expands on click and collapses again", () => {
    renderStream({ entries: [frame({ text: LONG })] });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(LONG)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText(LONG)).toBeNull();
  });

  it("offers no expander for a line that already fits", () => {
    renderStream({ entries: [frame({ text: "short" })] });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  /**
   * "SHOW MORE" REVEALS THE **WHOLE** LINE (Samuel, live review 2026-08-27).
   *
   * ⚠ THE BUG THIS PINS LIVED IN MAIN, NOT HERE — `main/session-narration.js` capped the agent's
   * prose at its CAPTION bound (300), so this control raised a display clamp over a string that
   * had already been cut mid-word with no marker, and expanding changed nothing the reader
   * cared about. The cap is `PROSE_CAP` now, equal to `EXPANDED_CHARS`.
   *
   * ⚠ SO THE CLAIM HERE IS AN EQUALITY, NOT A LENGTH: the expanded row's text is the source
   * text, character for character, with no tail. A `toBeGreaterThan` would have passed on the
   * broken build.
   */
  it("expanded, the row's text EQUALS the source — no tail, no mid-word cut", () => {
    // A frame at exactly main's ceiling: the longest string that can reach this component.
    const full = `${"word ".repeat(399)}end`;
    expect(full.length).toBeLessThanOrEqual(2000);
    renderStream({ entries: [frame({ text: full })] });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(full).textContent).toBe(full);
    expect(screen.queryByText(/Clipped/)).toBeNull();
  });

  it("CLIPS an enormous line even when expanded, and says it clipped", () => {
    // ⚠ A tool result can be a megabyte of JSON. "Show more" pasting all of it
    // into a 380px column destroys the stream it was meant to explain, and a
    // silent clip is a claim that this was the whole thing (INVARIANTS §9).
    renderStream({ entries: [frame({ text: "y".repeat(9000) })] });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/Clipped/)).toBeTruthy();
    expect(screen.queryByText("y".repeat(9000))).toBeNull();
  });

  /**
   * THE MAIN-CUT LINE SAYS SO TOO (2026-08-31, Samuel's cutoff report).
   *
   * ⚠ THE HOLE THIS PINS: main's `PROSE_CAP` EQUALS `EXPANDED_CHARS`, so a line
   * main shortened arrives at exactly the ceiling and `text.length >
   * EXPANDED_CHARS` is FALSE — the arithmetic calls the one string that most
   * needs a marker whole. The `truncated` flag is main's own confession and the
   * only trigger that can fire; a build that drops it re-opens the silent cut.
   * The wording differs deliberately: this tail exists NOWHERE, so the note must
   * not send the reader to a fuller log that does not hold it.
   */
  it("says it clipped when MAIN cut the line, even at exactly the ceiling", () => {
    renderStream({
      entries: [frame({ text: "y".repeat(8000), truncated: true })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/longer than the panel keeps/)).toBeTruthy();
  });

  it("marks a MAIN-CUT private reply under its plain face", () => {
    // ⚠ The private face renders whole with no clamp of its own — main already
    // bounded it — so the flag is the only thing standing between the operator
    // and prose that just stops mid-sentence (the exact report this fixes).
    renderStream({
      entries: [wildFrame("private", { text: "half an answ", truncated: true })],
    });
    expect(screen.getByText(/longer than the panel keeps/)).toBeTruthy();
  });
});

/**
 * THE EMPTY STATE IS ONE BLOCK (Samuel, 2026-08-27).
 *
 * ⚠ IT WAS TWO NODES IN TWO STYLES — a muted "Send a message to wake agent." over a body-size
 * black caption naming the agent by id. Two sentences about one situation, in two type sizes,
 * reading as two unrelated announcements. The pin is that there is exactly ONE node.
 */
describe("the empty state", () => {
  it("is one sentence, in one node, naming no id", () => {
    renderStream({ entries: [] });
    const line = screen.getByText(
      "Chat with your agent privately. Send a message to wake it up."
    );
    expect(line).toBeTruthy();
    // ⚠ NO NAME SUBSTITUTION. It quoted `Agent #<id>` at the operator before anything existed to
    // address — noise where the sentence's job is to say what the lane IS.
    expect(line.textContent).not.toMatch(/Agent #/);
    // ⚠ ONE NODE: the whole empty state is this paragraph and nothing beside it.
    expect(line.parentElement?.querySelectorAll("p")).toHaveLength(1);
  });

  it("still says THIS BUILD CANNOT SHOW IT when there was nothing to ask", () => {
    // ⚠ A DIFFERENT ABSENCE, and it keeps its own words: "asked and empty" is not "could not ask".
    renderStream({ entries: null, supported: false });
    expect(screen.getByText(NARRATION_UNSUPPORTED)).toBeTruthy();
  });
});
