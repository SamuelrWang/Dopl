// @vitest-environment jsdom
/**
 * **A MESSAGE THE SERVER ROUTED MUST NOT READ AS ADDRESSED TO NOBODY** (Samuel,
 * 2026-09-05: *"even though it did reach the agent, it's confusing for someone
 * looking back that there was no tag… it should still auto-add the agent tag
 * before the message"*).
 *
 * ⚠ **THE PROPERTY THIS FILE EXISTS FOR IS THE PAIR**, and neither half is worth
 * pinning alone: a row the SERVER aimed shows the resolved tag, and a row whose
 * author TYPED the tag shows no extra line — because that tag is already in the
 * body, where they put it, and a second one reads as two addressees. The rule
 * that separates them is `lib/agent-post-stamp.ts › serverRoutedAgentIds`, the
 * exact complement of the predicate RR3's own arm 3 turns on.
 *
 * ⚠ **AND THE BODY IS NEVER REWRITTEN.** The stored text is what the author typed
 * on every surface that reads the row — MCP reads, notifications, quotes — so the
 * displayed tag is chrome the transcript draws over a stamped decision, never an
 * edit to somebody's words. The last case measures exactly that.
 *
 * ⚠ ITS OWN FILE: `transcript.test.tsx` states it has no headroom under the
 * 500-line cap, the same reason `agent-attribution.test.tsx` and
 * `agent-pill-open.test.tsx` stand apart.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

const A = "k3v7d2mq";
const B = "h1anog51";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** A desktop feed that has NAMED agent A and knows B only by id. */
const INDEX = indexMembers(
  MEMBERS,
  ME,
  new Map([
    [A, { displayName: "Dopl Worker", description: null }],
    [B, { displayName: null, description: null }],
  ])
);

function renderWith(...messages: ReturnType<typeof message>[]) {
  render(
    <Transcript
      rows={channelRows(messages, [], INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={vi.fn()}
    />
  );
}

/** What the SERVER stamps when IT chose the recipient — `wake_reason` present. */
function routed(body: string, agentIds: string[]) {
  return message({
    body,
    authorUserId: ME,
    recipientAgentIds: agentIds,
    metadata: { wake_reason: "most recently addressed" },
  });
}

describe("the resolved tag on a message that named nobody", () => {
  it("faces the agent the server picked, by NAME", () => {
    renderWith(routed("ship it", [A]));
    expect(screen.getByText("→ @Dopl Worker")).toBeTruthy();
  });

  it("keeps the raw address one hover away", () => {
    // ⚠ THE SAME ARRANGEMENT `message-markdown.tsx › MentionText` USES for a
    // typed tag: the face is the name, the `title` is the thing it replaced. The
    // id is the address — stored, on the wire, what the desktop routes on — and
    // it must never become unreachable just because it is unpleasant to read.
    renderWith(routed("ship it", [A]));
    expect(screen.getByText("→ @Dopl Worker").getAttribute("title")).toBe(
      "@agent-k3v7d2mq"
    );
  });

  it("falls back to the id for an agent with no name — degradation, not breakage", () => {
    // An agent that was never renamed, and every agent that has ENDED: the
    // identity map is the live feed plus the peer projection and both drop a
    // stopped session, so an old row re-faces as its id. The id is always true.
    renderWith(routed("ship it", [B]));
    expect(screen.getByText("→ @agent-h1anog51")).toBeTruthy();
  });

  it("names BOTH when the server resolved two", () => {
    renderWith(routed("ship it", [A, B]));
    expect(screen.getByText("→ @Dopl Worker @agent-h1anog51")).toBeTruthy();
  });
});

describe("what must NOT grow a line", () => {
  it("🔒 a tag the AUTHOR TYPED adds nothing — recipients without a `wake_reason`", () => {
    // ⚠ THE CASE THE WHOLE RULE TURNS ON. `recipient_agent_ids` alone cannot
    // tell "the server chose this" from "the author typed this": the server's
    // own pick is stored in the same column. `wake_reason` is stamped ONLY when
    // the server chose (and is stripped from caller input, so it cannot be
    // posed). Reading recipients alone would print a duplicate tag over every
    // explicit mention in the channel.
    renderWith(
      message({
        body: "@agent-k3v7d2mq ship it",
        authorUserId: ME,
        recipientAgentIds: [A],
        metadata: {},
      })
    );
    expect(screen.queryByText(/^→ /)).toBeNull();
  });

  it("an ordinary message with no recipients adds nothing", () => {
    renderWith(message({ body: "morning", authorUserId: ME }));
    expect(screen.queryByText(/^→ /)).toBeNull();
  });

  it("a row from before the stamps existed adds nothing", () => {
    // Old rows carry neither field. That is "nothing to face here", never an
    // error and never a guess (INVARIANTS §11 — UNKNOWN is not EMPTY).
    renderWith(
      message({ body: "history", authorUserId: PEER, recipientAgentIds: null })
    );
    expect(screen.queryByText(/^→ /)).toBeNull();
  });
});

describe("the stored body", () => {
  it("🔒 is rendered VERBATIM — the tag is drawn beside it, never into it", () => {
    // ⚠ THE INVARIANT THAT MAKES THIS FEATURE SAFE. A body rewrite would put
    // words in the author's mouth on every other surface that reads the row, and
    // would have to be undone by hand if the routing rule ever changed. What is
    // stored stays stored; this is the transcript reporting a decision.
    renderWith(routed("ship it", [A]));
    expect(screen.getByText("ship it")).toBeTruthy();
    expect(screen.queryByText(/@Dopl Worker ship it/)).toBeNull();
  });
});
