// @vitest-environment jsdom
/**
 * THE ESCALATION CARD — an agent's structured question, and who may answer it
 * (Samuel, 2026-08-31).
 *
 * Its own file rather than a suite inside `transcript.test.tsx`, which sits at
 * the 500-line cap — `thread-card-actions.test.tsx`'s seam and the same reason.
 * That file keeps what a ROW looks like; this keeps what the CARD does.
 *
 * The properties that fail quietly:
 *
 *  - **THE CARD IS DECIDED ON RESERVED METADATA, NOT ON `kind`.** The message
 *    stays `kind='message'` or `main/targeting.js › classify` drops it and the
 *    human it is asking is never notified — half the feature, silently.
 *  - **THE BUTTONS ARE THE SERVER'S RULE, RESTATED.** Only a member the
 *    escalation TAGGED — or, when it tagged nobody, its author's operator — may
 *    answer. Drawing them off a looser rule shows a member a control that can
 *    only 403.
 *  - **ABSENT, NEVER DISABLED**, when the viewer may not answer or the host
 *    hands no callback. The pop-out and the guest lane both land there, and an
 *    inert button is indistinguishable from a broken one.
 *  - **THE CARD DEGRADES.** A row this cannot parse renders as an ordinary
 *    message carrying the same words in prose — which is what four surfaces
 *    that know nothing about the key show.
 *  - **§8's STALE CACHE.** An entry written before the key existed carries no
 *    `metadata.escalation` at all, and the row must render rather than throw.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows, threadRows } from "./view-model-rows";
import { ESCALATION_METADATA_KEY, ESCALATION_ANSWER_METADATA_KEY } from "../../escalation";
import { MENTIONS_METADATA_KEY } from "../../lib/mentions";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

const OTHER = "u-ada";

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    member({ userId: OTHER, displayName: "Ada Lovelace", role: "member" }),
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

/** An agent's escalation. `authorUserId` is its OPERATOR's — an agent posts on
 *  its operator's account (INVARIANTS §5). */
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

describe("the card renders the four fields", () => {
  it("shows the issue, the context, every option with its consequence, and the recommendation", () => {
    draw([escalationMessage()], { onAnswerEscalation: () => {} });
    expect(
      screen.getByText("Ship the migration now or wait for review?")
    ).toBeTruthy();
    expect(
      screen.getByText("The index is additive and reversible.")
    ).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
    expect(screen.getByText("Blocked until tomorrow.")).toBeTruthy();
    expect(
      screen.getByText("Reversible, nothing depends on it.")
    ).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
  });

  it("is a CARD, not a message bubble — and it is keyed on METADATA, not on `kind`", () => {
    // ⚠ The message is `kind='message'`. If the card were kind-keyed it could
    // never notify (`main/targeting.js › classify` drops every other kind), so
    // this assertion is a security property wearing a rendering test's clothes.
    const { container } = draw([escalationMessage()], {
      onAnswerEscalation: () => {},
    });
    expect(container.querySelector("[data-escalation-id='m-esc']")).toBeTruthy();
  });

  it("renders in the THREAD view too, off the same builder", () => {
    const rows = threadRows(
      [escalationMessage({}, { taskId: "t-1" })],
      "t-1",
      INDEX,
      formatChannelTimestamp
    );
    render(
      <Transcript
        rows={rows}
        index={INDEX}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerEscalation={() => {}}
      />
    );
    expect(
      screen.getByText("Ship the migration now or wait for review?")
    ).toBeTruthy();
  });

  it("STAYS IN THE CHANNEL VIEW even when it is threaded", () => {
    // ⚠ A threaded message normally collapses into its thread CARD in the
    // channel view. A question waiting on a human is the one row that must not
    // be one click away from being seen.
    draw([escalationMessage({}, { taskId: "t-1" })], {
      onAnswerEscalation: () => {},
    });
    expect(
      screen.getByText("Ship the migration now or wait for review?")
    ).toBeTruthy();
  });
});

