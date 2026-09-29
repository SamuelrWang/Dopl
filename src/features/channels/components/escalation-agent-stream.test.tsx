// @vitest-environment jsdom
/**
 * THE ESCALATION CARD IN THE AGENT STREAM — pipeline B (Samuel, 2026-08-31).
 *
 * ⚠ THERE ARE TWO ROW PIPELINES AND THIS FILE EXISTS BECAUSE OF IT. The channel
 * and thread transcripts share `view-model-rows.ts` → `transcript.tsx` →
 * `authored-row.tsx`; the agent stream has its OWN union, its OWN builder and
 * its OWN dispatch, and mounts no `AuthoredRow` at all. Two suites each agreeing
 * with themselves is not the same thing as the two ends agreeing, so this one
 * drives the STREAM over the same facts `escalation-card.test.tsx` drives the
 * transcript over.
 *
 * The properties that fail quietly:
 *
 *  - **THE PAYLOAD COMES OFF THE STORED ROW, NEVER OFF A FRAME.** A narration
 *    frame is machine-local text; the reserved key exists only on the message
 *    the server stored. Reading a frame would render a card off something a
 *    caller could write.
 *  - **AN ORDINARY POST IS UNTOUCHED.** Every other sent row keeps the plain
 *    `SentToChannelBox`, which is also exactly what a build without the key
 *    shows for an escalation.
 *  - **ABSENT, NEVER DISABLED**, when the host hands no callback — the pop-out
 *    agent window's case.
 *  - **AN ANSWERED CARD SHOWS THE CHOICE AND DROPS THE BUTTONS**, off the same
 *    first-answer-wins derivation the transcript uses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentStream } from "./agent-stream";
import { buildAgentStream } from "./agent-stream-model";
import { ESCALATION_METADATA_KEY } from "../escalation";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import { CHANNEL_ID, ME, message } from "./test-fixtures";
import { indexMembers } from "./view-model";
import { answersByEscalation } from "./view-model-display";

const ANSWER = async () => true;
/** The panel hands the viewer (`agent-panel.tsx`); without it every card is read-only. */
const VIEWER = indexMembers([], ME);

afterEach(cleanup);

const ESCALATION = {
  issue: "Ship the migration now or wait?",
  context: "It is additive and reversible.",
  options: [
    { label: "Ship now", consequence: "Live in ten minutes." },
    { label: "Wait for review", consequence: "Blocked until tomorrow." },
  ],
  recommendation: { index: 0, why: "Reversible." },
};

const ESCALATION_POST = message({
  id: "m-esc",
  seq: 4,
  authorUserId: ME,
  authorKind: "agent",
  clientMsgId: "agent-k3wpf7c5-2",
  body: "**Escalation:** Ship the migration now or wait?",
  metadata: { [ESCALATION_METADATA_KEY]: ESCALATION },
});

const PLAIN_POST = message({
  id: "m-plain",
  seq: 5,
  authorUserId: ME,
  authorKind: "agent",
  body: "Done — the report is in the knowledge base.",
});

function draw(
  sent: ReturnType<typeof message>[],
  props: Partial<Parameters<typeof AgentStream>[0]> = {}
) {
  return render(
    <AgentStream
      entries={[]}
      supported
      sent={sent}
      delivered={sent}
      {...props}
    />
  );
}

describe("the card renders in the stream", () => {
  it("shows the four fields, as its own box", () => {
    const { container } = draw([ESCALATION_POST], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
    });
    expect(container.querySelector("[data-agent-display] [data-escalation-id]")).toBeTruthy();
    expect(screen.getByText("Ship the migration now or wait?")).toBeTruthy();
    expect(screen.getByText("It is additive and reversible.")).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
    expect(screen.getByText("Reversible.")).toBeTruthy();
  });

  it("leaves an ORDINARY sent post on the plain box", () => {
    const { container } = draw([PLAIN_POST], { onAnswerDisplay: ANSWER, displayIndex: VIEWER });
    expect(container.querySelector("[data-agent-display] [data-escalation-id]")).toBeNull();
    expect(
      screen.getByText("Done — the report is in the knowledge base.")
    ).toBeTruthy();
  });

  it("reads the payload off the STORED ROW and not off a narration frame", () => {
    // ⚠ A frame carrying the same words renders as a plain sent row: the
    // reserved key exists only on the server's message, which is what makes the
    // card unforgeable. A build that read frames would draw buttons off text.
    const { container } = draw([], {
      entries: [
        {
          at: 1_000,
          kind: "post",
          text: "**Escalation:** Ship the migration now or wait?",
        },
      ],
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
    });
    expect(container.querySelector("[data-agent-display] [data-escalation-id]")).toBeNull();
  });
});

