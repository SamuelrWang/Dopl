// @vitest-environment jsdom
/**
 * **WHAT WOKE IT, AND WHO A POST WENT TO** — the two halves of Samuel's #3081 (2026-10-10): the
 * agent stream showed the boxes the agent POSTED and the agent working, and nothing about the
 * message it was answering or about whom its own posts were addressed to.
 *
 * ⚠ §1 SPLIT FROM `agent-stream.test.tsx` on that file's own seam, the way
 * `agent-stream-directed.test.tsx` was: that file pins WHICH LANE a frame is in and how the older
 * faces read, this pins the lane and the face added for #3081 plus the banner's addressee pills.
 * The units under it are `agent-stream-lanes.ts`, `agent-stream-inbound-box.tsx`,
 * `agent-stream-sent-box.tsx` and `lib/recipient-tags.ts › messageTagIds`.
 *
 * Every property here fails QUIETLY, which is why each is pinned:
 *
 *  - **AN ARRIVING MESSAGE MUST NOT LOOK POSTED.** `sent` and `inbound` are both "in the channel",
 *    so audience alone cannot separate them; the dark "Posted to…" banner means one thing on this
 *    surface, and an arriving message wearing it says the agent wrote somebody else's words.
 *  - **AND IT MUST NOT FALL TO `note`.** That was the state before the frame existed: a peer's
 *    message would have been an anonymous muted log line, which is the defect #3081 is about.
 *  - **A PILL MUST NEVER PRINT A RAW AGENT ID** (`agent-id-visibility.test.ts`'s standing rule),
 *    and an UNADDRESSED post must draw no pill at all rather than an empty marker.
 *  - **THE SERVER'S OWN PICK IS NOT AN ADDRESSEE.** `wake_reason` marks the agent the server chose
 *    to answer an unaddressed post; pilling it tells the operator their agent was named when
 *    nothing named it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentStream, SentToChannelBox } from "./agent-stream";
import {
  INBOUND_ANON_LABEL,
  INBOUND_OPERATOR_LABEL,
  inboundLabel,
} from "./agent-stream-inbound-box";
import { buildAgentStream, frameLane } from "./agent-stream-model";
import { messageTagIds } from "../lib/recipient-tags";
import { indexMembers } from "./view-model";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

/** An `inbound` frame as `main/session-narration.js › entryFor` emits one. */
function inboundFrame(over: Record<string, unknown> = {}): AgentNarrationEntry {
  return {
    at: 1_000,
    kind: "inbound",
    lane: "inbound",
    text: "please review the picker fix",
    senderName: "Diana Taylor",
    ...over,
  } as unknown as AgentNarrationEntry;
}

const AGENT_A = "a1b2c3d4";

/** The roster the pills resolve faces against — members AND every member's agents. */
function roster() {
  return indexMembers(
    [member({ userId: ME, displayName: "Sam Wang" }), member({ userId: PEER, displayName: "Diana Taylor" })],
    ME,
    new Map([[AGENT_A, { displayName: "Picker Fix", description: null }]])
  );
}

function renderStream(over: Partial<React.ComponentProps<typeof AgentStream>> = {}) {
  return render(
    <AgentStream
      entries={[]}
      supported
      sent={[]}
      destination={{ kind: "channel", name: "Dopl" }}
      {...over}
    />
  );
}

// ── 1. THE LANE ──────────────────────────────────────────────────────────────────────

