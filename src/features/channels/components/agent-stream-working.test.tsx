// @vitest-environment jsdom
/**
 * THE LIVE TAIL OF THE WORK STREAM (Samuel's ruling, 2026-09-14): while the
 * agent is working, the stream itself says so — under the most recent item, in
 * the column the reply is coming back to.
 *
 * The properties here fail QUIETLY, which is why each one is pinned:
 *
 *  - **IT IS THE ONE MAPPING'S WORD.** `agents-model.ts › agentLiveness` is what
 *    the header pill reads; a row that wrote its own "Thinking…" would be a
 *    second vocabulary for one fact, and the two would drift on the first
 *    re-word. The row's only edit is removing the label's own ellipsis, because
 *    the dots ARE the ellipsis here.
 *  - **NOTHING BUT `working` DRAWS.** A row claiming "Thinking" over a parked or
 *    ended agent is this surface's worst available lie, and the gate lives in one
 *    file precisely so it cannot be true on one of the two mounting surfaces.
 *  - **THE DOTS SNAP STILL UNDER REDUCED MOTION** and stay DRAWN — the same
 *    `animate-pulse` + `motion-reduce:animate-none` pairing `agent-activity.tsx`'s
 *    live dot uses. Reduced motion removes the movement, not the fact.
 *  - **IT IS INSIDE THE SCROLLER, AFTER THE LIST.** That is the whole ruling: a
 *    row rendered beside the stream instead of in it would be a second piece of
 *    chrome, which is what the header pill already was.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentStream } from "./agent-stream";
import { StreamWorkingRow, workingRowWord } from "./agent-stream-working";
import { agentLiveness } from "./agents-model";
import type { AgentNarrationEntry } from "./use-agent-narration";

afterEach(cleanup);

function frame(over: Partial<AgentNarrationEntry> = {}): AgentNarrationEntry {
  return { at: 1_000, kind: "assistant", text: "reading the panel", ...over };
}

function renderStream(
  over: Partial<React.ComponentProps<typeof AgentStream>> = {}
) {
  return render(
    <AgentStream entries={[frame()]} supported sent={[]} {...over} />
  );
}

describe("workingRowWord — a trim, never a rewrite", () => {
  it("takes the label's own ellipsis off, since the dots are the ellipsis", () => {
    // ⚠ `agentDetailLabel` ships "Thinking…" with the character IN it. Printed
    // beside three animated dots that is six dots in two typefaces.
    expect(workingRowWord("Thinking…")).toBe("Thinking");
    expect(workingRowWord("Thinking...")).toBe("Thinking");
  });

  it("leaves every other label exactly as the one mapping wrote it", () => {
    for (const label of [
      "Running Bash",
      "Running a command",
      "Sending a message",
      "Running",
    ]) {
      expect(workingRowWord(label)).toBe(label);
    }
  });
});

describe("StreamWorkingRow — only a WORKING agent says anything", () => {
  it("renders the liveness word for a working agent", () => {
    render(
      <StreamWorkingRow
        liveness={agentLiveness({ state: "working", detail: "thinking" })}
      />
    );
    // ⚠ THE WORD IS `agentLiveness`'s, not this row's: pinning it against the
    // function rather than a literal is what keeps a re-word landing in one place.
    const row = screen.getByRole("status");
    expect(row.textContent).toBe(
      workingRowWord(agentLiveness({ state: "working", detail: "thinking" }).label)
    );
    expect(row.textContent).toBe("Thinking");
  });

  it("uses the tool detail and the bare fallback, never a second vocabulary", () => {
    const { rerender } = render(
      <StreamWorkingRow
        liveness={agentLiveness({ state: "working", detail: "tool", toolLabel: "Bash" })}
      />
    );
    expect(screen.getByRole("status").textContent).toBe("Running Bash");
    // ⚠ A main that reports no detail still has a word, and it is the pill's.
    rerender(<StreamWorkingRow liveness={agentLiveness({ state: "working" })} />);
    expect(screen.getByRole("status").textContent).toBe("Running");
  });

  it("draws NOTHING for waiting, idle, ended, or an absent reading", () => {
    for (const liveness of [
      agentLiveness({ state: "idle", listening: true }), // waiting
      agentLiveness({ state: "idle" }),
      agentLiveness({ state: "ended" }),
      null,
      undefined,
    ]) {
      const { container, unmount } = render(
        <StreamWorkingRow liveness={liveness} />
      );
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("carries three dots that animate, and snap still under reduced motion", () => {
    const { container } = render(
      <StreamWorkingRow liveness={agentLiveness({ state: "working" })} />
    );
    const dots = container.querySelectorAll(".animate-pulse");
    expect(dots).toHaveLength(3);
    // ⚠ STAGGERED, or three dots pulsing in unison is one blinking bar.
    const delays = [...dots].map((d) =>
      [...d.classList].find((c) => c.startsWith("[animation-delay:"))
    );
    expect(new Set(delays).size).toBe(3);
    // ⚠ STILL, NOT GONE: `animate-none` leaves the dots drawn.
    for (const dot of dots) {
      expect(dot.className).toContain("motion-reduce:animate-none");
    }
    // ⚠ DECORATION: the accessible name is the word alone.
    expect(screen.getByRole("status").textContent).toBe("Running");
  });
});

describe("the stream mounts it under the most recent item", () => {
  it("puts the row INSIDE the scroller, after the list", () => {
    const { container } = renderStream({
      liveness: agentLiveness({ state: "working", detail: "thinking" }),
    });
    const scroller = container.querySelector(".overflow-y-auto");
    const row = screen.getByRole("status");
    // ⚠ THE RULING ITSELF: same scroll container as the messages, so it scrolls
    // with them and the follow-the-bottom effect keeps it on screen.
    expect(row.parentElement).toBe(scroller);
    const list = scroller?.querySelector("ol");
    expect(list).toBeTruthy();
    // ⚠ AFTER the list — "directly under the most recent message".
    expect(
      list!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows it even before the lane has a single row", () => {
    // ⚠ A JUST-WOKEN AGENT is exactly the case the operator is watching for: they
    // sent a message, nothing has come back yet, and the empty state alone reads
    // as an agent that did not hear them.
    renderStream({
      entries: [],
      liveness: agentLiveness({ state: "working", detail: "thinking" }),
    });
    expect(screen.getByRole("status").textContent).toBe("Thinking");
  });

  it("says nothing at all when the stream is handed no liveness", () => {
    // ⚠ THE DEFAULT, and every host that has not been taught the prop keeps its
    // old rendering byte for byte (`marketing/.../demo-agent-view.tsx`).
    renderStream({});
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays silent for an ENDED agent, whose stream still renders", () => {
    renderStream({ liveness: agentLiveness({ state: "ended" }) });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("reading the panel")).toBeTruthy();
  });
});