describe("who gets buttons — the server's rule, restated", () => {
  it("the TAGGED member gets them", () => {
    const index = indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang" }),
        member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
      ],
      PEER
    );
    render(
      <Transcript
        rows={channelRows(
          [escalationMessage({}, { [MENTIONS_METADATA_KEY]: [PEER] })],
          [],
          index,
          formatChannelTimestamp
        )}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerEscalation={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Ship now" })).toBeTruthy();
  });

  it("with NOBODY tagged, the AUTHOR's operator gets them", () => {
    draw([escalationMessage()], { onAnswerEscalation: () => {} });
    expect(screen.getByRole("button", { name: "Ship now" })).toBeTruthy();
  });

  it("a member the escalation did not tag gets NO buttons — absent, not disabled", () => {
    const index = indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang" }),
        member({ userId: OTHER, displayName: "Ada Lovelace", role: "member" }),
      ],
      OTHER
    );
    render(
      <Transcript
        rows={channelRows(
          [escalationMessage({}, { [MENTIONS_METADATA_KEY]: [PEER] })],
          [],
          index,
          formatChannelTimestamp
        )}
        index={index}
        flashId={null}
        onOpenThread={() => {}}
        onAnswerEscalation={() => {}}
      />
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // …and the question is still fully readable.
    expect(screen.getByText("Ship now")).toBeTruthy();
    expect(screen.getByText("Live in ten minutes.")).toBeTruthy();
  });

  it("a host with NO write callback gets none either — the pop-out's case", () => {
    draw([escalationMessage()]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Ship now")).toBeTruthy();
  });
});

describe("pressing an option", () => {
  it("reports the escalation's OWN message id and the index", () => {
    // ⚠ IT NEVER NAMES AN AGENT. The server derives which one to wake off the
    // escalation's stamp; a client-supplied id would aim the wake anywhere.
    const onAnswer = vi.fn();
    draw([escalationMessage()], { onAnswerEscalation: onAnswer });
    fireEvent.click(screen.getByRole("button", { name: "Wait for review" }));
    expect(onAnswer).toHaveBeenCalledWith("m-esc", 1);
  });

  it("disables while an answer is in flight — busy is not a capability", () => {
    draw([escalationMessage()], {
      onAnswerEscalation: () => {},
      answerBusy: true,
    });
    expect(
      screen.getByRole("button", { name: "Ship now" }).hasAttribute("disabled")
    ).toBe(true);
  });
});

describe("an ANSWERED card", () => {
  const answer = message({
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
  });

  it("names who chose what, and drops the buttons", () => {
    draw([escalationMessage(), answer], { onAnswerEscalation: () => {} });
    expect(screen.getByText(/Diana Taylor chose/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("says YOU when the viewer answered", () => {
    draw(
      [
        escalationMessage(),
        message({ ...answer, authorUserId: ME, authorName: "Sam Wang" }),
      ],
      { onAnswerEscalation: () => {} }
    );
    expect(screen.getByText(/You chose/)).toBeTruthy();
  });

  it("FIRST ANSWER WINS — a second one in the page does not move the card", () => {
    // The server refuses a second at rest; a page carrying two (written before
    // that index existed) must not show a different choice than the agent got.
    draw(
      [
        escalationMessage(),
        answer,
        message({
          id: "m-ans-2",
          seq: 6,
          authorUserId: OTHER,
          authorName: "Ada Lovelace",
          body: "Wait for review",
          metadata: {
            [ESCALATION_ANSWER_METADATA_KEY]: {
              escalationMessageId: "m-esc",
              optionIndex: 1,
              agentId: "k3wpf7c5",
            },
          },
        }),
      ],
      { onAnswerEscalation: () => {} }
    );
    expect(screen.getByText(/Diana Taylor chose/)).toBeTruthy();
    expect(screen.queryByText(/Ada Lovelace chose/)).toBeNull();
  });
});

describe("it DEGRADES rather than breaking", () => {
  it("a message with NO escalation key is an ordinary row — §8's stale cache", () => {
    // ⚠ THE FIXTURE HAS THE KEY DELETED, not `null` and not `{}` — a cached
    // entry written by the previous bundle does not carry it at all.
    const stale = message({
      id: "m-old",
      body: "**Escalation:** an older row, in prose",
      metadata: {},
    });
    const { container } = draw([stale], { onAnswerEscalation: () => {} });
    expect(container.querySelector("[data-escalation-id]")).toBeNull();
    expect(
      screen.getByText(/an older row, in prose/)
    ).toBeTruthy();
  });

  it("a MALFORMED payload is an ordinary row too, never a throw", () => {
    const broken = escalationMessage({ id: "m-bad", body: "still readable" }, {
      [ESCALATION_METADATA_KEY]: { issue: "only an issue" },
    });
    const { container } = draw([broken], { onAnswerEscalation: () => {} });
    expect(container.querySelector("[data-escalation-id]")).toBeNull();
    expect(screen.getByText("still readable")).toBeTruthy();
  });
});