describe("the inbound lane — the message that woke this agent", () => {
  it("routes main's `inbound` lane to the inbound lane, never to `sent`", () => {
    // ⚠ THE ORDER OF `frameLane`'s BRANCHES IS THE SUBJECT. `channel` and `inbound` are the two
    // halves of one exchange; reaching the `channel` arm would paint a peer's message as a post.
    expect(frameLane(inboundFrame())).toBe("inbound");
    expect(frameLane({ ...inboundFrame(), lane: "channel" } as AgentNarrationEntry)).toBe("sent");
  });

  /**
   * 🔴 **THE DISAGREEMENT FIXTURE — WITHOUT IT `frameLane`'s `inbound` BRANCH IS FAIL-OPEN**
   * (release review, 2026-10-11).
   *
   * ⚠ **THE CASE ABOVE DOES NOT TEST WHAT ITS COMMENT CLAIMS.** `LANE_BY_KIND` also maps
   * `inbound` → `inbound`, and every fixture here carries `kind: 'inbound'` BESIDE
   * `lane: 'inbound'` — so deleting `if (lane === "inbound") return "inbound"` left the
   * whole suite green, including the case whose comment says the branch ORDER is the
   * subject. The branch is real and load-bearing: it is what makes `lane` beat `kind`, and
   * `lane` is the only field that says who can SEE a frame.
   * ⚠ **`kind: 'post'` IS THE EXACT DISAGREEMENT THAT MATTERS**, not an arbitrary one: it
   * is the kind `LANE_BY_KIND` sends to `sent`, so a main that labels an arriving message
   * with a posting kind is the one build where the fall-through paints a counterparty's
   * words as this agent's own post.
   */
  it("🔒 lets `lane` BEAT `kind` when they disagree — a `post` kind on the inbound lane", () => {
    expect(frameLane({ ...inboundFrame(), kind: "post" } as AgentNarrationEntry)).toBe("inbound");
    // ...and an unknown kind on that lane is still inbound, never `note`.
    // ⚠ CAST THROUGH `unknown`, DELIBERATELY. `"whatever"` is not in the `kind` union and is
    // not meant to be: the point is a kind this tree has never heard of, because main and the
    // renderer ship separately and a new kind CAN land here first. A direct `as` is a type
    // error for exactly that reason (TS2352 — the types do not overlap), so the double cast is
    // the honest spelling of "deliberately out of contract" rather than a way around a
    // complaint. Widening the union to admit it would make the test prove nothing.
    expect(
      frameLane({ ...inboundFrame(), kind: "whatever" } as unknown as AgentNarrationEntry)
    ).toBe("inbound");
  });

  it("routes the KIND alone too, for a build that emits no lane", () => {
    // The `directed` precedent: main and this tree ship separately, so a kind can land before the
    // lane does. ⚠ It must not fall to `note` — an anonymous log line is the pre-#3081 behaviour.
    expect(frameLane({ at: 1, kind: "inbound", text: "hi" } as unknown as AgentNarrationEntry)).toBe(
      "inbound"
    );
    expect(frameLane({ at: 1, kind: "received", text: "hi" } as unknown as AgentNarrationEntry)).toBe(
      "inbound"
    );
  });

  it("carries the sender and the operator flag through to the item, lane-gated", () => {
    const [item] = buildAgentStream({ entries: [inboundFrame({ fromOperator: true })], sent: [] });
    expect(item.lane).toBe("inbound");
    expect(item.senderName).toBe("Diana Taylor");
    expect(item.fromOperator).toBe(true);
    // Absent is ORDINARY, not unknown: an older main stamps nothing and the face says so itself.
    const [bare] = buildAgentStream({
      entries: [inboundFrame({ senderName: "   ", fromOperator: false })],
      sent: [],
    });
    expect("senderName" in bare).toBe(false);
    expect("fromOperator" in bare).toBe(false);
  });

  it("a sender name never rides a lane whose face has nowhere to put it", () => {
    // Same discipline as `senderAgentId`: the field is gated on the lane, so a mislabelled frame
    // cannot smuggle a name onto a thinking row.
    const [item] = buildAgentStream({
      entries: [{ at: 1, kind: "assistant", text: "x", senderName: "Nobody" } as unknown as AgentNarrationEntry],
      sent: [],
    });
    expect("senderName" in item).toBe(false);
  });
});

