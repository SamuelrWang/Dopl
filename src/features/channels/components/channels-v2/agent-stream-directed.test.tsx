// @vitest-environment jsdom
/**
 * THE PRIVATE DIRECT LANE'S FACES, AND MARKDOWN IN THE MESSAGE FACES — the two
 * 2026-08-31 rulings, pinned together because they land on the same rows.
 *
 * ⚠ §1 SPLIT FROM `agent-stream.test.tsx`, on that file's own seam: it pins WHICH
 * LANE a frame is in and how the older faces read; this pins the two faces added on
 * 2026-08-31 and what their bodies render as. `agent-stream-lanes.ts` and
 * `agent-stream-directed.tsx` are the units under it.
 *
 * The properties here fail QUIETLY, which is why each one is pinned:
 *
 *  - **WHO SENT WHAT TO WHOM.** Before this, a direction and its reply both fell
 *    through `frameLane`'s `note` fallback, so an orchestrator's question was
 *    indistinguishable from a status note about an idle timer.
 *  - **A PRIVATE EXCHANGE MUST NOT LOOK POSTED — OR TYPED BY THE OPERATOR.** The
 *    sent box's dark banner means one thing on this surface; and rendering a
 *    direction as an operator turn puts words in the operator's mouth on their own
 *    screen, under their own avatar.
 *  - **MARKDOWN RENDERS, AND THE LOG LANE'S CLIP SURVIVES.** The bulk lane bounds
 *    itself by slicing characters, which markdown cannot pass through intact — so
 *    the pin is that the message faces render structure and the log lane does not.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentStream } from "./agent-stream";
import {
  DIRECTED_ANON,
  directedLabel,
  directedReplyLabel,
} from "./agent-stream-directed";
import { frameLane } from "./agent-stream-model";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { message } from "./test-fixtures";

afterEach(cleanup);

function frame(over: Partial<AgentNarrationEntry> = {}): AgentNarrationEntry {
  return { at: 1_000, kind: "assistant", text: "thinking about it", ...over };
}

/** A frame carrying a kind THIS BUILD'S TYPE DOES NOT KNOW. ⚠ The cast is the
 *  subject: `kind` is a closed union here and an OPEN vocabulary on the wire. */
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

/**
 * THE PRIVATE DIRECT LANE'S TWO FACES (Samuel's ruling, 2026-08-31 — F-366's
 * operator half).
 *
 * ⚠ THE PROPERTY IS **WHO SENT WHAT TO WHOM**, and it fails silently in two
 * directions. Before this, both frames fell through `frameLane`'s `note` fallback
 * and an orchestrator's question was indistinguishable from a status note about
 * an idle timer. And the failure the OTHER way is the one this whole surface is
 * built against: a private agent-to-agent exchange wearing the sent box's dark
 * banner would tell an operator the counterparty had read it.
 */
