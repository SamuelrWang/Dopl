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
import { buildAgentStream, frameLane } from "./agent-stream-model";
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

  it("renders the private 1:1 exchange PLAIN, with a word for the side", () => {
    renderStream({
      entries: [
        wildFrame("operator", { text: "check the spec" }),
        wildFrame("private", { at: 2000, text: "on it" }),
      ],
    });
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    // ⚠ THE WHOLE POINT: a private line must not wear the sent box's banner.
    expect(screen.queryByText(/^Sent to /)).toBeNull();
    expect(screen.queryByText("Posted to channel")).toBeNull();
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
    expect(screen.getByText("dopl_channel")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
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

  it("CLIPS an enormous line even when expanded, and says it clipped", () => {
    // ⚠ A tool result can be a megabyte of JSON. "Show more" pasting all of it
    // into a 380px column destroys the stream it was meant to explain, and a
    // silent clip is a claim that this was the whole thing (INVARIANTS §9).
    renderStream({ entries: [frame({ text: "y".repeat(5000) })] });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(/Clipped/)).toBeTruthy();
    expect(screen.queryByText("y".repeat(5000))).toBeNull();
  });
});