describe("the inbound FACE", () => {
  it("names the sender, and says a complete sentence without one", () => {
    expect(inboundLabel("Diana Taylor")).toBe("Message received from Diana Taylor");
    // ⚠ The nameless form is a fact, not a gap — and the copy carries no em dash (Dopl voice).
    expect(inboundLabel(null)).toBe(INBOUND_ANON_LABEL);
    expect(inboundLabel("   ")).toBe(INBOUND_ANON_LABEL);
    expect(INBOUND_ANON_LABEL).not.toMatch(/[—–]/);
    expect(inboundLabel("Diana Taylor")).not.toMatch(/[—–]/);
  });

  /**
   * 🔴 **AND IT SAYS "you" FOR THE OPERATOR'S OWN POST — THE FLAG WAS CARRIED AND THEN
   * DROPPED** (release review, 2026-10-11).
   *
   * ⚠ **EVERY LAYER BUT THE LAST ONE WORKED.** Main stamps `fromOperator` *"so the face
   * can say 'you'"*, `buildAgentStream` carries it onto the item lane-gated (the case in
   * section 1 pins exactly that) — and `agent-stream.tsx` passed `senderName` and `at` to
   * the box and not this. So the operator's own channel post read back at them as
   * **"Message received from <their own display name>"**: their account, captioned as a
   * counterparty.
   * ⚠ **IT OUTRANKS THE RESOLVED NAME.** Main's `authorLabel` answers a display name or
   * *"<person>'s agent"*, and ruling 2 (2026-09-25) folds the operator's OWN agents into
   * the flag — so `fromOperator` WITH a name attached is still the operator's account
   * speaking, and naming it would print the viewer's own name at them.
   */
  it("says the sender is YOU when the operator's own account sent it", () => {
    expect(inboundLabel("Sam Wang", true)).toBe(INBOUND_OPERATOR_LABEL);
    // Only `true` counts, the `truncated` / `pending` discipline.
    expect(inboundLabel("Sam Wang", false)).toBe("Message received from Sam Wang");
    expect(inboundLabel("Sam Wang")).toBe("Message received from Sam Wang");
    // And with no name either, the flag is still the more specific fact.
    expect(inboundLabel(null, true)).toBe(INBOUND_OPERATOR_LABEL);
    expect(INBOUND_OPERATOR_LABEL).not.toMatch(/[—–]/);
  });

  it("🔒 THREADS the flag from the item to the face, which is the half that was missing", () => {
    // ⚠ THE WIRING IS THE DEFECT, so the assertion goes through the whole stream rather
    // than through `inboundLabel` alone: the words were already right and nobody read them.
    renderStream({ entries: [inboundFrame({ senderName: "Sam Wang", fromOperator: true })] });
    expect(screen.getByText(INBOUND_OPERATOR_LABEL)).toBeTruthy();
    expect(screen.queryByText("Message received from Sam Wang")).toBeNull();
  });

  it("renders the arriving message in its own box, NOT as a posted one", () => {
    renderStream({ entries: [inboundFrame()] });
    expect(screen.getByText("Message received from Diana Taylor")).toBeTruthy();
    expect(screen.getByText("please review the picker fix")).toBeTruthy();
    // THE PROPERTY: the dark "Posted to…" banner is the one claim this row may never make.
    expect(screen.queryByText(/^Posted to/)).toBeNull();
  });

  it("renders the body as MARKDOWN, like every other message face", () => {
    // ⚠ THE SAME PIN `agent-stream-directed.test.tsx` MAKES, and R1's reason: the body goes through
    // the TRANSCRIPT's renderer, never a fork of it. A message that read as formatted in the channel
    // and as raw asterisks here would be one message wearing two faces.
    const MD = "Review **this** and `that`:\n\n- one\n- two";
    const { container } = renderStream({ entries: [inboundFrame({ text: MD })] });
    expect(container.querySelector("strong")?.textContent).toBe("this");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    // ⚠ THE NEGATIVE HALF: none of the source characters survive as text.
    expect(screen.queryByText(/\*\*this\*\*/)).toBeNull();
  });

  it("confesses a main-side cut on the row that shows the text (INVARIANTS §9)", () => {
    // Main cuts the body at `POST_CAP`; the tail is not elsewhere on this surface, so the face that
    // shows the text must say so. ⚠ The copy is `agent-stream-prose.tsx › TruncatedNote`'s, matched
    // loosely on its verb so a reword does not fail this for the wrong reason.
    renderStream({ entries: [inboundFrame({ truncated: true })] });
    expect(screen.getByText(/Clipped/i)).toBeTruthy();
    // And an untruncated frame claims nothing.
    cleanup();
    renderStream({ entries: [inboundFrame()] });
    expect(screen.queryByText(/Clipped/i)).toBeNull();
  });
});