describe("the private direct lane — another of my agents spoke to this one", () => {
  it("splits ONE wire lane into TWO faces on the kind", () => {
    // ⚠ Main tags both `lane: 'directed'` and tells them apart by `kind`
    // (`session-narration.js › entryFor` / `› retagDirected`). Correct on the
    // wire, where a lane is a statement about AUDIENCE and both are equally
    // private — and not enough here, where the question is which VOICE spoke.
    const inbound = { ...frame({ kind: "directed" }), lane: "directed" };
    const outbound = { ...frame({ kind: "directed-reply" }), lane: "directed" };
    expect(frameLane(inbound as unknown as AgentNarrationEntry)).toBe("directed");
    expect(frameLane(outbound as unknown as AgentNarrationEntry)).toBe(
      "directed-reply"
    );
  });

  it("maps the KINDS with no lane at all — a build that ships one and not the other", () => {
    // ⚠ The two trees ship separately; a main that emits the kind without the
    // lane must not land a direction in the anonymous log.
    expect(frameLane(wildFrame("directed"))).toBe("directed");
    expect(frameLane(wildFrame("directed-reply"))).toBe("directed-reply");
  });

  it("reads an UNRECOGNISED kind on the lane as the INBOUND face, never a note", () => {
    // ⚠ The honest degradation is the box that claims LESS — somebody said this
    // TO the agent — rather than an anonymous muted line.
    // ⚠ Built as a plain object: the kind is deliberately one the union does not
    // hold, so it cannot pass through `frame()`'s typed argument.
    const odd = { ...frame(), kind: "directed_followup", lane: "directed" };
    expect(frameLane(odd as unknown as AgentNarrationEntry)).toBe("directed");
  });

  it("gives each side its own banner, naming the RELATION", () => {
    renderStream({
      entries: [
        { ...frame({ kind: "directed", text: "ship the audit" }), lane: "directed" },
        {
          ...frame({ at: 2000, kind: "directed-reply", text: "audit is up" }),
          lane: "directed",
        },
      ] as unknown as AgentNarrationEntry[],
    });
    // ⚠ "your agent" IS THE WHOLE CLAIM AND IT IS TRUE: the lane is fenced on
    // `operator_user_id = ctx.userId` everywhere it is read or written, so the
    // counterparty is always one of this operator's own. There is no NAME to
    // print — nothing from the DB column set to the narration frame carries a
    // sender identity (F-376).
    expect(screen.getByText("Directed by your agent")).toBeTruthy();
    expect(screen.getByText("Reply to your agent")).toBeTruthy();
    expect(screen.getByText("ship the audit")).toBeTruthy();
    expect(screen.getByText("audit is up")).toBeTruthy();
  });

  it("does NOT wear the sent box's banner — nothing here left the machine", () => {
    renderStream({
      threadTitle: "UI-kit design",
      entries: [
        { ...frame({ kind: "directed", text: "ship the audit" }), lane: "directed" },
      ] as unknown as AgentNarrationEntry[],
    });
    expect(screen.queryByText(/^Sent to /)).toBeNull();
    expect(screen.queryByText("Posted to channel")).toBeNull();
    // ⚠ AND IT IS NOT THE OPERATOR EITHER. Rendering a direction as an operator
    // turn puts words in the operator's mouth on their own screen, under their
    // own avatar — the impersonation `session-seed.js › frameDirectedTurn` solves
    // for the MODEL, which this face solves for the HUMAN.
    expect(
      screen.getByText("ship the audit").closest("div.justify-end")
    ).toBeNull();
  });

  it("names an agent when one is ever resolved, through the display NAME", () => {
    // ⚠ A UNIT PIN ON THE LABEL, because the model has no name to pass today.
    // When a sender identity ships this is the only thing that has to be true.
    // ⚠ A raw agent id may never reach it — `agent-id-visibility.test.ts`.
    expect(directedLabel("Scout")).toBe("Directed by Scout");
    expect(directedReplyLabel("Scout")).toBe("Reply to Scout");
    // Absent, and whitespace-only, are the same absence.
    expect(directedLabel(null)).toBe(`Directed by ${DIRECTED_ANON}`);
    expect(directedReplyLabel("   ")).toBe(`Reply to ${DIRECTED_ANON}`);
  });
});

/**
 * THE MESSAGE FACES RENDER MARKDOWN (Samuel's ruling, 2026-08-31).
 *
 * ⚠ THE RULING IS R1 — REUSE THE TRANSCRIPT'S RENDERER, NEVER FORK IT. The
 * untrusted-body discipline lives in `message-markdown.tsx` (tokens to React
 * elements, no HTML string anywhere on the path), and a second renderer is how
 * that discipline comes to exist in two versions.
 *
 * ⚠ AND THE BULK LANE IS DELIBERATELY NOT A CALLER. `agent-stream-log.tsx` bounds
 * its rows by SLICING the string, which cuts a fence or a link mid-token; the
 * clip tests above are the other half of this pin.
 */
