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
import { ESCALATION_METADATA_KEY } from "../../escalation";
import { ME, message } from "./test-fixtures";

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
      onAnswerEscalation: () => {},
    });
    expect(container.querySelector("[data-agent-escalation]")).toBeTruthy();
    expect(screen.getByText("Ship the migration now or wait?")).toBeTruthy();
    expect(screen.getByText("It is additive and reversible.")).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
    expect(screen.getByText("Reversible.")).toBeTruthy();
  });

  it("leaves an ORDINARY sent post on the plain box", () => {
    const { container } = draw([PLAIN_POST], { onAnswerEscalation: () => {} });
    expect(container.querySelector("[data-agent-escalation]")).toBeNull();
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
      onAnswerEscalation: () => {},
    });
    expect(container.querySelector("[data-agent-escalation]")).toBeNull();
  });
});

describe("answering from the stream", () => {
  it("reports the escalation's own message id and the index", () => {
    const onAnswer = vi.fn();
    draw([ESCALATION_POST], { onAnswerEscalation: onAnswer });
    fireEvent.click(screen.getByRole("button", { name: "Wait for review" }));
    expect(onAnswer).toHaveBeenCalledWith("m-esc", 1);
  });

  it("renders NO buttons without a callback — absent, not disabled", () => {
    draw([ESCALATION_POST]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // …and the question is still fully readable.
    expect(screen.getByText("Ship now")).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
  });

  it("renders no buttons when the viewer is not the answerer", () => {
    draw([ESCALATION_POST], {
      onAnswerEscalation: () => {},
      escalationAnswerable: false,
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("disables while an answer is in flight — busy is not a capability", () => {
    draw([ESCALATION_POST], {
      onAnswerEscalation: () => {},
      answerBusy: true,
    });
    expect(
      screen.getByRole("button", { name: "Ship now" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("an ANSWERED card shows the choice and drops the buttons", () => {
    draw([ESCALATION_POST], {
      onAnswerEscalation: () => {},
      answeredEscalations: new Map([["m-esc", 1]]),
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Wait for review")).toBeTruthy();
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
    const item = items.find((i) => i.escalation);
    expect(item?.escalation?.messageId).toBe("m-esc");
    expect(item?.escalation?.payload.issue).toBe(
      "Ship the migration now or wait?"
    );
  });

  it("answers `undefined` for every ordinary post, so no row shape moved", () => {
    const items = buildAgentStream({
      entries: [],
      sent: [PLAIN_POST],
      delivered: [PLAIN_POST],
    });
    expect(items.every((i) => i.escalation === undefined)).toBe(true);
  });
});