// ── 2. THE ADDRESSEE PILLS ───────────────────────────────────────────────────────────

describe("`messageTagIds` — which ids one message NAMES", () => {
  it("reads the stamped mention set and the resolved `to=` agents", () => {
    expect(
      messageTagIds({
        metadata: { mentionedUserIds: [PEER] },
        recipientAgentIds: [AGENT_A],
      })
    ).toEqual({ userIds: [PEER], agentIds: [AGENT_A] });
  });

  it("EXCLUDES an agent the SERVER picked for an unaddressed post", () => {
    // `wake_reason` is the server's own pick. Pilling it would tell the operator their agent was
    // named when nothing named it — the whole subtlety of this derivation.
    expect(
      messageTagIds({
        metadata: { wake_reason: "last_addressed", mentionedUserIds: [] },
        recipientAgentIds: [AGENT_A],
      })
    ).toEqual({ userIds: [], agentIds: [] });
  });

  it("answers `[]` for a row that resolved nobody, and for one that answers nothing", () => {
    expect(messageTagIds({ metadata: {}, recipientAgentIds: [] })).toEqual({ userIds: [], agentIds: [] });
    expect(messageTagIds({})).toEqual({ userIds: [], agentIds: [] });
  });
});

describe("the posted box's banner names WHO it was addressed to", () => {
  const addressed = () =>
    message({
      id: "m-9",
      authorUserId: ME,
      authorKind: "agent",
      body: "@diana-taylor handing this to @picker-fix",
      metadata: { mentionedUserIds: [PEER] },
      recipientAgentIds: [AGENT_A],
    });

  it("pills the agent by NAME and the person by handle, never a raw id", () => {
    renderStream({ sent: [addressed()], roster: roster() });
    const tags = document.querySelectorAll("[data-recipient-tag]");
    const faces = [...tags].map((t) => t.textContent);
    expect(faces).toContain("@picker-fix");
    expect(faces).toContain("@diana-taylor");
    // 🔒 THE STANDING RULE: an agent id is never printed at a person on this surface.
    expect(document.body.textContent).not.toContain(AGENT_A);
  });

  it("draws NOTHING for an unaddressed post, and nothing for a record", () => {
    renderStream({
      sent: [message({ id: "m-10", authorKind: "agent", body: "status for the room", metadata: {} })],
      roster: roster(),
    });
    expect(document.querySelectorAll("[data-recipient-tag]").length).toBe(0);
    // And no empty marker where the pills would have been.
    expect(screen.getByText(/^Posted to Dopl channel$/)).toBeTruthy();
  });

  it("draws NOTHING for the server's own pick on an unaddressed post", () => {
    renderStream({
      sent: [
        message({
          id: "m-11",
          authorKind: "agent",
          body: "on it",
          metadata: { wake_reason: "last_addressed" },
          recipientAgentIds: [AGENT_A],
        }),
      ],
      roster: roster(),
    });
    expect(document.querySelectorAll("[data-recipient-tag]").length).toBe(0);
  });

  it("draws NOTHING with no roster, rather than facing people it would have to invent", () => {
    // ⚠ The honest degradation for a host that has no roster in hand (the pop-out window): the
    // alternative is resolving against an empty index, which faces every person as "Member".
    renderStream({ sent: [addressed()] });
    expect(document.querySelectorAll("[data-recipient-tag]").length).toBe(0);
    expect(document.body.textContent).not.toContain("Member");
  });

  it("draws NOTHING on a narration echo, which has no addressee to read", () => {
    const post = { at: 2_000, kind: "post", lane: "channel", text: "a local echo" } as unknown as AgentNarrationEntry;
    renderStream({ entries: [post], sent: [], roster: roster() });
    expect(screen.getByText("a local echo")).toBeTruthy();
    expect(document.querySelectorAll("[data-recipient-tag]").length).toBe(0);
  });

  /**
   * ⚠ **A PENDING BOX CAN NEVER SHOW A PILL, AND THESE TWO CASES PIN THE PAIR OF FACTS
   * THAT MAKE THAT TRUE** (release review, 2026-10-11, item 5 — the comment was corrected,
   * not the behaviour; see `agent-stream-sent-box.tsx`'s banner note for the argument).
   *
   * ⚠ **NEITHER IS RED-THEN-GREEN AND THAT IS DELIBERATE** — nothing about the rendering
   * changed. They exist so the claim the old comment made ("the pills show on every face,
   * Pending included") cannot be written back without a failing test, and so the day a
   * held draft's addressees DO become resolvable the first case is already there to flip.
   */
  it("does not gate the pills on `pending` — the COMPONENT would draw them if a draft had any", () => {
    // Hand a pending box tags directly: the box is agnostic, and that is the half of the
    // old comment that was true. `who this is addressed to` is a fact about the draft, not
    // a claim that it was delivered — unlike the colour, which `paint` gates on `!pending`.
    render(
      <SentToChannelBox
        text="draft body"
        to={{ kind: "channel", name: "Dopl" }}
        at={1_000}
        tags={[{ kind: "person", id: PEER, face: "@diana-taylor", title: "Diana Taylor" }]}
        pending
        requestId={null}
      />
    );
    expect(document.querySelectorAll("[data-recipient-tag]").length).toBe(1);
  });

  it("but a HELD DRAFT carries no addressee ids at all — a frame has none to read", () => {
    // 🔒 THE OTHER HALF: `pending: true` is only ever set on a FRAME-backed item, and a
    // narration frame has no addressee. So `tags` is empty on every Pending box reachable
    // in the product, and the resolution the comment promised has no source: a
    // `ChannelConsentRequest` has no addressee field, and re-parsing the draft body is the
    // client re-derivation `lib/recipient-tags.ts` opens by forbidding.
    const held = { at: 3_000, kind: "post", lane: "channel", text: "a held draft", pending: true };
    const [item] = buildAgentStream({
      entries: [held as unknown as AgentNarrationEntry],
      sent: [],
    });
    expect(item.pending).toBe(true);
    expect(item.tagUserIds).toBeUndefined();
    expect(item.tagAgentIds).toBeUndefined();
  });

  it("the pills are IN the banner, beside the label and before the stamp", () => {
    renderStream({ sent: [addressed()], roster: roster() });
    const label = screen.getByText(/^Posted to Dopl channel$/);
    const banner = label.parentElement as HTMLElement;
    // The banner reads left to right: what happened, to whom, when.
    expect(banner.querySelectorAll("[data-recipient-tag]").length).toBe(2);
  });
});

// ── 3. ORDER ─────────────────────────────────────────────────────────────────────────

describe("stream order", () => {
  it("places the arriving message BEFORE the reaction it caused", () => {
    // The point of the frame: the operator reads the exchange in the order it happened.
    const items = buildAgentStream({
      entries: [
        inboundFrame({ at: 1_000 }),
        { at: 2_000, kind: "assistant", text: "looking now" } as AgentNarrationEntry,
      ],
      sent: [],
    });
    expect(items.map((i) => i.lane)).toEqual(["inbound", "thinking"]);
  });

  it("interleaves with the transcript by time, not by kind", () => {
    const items = buildAgentStream({
      entries: [inboundFrame({ at: 5_000 })],
      sent: [message({ id: "m-1", createdAt: new Date(1_000).toISOString() })],
    });
    expect(items.map((i) => i.lane)).toEqual(["sent", "inbound"]);
  });
});
