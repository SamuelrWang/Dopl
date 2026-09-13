// @vitest-environment jsdom
/**
 * THE FLAT AGENT ROW (Samuel, 2026-09-13: *"it's actually really hard to
 * understand which agent is posting what … there's a specialized kind of box UI …
 * I want to change that to a more modern UI"*).
 *
 * ⚠ **WHAT THIS FILE IS FOR IS NOT WHETHER IT LOOKS RIGHT** — Samuel reviews that
 * live. It is the four properties a later edit breaks in silence:
 *
 *  - **THE SIDE STILL COMES FROM `author_user_id`** (INVARIANTS §5). The row's face
 *    changed; what decides which half of the screen it lands on did not, and
 *    `authorKind` is caller-assertable, so a regression here is a security-shaped
 *    one dressed as a layout tidy-up. (`transcript.test.tsx` pins the pair.)
 *  - **A RUN COLLAPSES, AND IT EXPIRES.** Same agent, adjacent, within five
 *    minutes shows ONE header; six minutes later earns its own. Both directions
 *    fail invisibly — a missing header reads as one long post, an extra one as two
 *    different speakers.
 *  - **THE LIVE RULE IS RESERVED, NOT INSERTED.** `border-l-2 border-transparent`
 *    is always there and only its COLOUR moves, or the transcript reflows by 2px
 *    the moment an agent ends. And an agent this machine does not know draws
 *    nothing at all — UNKNOWN is not a state (§11).
 *  - **THE ACCENT IS BORDER-ONLY.** `bits.tsx › agentAccent` returns a
 *    border/fill/ink triple built for a CHIP; if a refactor lets the fill through,
 *    every live agent's message gets a coloured background. (This assertion moved
 *    here from `agent-attribution.test.tsx`, where the pill used to carry it.)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { agentAccent } from "./bits";
import { indexMembers } from "./view-model";
import { AGENT_RUN_WINDOW_MS, threadRows } from "./view-model-rows";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

const A = "k3v7d2mq";
const B = "a1b2c3d4";
const AT = "2026-08-18T12:00:00.000Z";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** An index whose agent A is RUNNING — `ended` absent reads live, by contract
 *  (`view-model.ts › AgentIdentity.ended`: *absent is not ended*). */
const LIVE = indexMembers(
  MEMBERS,
  ME,
  new Map([[A, { displayName: null, description: null }]])
);
const ENDED = indexMembers(
  MEMBERS,
  ME,
  new Map([[A, { displayName: null, description: null, ended: true }]])
);
/** Every host with no desktop feed: the guest lane, a plain browser, the pop-out. */
const UNKNOWN = indexMembers(MEMBERS, ME);

function byAgent(
  id: string,
  over: { agentId?: string; seq?: number; at?: string; author?: string } = {}
) {
  const seq = over.seq ?? 1;
  return message({
    id,
    seq,
    body: `BODY-${id}`,
    authorUserId: over.author ?? ME,
    authorKind: "agent",
    metadata: { taskId: "t-1" },
    createdAt: over.at ?? AT,
    clientMsgId: `agent-${over.agentId ?? A}-${seq}`,
  });
}

function renderThread(messages: ReturnType<typeof message>[], index = LIVE) {
  render(
    <Transcript
      rows={threadRows(messages, "t-1", index, formatChannelTimestamp)}
      index={index}
      flashId={null}
      onOpenThread={vi.fn()}
    />
  );
}

const rowFor = (body: string) =>
  screen.getByText(body).closest("article") as HTMLElement;

describe("the agent row's face", () => {
  it("is a flat row: a 24px slot, then the name · the time, then the body", () => {
    renderThread([byAgent("m-1")]);
    const row = rowFor("BODY-m-1");
    // The ruling's own hook, and NOT the capsule's (/home repaints that raised).
    expect(row.getAttribute("data-agent-row")).toBe("");
    expect(row.querySelector("[data-attribution-pill]")).toBeNull();
    expect(row.querySelector(".bento")).toBeNull();
    // 24px — `Avatar size="xs"`'s box, stated once as the slot.
    const mark = row.querySelector("[data-agent-mark]") as HTMLElement;
    expect(mark.className).toContain("h-6");
    expect(mark.className).toContain("w-6");
    // ⚠ THE HEADER IS ONE LINE: name, an `aria-hidden` separator, the time.
    const name = row.querySelector("[data-agent-sender]") as HTMLElement;
    expect(name.textContent).toBe(`#${A}`);
    expect(name.className).toContain("text-body");
    expect(name.className).toContain("font-medium");
    expect(name.className).toContain("text-text-primary");
    const time = within(row).getByText(formatChannelTimestamp(AT));
    expect(time.className).toContain("text-caption");
    expect(time.className).toContain("text-text-muted");
    // The middot says nothing — the lesson the deleted `Agent · <id>` chip taught.
    expect(within(row).getByText("·").getAttribute("aria-hidden")).toBe("true");
  });

  /**
   * ⚠ **THE OPERATOR'S FACE PLUS A BOT BADGE WHEN THERE IS A PHOTO** — the §5
   * invariant unchanged: an agent has no face of its own and wears its operator's.
   * The badge is the display claim off `authorKind`, which is all it may move.
   */
  it("badges the operator's photo, and falls back to the agent MARK with none", () => {
    renderThread([byAgent("m-1")], LIVE);
    // No avatar on the fixture → the mark, never the operator's INITIAL, which on
    // an agent row is a picture of a person posting.
    expect(rowFor("BODY-m-1").querySelector("[data-agent-mark]")).toBeTruthy();
    expect(rowFor("BODY-m-1").querySelector("[data-agent-badge]")).toBeNull();
    cleanup();

    const withFace = indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang", avatarUrl: "https://x/a.png" }),
        member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
      ],
      ME,
      new Map([[A, { displayName: null, description: null }]])
    );
    renderThread([byAgent("m-1")], withFace);
    const row = rowFor("BODY-m-1");
    expect(row.querySelector("img")).toBeTruthy();
    expect(row.querySelector("[data-agent-badge]")).toBeTruthy();
    expect(row.querySelector("[data-agent-mark]")).toBeNull();
  });
});