describe("markdown in the message faces", () => {
  /** Block structure plus inline marks — the fixture that separates "rendered"
   *  from "printed its own characters". */
  const MD = "Here is **bold** and `code`:\n\n- one\n- two\n\n```\nnpm test\n```";

  it("renders the agent's private answer as STRUCTURE, not as characters", () => {
    const { container } = renderStream({
      entries: [wildFrame("private", { text: MD })],
    });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("npm test");
    // ⚠ THE NEGATIVE HALF: none of the source characters survive as text.
    expect(screen.queryByText(/\*\*bold\*\*/)).toBeNull();
  });

  it("renders MY OWN turn the same way, inside the same bubble", () => {
    const { container } = renderStream({
      entries: [wildFrame("operator", { text: MD })],
    });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    // ⚠ THE GEOMETRY DID NOT MOVE when the bubble became a block container: same
    // inset ground, same 80% cap, still on the right.
    const bubble = container.querySelector("div.justify-end > div");
    expect(bubble?.className).toMatch(/max-w-\[80%\]/);
    expect(bubble?.className).toMatch(/bg-bg-inset/);
  });

  it("renders a DIRECTED box's body as markdown too", () => {
    const { container } = renderStream({
      entries: [
        { ...frame({ kind: "directed", text: MD }), lane: "directed" },
      ] as unknown as AgentNarrationEntry[],
    });
    expect(screen.getByText("Directed by your agent")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("renders the SENT box's body as markdown, and keeps its banner", () => {
    // ⚠ THE SAME STRING THE TRANSCRIPT RENDERS AS MARKDOWN ONE PANE OVER. A post
    // that read as formatted in the channel and as raw asterisks in the
    // operator's own review card was one message wearing two faces.
    const { container } = renderStream({
      sent: [message({ id: "m-1", body: MD })],
    });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("npm test");
    // ⚠ AND THE §6 SEAM DID NOT MOVE. The banner is the card's whole claim about
    // whether the counterparty has these words; only the body's renderer changed.
    expect(screen.getByText("Sent to UI-kit design")).toBeTruthy();
  });

  it("leaves the LOG lane plain, so its slice-and-clip still works", () => {
    // ⚠ NOT AN OVERSIGHT — the pin. `LogLine` truncates by slicing characters
    // (140 collapsed, 2000 expanded) and `line-clamp-2` cannot clamp a container
    // of sibling blocks, so markdown here would render wreckage AND lose the
    // bound that keeps a megabyte of tool JSON out of a 380px column.
    const { container } = renderStream({
      entries: [wildFrame("thinking", { text: MD })],
    });
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("does NOT tint an @-handle — this surface asked no roster", () => {
    // ⚠ A tint asserts the roster resolved somebody. Neither agent host holds a
    // roster (`agent-panel.tsx` builds `indexMembers([], …)` and says why), so
    // the handle renders as its own characters rather than as a resolved member.
    const { container } = renderStream({
      entries: [wildFrame("private", { text: "ask @diana about it" })],
    });
    expect(container.querySelector(".text-link")).toBeNull();
    // ⚠ THE WORDS SURVIVE WHOLE — the handle is still there, just untinted.
    expect(container.querySelector("p")?.textContent).toBe("ask @diana about it");
  });

  /**
   * 🔒 **BLOCK MARKDOWN NOW REACHES THE OPERATOR — F-376b RESOLVED (2026-08-31), AND
   * THIS CASE IS THE OTHER SIDE OF THE ONE IT REPLACES.**
   *
   * ⚠ **WHAT THIS CASE USED TO BE, AND WHY IT COULD NEVER HAVE FIRED.** It flattened
   * the fixture ITSELF (`MD.replace(/\s+/g, " ")`) and then asserted that no `ul` and
   * no `pre` rendered — a property of THIS component given already-flat input, which
   * is unconditionally true no matter what main does. Its docblock promised the
   * opposite ("when main stops flattening prose this test fails, and the failure is
   * the signal that F-376 closed"), and main stopped flattening the same day without
   * this case moving. **A pin that cannot fail is not evidence of anything**, so it is
   * replaced rather than re-pointed.
   *
   * ⚠ **IT DRIVES MAIN'S REAL SHAPER**, not a hand-rolled copy of it. `line` and
   * `prose` are two different functions with two different rules (a CAPTION is
   * flattened, a MESSAGE is not), and a second copy of either here is how the SPA
   * comes to believe something main does not do.
   */
  it("renders BLOCK structure through main's real prose shaper (F-376b)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prose } = require("../../../../../dopl-desktop-app/main/narration-text.js") as {
      prose: (v: string) => { text: string; truncated: boolean };
    };
    const shaped = prose(MD);
    // ⚠ THE INLINE MARKS STILL SURVIVE — the half that already worked, kept asserted so
    // a future narrowing of `prose` cannot trade one for the other.
    const { container } = renderStream({
      entries: [wildFrame("private", { text: shaped.text })],
    });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    // …and the BLOCKS now do too, because their newlines survived.
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });

  /**
   * ⚠ **AND A CAPTION IS STILL FLATTENED, WHICH IS THE OTHER HALF OF THE SAME RULE.**
   * F-376b's fix was a SPLIT, not a widening: `prose` keeps newlines because a message's
   * shape is content; `line` keeps the collapse because a newline in a one-row label is a
   * broken layout and the full value is elsewhere. Asserting only the first half would let
   * a later "consistency" edit flatten prose again, or wrap a tool summary over three rows.
   */
  it("…while a CAPTION is still flattened — the split, not a widening (F-376b)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { line, TEXT_CAP } = require("../../../../../dopl-desktop-app/main/narration-text.js") as {
      line: (v: string, cap: number) => string;
      TEXT_CAP: number;
    };
    expect(line("first\nsecond\tthird", TEXT_CAP)).toBe("first second third");
  });
});
