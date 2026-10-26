// @vitest-environment jsdom
/**
 * THE DECISION CARD'S FACE in the transcript: the tag, the question, the option rows. What the
 * card DOES (who may answer, what a press reports) is `display-card.test.tsx`.
 *
 * The properties that fail quietly:
 *
 *  - **THE TAG IS THE POSTING AGENT'S COLOUR**, ink only when that agent has ended or was never
 *    coloured — `--surface-cta`, NOT the row accent's neutral `--border-strong`.
 *  - **THE CARD IS ATTRIBUTED TO THE AGENT THAT ASKED**, not to its bare operator.
 *  - **AN OPTION IS ONE ROW CARRYING ITS CONSEQUENCE**, with no letter strip to map it onto.
 *  - **THE ANSWER IS A STATE OF THE ROWS DERIVED FROM THE ANSWER MESSAGE**, never held here,
 *    which is what makes it survive a reload.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { ESCALATION_METADATA_KEY, ESCALATION_ANSWER_METADATA_KEY } from "../escalation";
import { ME, PEER, member, message } from "./test-fixtures";

const ANSWER = async () => true;

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

const ESCALATION = {
  issue: "Ship the migration now or wait for review?",
  context: "The index is additive and reversible.",
  options: [
    { label: "Ship now", consequence: "Live in ten minutes." },
    { label: "Wait for review", consequence: "Blocked until tomorrow." },
  ],
  recommendation: { index: 0, why: "Reversible, nothing depends on it." },
};

function escalationMessage(
  over: Parameters<typeof message>[0] = {},
  meta: Record<string, unknown> = {}
) {
  return message({
    id: "m-esc",
    seq: 4,
    authorUserId: ME,
    authorKind: "agent",
    clientMsgId: "agent-k3wpf7c5-2",
    body: "**Escalation:** Ship the migration now or wait for review?",
    metadata: { [ESCALATION_METADATA_KEY]: ESCALATION, ...meta },
    ...over,
  });
}

function draw(
  messages: ReturnType<typeof message>[],
  props: Partial<Parameters<typeof Transcript>[0]> = {}
) {
  return render(
    <Transcript
      rows={channelRows(messages, [], INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={() => {}}
      {...props}
    />
  );
}

describe("the decision face", () => {
  const card = (container: HTMLElement) =>
    container.querySelector("[data-escalation-id='m-esc']") as HTMLElement;
  const tag = (container: HTMLElement) =>
    card(container).querySelector("[data-display-tag]") as HTMLElement;
  const rows = (container: HTMLElement) =>
    Array.from(card(container).querySelectorAll("[data-option-index]")) as HTMLElement[];

  it("is a white card whose content-width tag says Needs your decision", () => {
    const { container } = draw([escalationMessage()], { onAnswerDisplay: ANSWER });
    expect(card(container).className).toContain("white-card");
    expect(tag(container).textContent).toBe("Needs your decision");
    expect(tag(container).className).toContain("rounded-full");
    expect(screen.queryByText("Needs Your Decision")).toBeNull();
  });

  it("the tag wears the POSTING AGENT's colour", () => {
    // The fixture's `client_msg_id` stamps agent `k3wpf7c5`; the index says which key it holds.
    const index = indexMembers(
      [member({ userId: ME, displayName: "Sam Wang" })],
      ME,
      new Map([["k3wpf7c5", { displayName: "Builder", description: null, color: "agent-04" as const }]])
    );
    const { container } = render(
      <Transcript
        rows={channelRows([escalationMessage()], [], index, formatChannelTimestamp)}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerDisplay={ANSWER}
      />
    );
    expect(tag(container).style.backgroundColor).toBe("var(--agent-color-04)");
  });

  it("an ENDED or UNKNOWN agent's tag turns ink, not the row's neutral grey", () => {
    const { container } = draw([escalationMessage()], { onAnswerDisplay: ANSWER });
    expect(tag(container).style.backgroundColor).toBe("var(--surface-cta)");
  });

  it("ATTRIBUTES THE CARD TO THE AGENT THAT ASKED, not to the bare operator", () => {
    const index = indexMembers(
      [member({ userId: ME, displayName: "Sam Wang" })],
      ME,
      new Map([
        ["k3wpf7c5", { displayName: "Decision Card Coder", description: null, color: "agent-09" as const }],
      ])
    );
    const { container } = render(
      <Transcript
        rows={channelRows([escalationMessage()], [], index, formatChannelTimestamp)}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerDisplay={ANSWER}
      />
    );
    expect(screen.getByText("Decision Card Coder")).toBeTruthy();
    expect(container.querySelector("[data-agent-color='agent-09']")).toBeTruthy();
    // An agent posts on its OPERATOR's account (INVARIANTS §5), so it hangs on the viewer's side.
    expect(card(container).closest("article")?.className).toContain("flex-row-reverse");
  });

  it("puts the question first at the heading step, and each consequence inside its option", () => {
    const { container } = draw([escalationMessage()], { onAnswerDisplay: ANSWER });
    const [ship, wait] = rows(container);
    expect(ship.textContent).toContain("Ship now");
    expect(ship.textContent).toContain("Live in ten minutes.");
    expect(ship.textContent).toContain("Recommended");
    expect(ship.textContent).toContain("Reversible, nothing depends on it.");
    expect(wait.textContent).toContain("Blocked until tomorrow.");
    expect(card(container).textContent).not.toMatch(/Option [AB]/);
    expect(card(container).textContent).not.toContain(" — ");
  });

  it("every option is a pressable row before an answer", () => {
    const { container } = draw([escalationMessage()], { onAnswerDisplay: ANSWER });
    for (const row of rows(container)) {
      expect(row.tagName).toBe("BUTTON");
      expect(row.hasAttribute("data-quiet")).toBe(false);
    }
  });

  it("AFTER an answer the chosen row goes ink and the rest go quiet", () => {
    const { container } = draw(
      [
        escalationMessage(),
        message({
          id: "m-ans",
          seq: 5,
          authorUserId: PEER,
          authorName: "Diana Taylor",
          body: "Ship now",
          metadata: {
            [ESCALATION_ANSWER_METADATA_KEY]: {
              escalationMessageId: "m-esc",
              optionIndex: 0,
              agentId: "k3wpf7c5",
            },
          },
        }),
      ],
      { onAnswerDisplay: ANSWER }
    );
    const [chosen, rest] = rows(container);
    expect(chosen.getAttribute("data-chosen")).toBe("true");
    expect(chosen.className).toContain("bg-surface-cta");
    expect(rest.getAttribute("data-quiet")).toBe("true");
    expect(rest.tagName).toBe("DIV");
  });

  it("THE CHOICE IS THE ANSWER MESSAGE, so it survives a reload by construction", () => {
    const { container } = draw([escalationMessage()], { onAnswerDisplay: ANSWER });
    for (const row of rows(container)) expect(row.hasAttribute("data-chosen")).toBe(false);
  });
});