describe("a run of one agent's posts shows the header once", () => {
  it("collapses a consecutive post inside the window, and HOLDS the slot", () => {
    renderThread([byAgent("m-1", { seq: 1 }), byAgent("m-2", { seq: 2 })]);
    expect(screen.getAllByText(`#${A}`)).toHaveLength(1);
    const second = rowFor("BODY-m-2");
    expect(second.querySelector("[data-agent-sender]")).toBeNull();
    // ⚠ THE EMPTY SLOT IS LOAD-BEARING: the body has to start on the same edge as
    // the row above it, and a missing gutter is what used to misalign them.
    const slot = second.firstElementChild as HTMLElement;
    expect(slot.className).toContain("w-6");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
  });

  /** 🔒 **FIVE MINUTES** (Samuel, 2026-09-13; Slack's own rule). */
  it("breaks the run once the gap passes five minutes", () => {
    const later = new Date(
      new Date(AT).getTime() + AGENT_RUN_WINDOW_MS + 1000
    ).toISOString();
    renderThread([
      byAgent("m-1", { seq: 1 }),
      byAgent("m-2", { seq: 2, at: later }),
    ]);
    expect(screen.getAllByText(`#${A}`)).toHaveLength(2);
  });

  /** ⚠ EXACTLY AT THE WINDOW STILL CONTINUES — the boundary is inclusive, stated
   *  once here so a later `<` does not silently split a run. */
  it("keeps the run at exactly the window", () => {
    const edge = new Date(
      new Date(AT).getTime() + AGENT_RUN_WINDOW_MS
    ).toISOString();
    renderThread([
      byAgent("m-1", { seq: 1 }),
      byAgent("m-2", { seq: 2, at: edge }),
    ]);
    expect(screen.getAllByText(`#${A}`)).toHaveLength(1);
  });

  /** ⚠ A DIFFERENT AGENT BREAKS IT REGARDLESS OF TIME (F-251, unchanged). */
  it("never merges two different agents, however close together", () => {
    renderThread([
      byAgent("m-1", { seq: 1 }),
      byAgent("m-2", { seq: 2, agentId: B }),
    ]);
    expect(screen.getAllByText(`#${A}`)).toHaveLength(1);
    expect(screen.getAllByText(`#${B}`)).toHaveLength(1);
  });
});

describe("the 2px rule says the agent is still running", () => {
  const border = (id: string) =>
    agentAccent(id)
      .split(" ")
      .find((c) => c.startsWith("border-")) as string;

  it("paints the agent's own tone while it is live, and only the BORDER", () => {
    renderThread([byAgent("m-1", { agentId: B })], indexMembers(
      MEMBERS,
      ME,
      new Map([[B, { displayName: null, description: null }]])
    ));
    const row = rowFor("BODY-m-1");
    expect(row.getAttribute("data-agent-live")).toBe("true");
    expect(row.className).toContain("border-l-2");
    expect(row.className).toContain(border(B));
    // ⚠ THE FILL AND THE INK DID NOT COME WITH IT. That triple is a CHIP's, and a
    // tinted message background is what letting it through looks like.
    for (const cls of agentAccent(B).split(" ")) {
      if (cls.startsWith("bg-") && cls !== "bg-transparent") {
        expect(row.className).not.toContain(cls);
      }
    }
    expect(row.className).toContain("bg-transparent");
  });

  it("reserves the rule and leaves it TRANSPARENT once the agent has ended", () => {
    renderThread([byAgent("m-1")], ENDED);
    const row = rowFor("BODY-m-1");
    expect(row.getAttribute("data-agent-live")).toBeNull();
    // ⚠ RESERVED EITHER WAY, or the transcript shifts 2px when an agent stops.
    expect(row.className).toContain("border-l-2");
    expect(row.className).toContain("border-transparent");
    expect(row.className).not.toContain(border(A));
  });

  it("draws nothing on an agent this machine does not know", () => {
    renderThread([byAgent("m-1")], UNKNOWN);
    const row = rowFor("BODY-m-1");
    expect(row.getAttribute("data-agent-live")).toBeNull();
    expect(row.className).toContain("border-transparent");
  });
});