describe("answering from the stream", () => {
  it("reports the escalation's own message id and the index", () => {
    const onAnswer = vi.fn(async () => true);
    draw([ESCALATION_POST], { onAnswerDisplay: onAnswer, displayIndex: VIEWER });
    fireEvent.click(
      screen.getByRole("button", { name: "Option B: Wait for review" })
    );
    expect(onAnswer).toHaveBeenCalledWith({ channelId: CHANNEL_ID, messageId: "m-esc", index: 1 });
  });

  it("renders NO buttons without a callback — absent, not disabled", () => {
    draw([ESCALATION_POST]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // …and the question is still fully readable.
    expect(screen.getByText("Ship now")).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
  });

  it("renders no buttons when the viewer is not the answerer", () => {
    // Tagged someone else: the answerers rule (`answerersOf`) excludes the viewer.
    draw([{ ...ESCALATION_POST, metadata: { ...ESCALATION_POST.metadata, [MENTIONS_METADATA_KEY]: ["u-other"] } }], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("no viewer handed (the pop-out window) — read-only even with a write", () => {
    draw([ESCALATION_POST], { onAnswerDisplay: ANSWER });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("an ANSWERED card shows the choice and drops the buttons", () => {
    const { container } = draw([ESCALATION_POST], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
      displayAnswers: answersByEscalation(
        [
          message({
            id: "m-ans",
            seq: 6,
            authorUserId: ME,
            body: "Wait for review",
            metadata: { escalationAnswer: { escalationMessageId: "m-esc", optionIndex: 1 } },
          }),
        ],
        VIEWER
      ),
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // …and says who chose it, like the transcript card.
    expect(screen.getByText(/You chose/).textContent).toBe("You chose Wait for review");
    // ⚠ THE STRIP STAYS AND SAYS WHICH ONE WON (Samuel, 2026-09-20): the chosen
    // option keeps the black face, the rest take the switcher's grey. It is the
    // transcript card's rule, in the surface that must not drift from it.
    const options = Array.from(
      container.querySelectorAll("[data-agent-display] [data-escalation-id] [data-option-index]")
    ) as HTMLElement[];
    expect(options.map((el) => el.textContent)).toEqual(["Option A", "Option B"]);
    expect(options[1].className).toContain("auth-btn-3d");
    expect(options[0].className).toContain("bg-[var(--seg-fill)]");
  });
});

describe("the 2026-09-20 face, shared with the transcript card", () => {
  it("says Needs Your Decision and wears THIS agent's colour", () => {
    const { container } = draw([ESCALATION_POST], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
      color: "agent-07",
    });
    expect(screen.getByText("Needs Your Decision")).toBeTruthy();
    expect(screen.queryByText("Needs a decision")).toBeNull();
    const card = container.querySelector(
      "[data-agent-display] [data-escalation-id]"
    ) as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--agent-color-07)");
  });

  it("falls back to BLACK with no colour assigned", () => {
    const { container } = draw([ESCALATION_POST], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
    });
    const card = container.querySelector(
      "[data-agent-display] [data-escalation-id]"
    ) as HTMLElement;
    expect(card.style.backgroundColor).toBe("var(--surface-cta)");
  });

  it("names the recommendation in the option's own badge, and carries no dash", () => {
    const { container } = draw([ESCALATION_POST], {
      onAnswerDisplay: ANSWER,
      displayIndex: VIEWER,
    });
    expect(screen.getByText("Recommended:")).toBeTruthy();
    const card = container.querySelector(
      "[data-agent-display] [data-escalation-id]"
    ) as HTMLElement;
    const badge = Array.from(card.querySelectorAll("span")).find(
      (el) => el.textContent === "Option A" && el.className.includes("rounded-[6px]")
    );
    expect(badge?.className).toContain("bg-surface-cta");
    expect(card.textContent).not.toContain(" — ");
  });
});

describe("the model carries the message id beside the payload", () => {
  it("so no renderer has to parse it back out of the stream key", () => {
    // ⚠ `StreamItem.key` is `m:<id>`, declared in the stream model. A renderer
    // slicing it would be a second hand-written statement of one wire format —
    // the defect a single declaration exists to prevent.
    const items = buildAgentStream({
      entries: [],
      sent: [ESCALATION_POST],
      delivered: [ESCALATION_POST],
    });
    const item = items.find((i) => i.display);
    expect(item?.display?.messageId).toBe("m-esc");
    expect(item?.display?.display.from).toBe("escalation");
    expect(item?.display?.display.blocks[0]).toMatchObject({
      type: "text",
      content: "Ship the migration now or wait?",
    });
  });

  it("answers `undefined` for every ordinary post, so no row shape moved", () => {
    const items = buildAgentStream({
      entries: [],
      sent: [PLAIN_POST],
      delivered: [PLAIN_POST],
    });
    expect(items.every((i) => i.display === undefined)).toBe(true);
  });
});
