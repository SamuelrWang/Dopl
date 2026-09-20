// @vitest-environment jsdom
/**
 * THE DECISION CARD'S FACE — the bar, the badges and the buttons (Samuel,
 * 2026-09-20).
 *
 * Its own file rather than a suite inside `escalation-card.test.tsx`, which sat
 * at the 500-line cap when this wave landed — `thread-card-actions.test.tsx`'s
 * seam, and the same split this family already uses twice. That file keeps what
 * the card DOES: who may answer, what a press reports, how it degrades. This
 * keeps what it LOOKS LIKE, which is a different reason to change.
 *
 * The properties that fail quietly:
 *
 *  - **THE BAR IS THE POSTING AGENT'S COLOUR**, black only when that agent has
 *    ended or was never coloured — and black here is `--surface-cta`, NOT the
 *    row accent's neutral `--border-strong`. Two greys for one state is how a
 *    ruling gets half-applied.
 *  - **THE BAR'S TYPE IS THE ATTRIBUTION PILL'S NAME TYPE.** The pill spells it
 *    inline with no constant to import, so only an assertion can hold them
 *    together.
 *  - **THE CARD IS ATTRIBUTED TO THE AGENT THAT ASKED.** It was not, for three
 *    weeks: one hard-coded `agent={false}` made a named agent's question draw its
 *    operator's bare pill.
 *  - **THE CHOSEN BUTTON STAYS BLACK AND THE REST TAKE `--seg-fill`**, the
 *    switcher's own variable — and that state is derived from the ANSWER
 *    MESSAGE, never held here, which is what makes it survive a reload.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { ESCALATION_METADATA_KEY, ESCALATION_ANSWER_METADATA_KEY } from "../escalation";
import { ME, PEER, member, message } from "./test-fixtures";

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

describe("the 2026-09-20 face — the bar, and the buttons", () => {
  const bar = (container: HTMLElement) =>
    container.querySelector("[data-escalation-id='m-esc']") as HTMLElement;
  const strip = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll("[data-escalation-id='m-esc'] [data-option-index]")
    ) as HTMLElement[];

  it("the bar says Needs Your Decision, in the PILL's own name type", () => {
    // ⚠ Samuel: *"make the font styling of that header to be the same as that of
    // the bolded text that's in the badge for the name of the agent"* — the pill
    // spells it inline (`attribution-pill.tsx`), so the pairing can only be held
    // by asserting both faces carry the same three classes.
    draw([escalationMessage()], { onAnswerEscalation: () => {} });
    const label = screen.getByText("Needs Your Decision");
    for (const face of ["text-body", "font-semibold", "leading-tight"]) {
      expect(label.className).toContain(face);
    }
    expect(screen.queryByText("Needs a decision")).toBeNull();
  });

  it("the bar wears the POSTING AGENT's colour", () => {
    // The fixture's `client_msg_id` stamps agent `k3wpf7c5`; the index is what
    // says which key that session currently holds.
    const index = indexMembers(
      [member({ userId: ME, displayName: "Sam Wang" })],
      ME,
      new Map([
        [
          "k3wpf7c5",
          { displayName: "Builder", description: null, color: "agent-04" as const },
        ],
      ])
    );
    const { container } = render(
      <Transcript
        rows={channelRows([escalationMessage()], [], index, formatChannelTimestamp)}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerEscalation={() => {}}
      />
    );
    expect(bar(container).style.backgroundColor).toBe("var(--agent-color-04)");
  });

  it("an ENDED or UNKNOWN agent's card turns BLACK, not the row's neutral grey", () => {
    // ⚠ NOT `--border-strong`: Samuel ruled the ENDED face for this card
    // literally black, which is also the face every card wore before the
    // restyle. The row's ring keeps its own neutral; they are different marks.
    const { container } = draw([escalationMessage()], {
      onAnswerEscalation: () => {},
    });
    expect(bar(container).style.backgroundColor).toBe("var(--surface-cta)");
  });

  it("ATTRIBUTES THE CARD TO THE AGENT THAT ASKED, not to the bare operator", () => {
    // 🔒 Samuel, 2026-09-20, on the first live card: *"I see the decision card as
    // being sent from me? Is that a bug…"* — it was. The card passed
    // `agent={false}` and no agent id, so a question written by a NAMED agent
    // drew its operator's bare pill while that agent's ordinary posts, three
    // rows up, drew the name, the chip and the colour. The row data was right the
    // whole time; only this component refused to say so.
    const index = indexMembers(
      [member({ userId: ME, displayName: "Sam Wang" })],
      ME,
      new Map([
        [
          "k3wpf7c5",
          {
            displayName: "Decision Card Coder",
            description: null,
            color: "agent-09" as const,
          },
        ],
      ])
    );
    const { container } = render(
      <Transcript
        rows={channelRows([escalationMessage()], [], index, formatChannelTimestamp)}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerEscalation={() => {}}
      />
    );
    expect(screen.getByText("Decision Card Coder")).toBeTruthy();
    // ⚠ AND THE ROW WEARS THE ACCENT, so the card is not a second opinion about
    // which agent posted: one key reaches the bar, the side bar and the chip.
    expect(container.querySelector("[data-agent-color='agent-09']")).toBeTruthy();
    // ⚠ THE SIDE DOES NOT MOVE. An agent posts on its OPERATOR's account
    // (INVARIANTS §5), so this still hangs on the viewer's side — the same as
    // every other agent post, and NOT part of the bug.
    expect(bar(container).closest("article")?.className).toContain(
      "flex-row-reverse"
    );
  });

  it("names each option in the ENDED badge's face, with its words UNDER it and no dash", () => {
    // 🔒 Samuel, 2026-09-20: *"it should be a black badge similar to what you
    // have on the agents, where you have the ended badge … the badge and then
    // under it is the text … No more dashes"*.
    const { container } = draw([escalationMessage()], {
      onAnswerEscalation: () => {},
    });
    const panel = container.querySelector(
      "[data-escalation-id='m-esc']"
    ) as HTMLElement;
    // ⚠ THE FACE IS `agent-bits.tsx › AgentPill`'s, BY IMPORT — asserted on the
    // classes so a hand-rolled copy of them in this file would fail here.
    const badge = Array.from(panel.querySelectorAll("span")).find(
      (el) => el.textContent === "Option A" && el.className.includes("rounded-[6px]")
    );
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain("bg-surface-cta");
    expect(badge!.className).toContain("text-text-on-cta");
    // The words sit in their own block UNDER the badge, and no em dash joins them.
    const row = badge!.closest("li") as HTMLElement;
    expect(row.className).toContain("flex-col");
    expect(row.textContent).toBe("Option AShip now: Live in ten minutes.");
    expect(panel.textContent).not.toContain(" — ");
  });

  it("every option is BLACK before a press, and they are named Option A / Option B", () => {
    const { container } = draw([escalationMessage()], {
      onAnswerEscalation: () => {},
    });
    const options = strip(container);
    expect(options.map((el) => el.textContent)).toEqual(["Option A", "Option B"]);
    for (const el of options) expect(el.className).toContain("auth-btn-3d");
  });

  it("AFTER a press the chosen one stays black and the rest go the switcher's grey", () => {
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
      { onAnswerEscalation: () => {} }
    );
    const [chosen, rest] = strip(container);
    expect(chosen.className).toContain("auth-btn-3d");
    // ⚠ `--seg-fill` BY NAME — the same variable `shared/ui/segmented-control.tsx`
    // reads for Overview / Channel / Knowledge / Agents, which is the gray Samuel
    // pointed at. A literal here would be a second grey the day that token moves.
    expect(rest.className).toContain("bg-[var(--seg-fill)]");
    expect(chosen.className).not.toContain("bg-[var(--seg-fill)]");
  });

  it("THE CHOICE IS THE ANSWER MESSAGE, so it survives a reload by construction", () => {
    // ⚠ The card holds NO selection state: the grey/black split above is derived
    // from a second ROW in the page (`answersByEscalation`). This is the same
    // card drawn with that row absent — the state cannot be stale because there
    // is none to keep.
    const { container } = draw([escalationMessage()], {
      onAnswerEscalation: () => {},
    });
    for (const el of strip(container)) {
      expect(el.className).not.toContain("bg-[var(--seg-fill)]");
    }
  });
});
