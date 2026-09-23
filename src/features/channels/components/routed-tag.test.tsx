// @vitest-environment jsdom
/**
 * 🔴 **THE SERVER-ROUTED `→ @agent` LINE IS DELETED (Samuel, 2026-09-20), AND
 * THIS FILE IS WHAT THAT RULING LOOKS LIKE NOW.**
 *
 * ⚠ **THE PROBLEM IT SOLVED IS SOLVED FURTHER UP.** It existed for Samuel's
 * 2026-09-05 report — *"even though it did reach the agent, it's confusing for
 * someone looking back that there was no tag … it should still auto-add the agent
 * tag before the message"* — and it answered the second half by drawing chrome
 * under the pill, because the stored body could not be touched. The composer now
 * writes the tag INTO the draft before it is sent (`composer.tsx › submit`), so
 * the tag really is before the message, in the author's own words, exactly as the
 * original ask said. Drawing it a second time as chrome would be the thing this
 * wave was called to stop: *"we can consolidate to one surface"*.
 *
 * ⚠ **SO THE CASES BELOW ARE ABSENCE CASES AND THEY ARE THE RULING.** Do not
 * "restore" them: a row that faces a routed address again puts one fact in two
 * places, and for a post sent by this build it would sit beside the identical tag
 * in the body.
 *
 * ⚠ **AND ON 2026-09-22 SAMUEL MOVED THE CONSOLIDATION THE OTHER WAY, FOR AGENT
 * ROWS ONLY** (decision #2200 option 1: *"Render the tag from the real address"*).
 * The address is chrome again — drawn from the stamped `to=` set beside the
 * attribution pill (`recipient-tags.tsx`, `lib/recipient-tags.ts`) — and the tool
 * description now tells agents not to type recipients at all, so the doubling this
 * file was written about does not come back. **Every case below is a HUMAN's row
 * and every one of them still holds**: a person's composer still writes the handle
 * into their words, so their row still faces nothing. `recipient-tags.test.tsx`
 * carries the new half, including that gate.
 *
 * ⚠ **THE STORED DATA IS UNTOUCHED AND STILL READ.** `recipient_agent_ids` and
 * `metadata.wake_reason` are still stamped, still carried on the row
 * (`view-model-rows.ts › routedAgentIds`) and still what every machine routes on;
 * `lib/agent-mentions.ts › routedTagLabel` and `lib/agent-post-stamp.ts ›
 * serverRoutedAgentIds` keep their own tests. What went is one renderer.
 * ⚠ **AND THE BODY IS STILL NEVER REWRITTEN AT REST** — the last case measures
 * that, unchanged. The composer adds the tag to a DRAFT on this machine, before
 * anything is stored; nothing edits a post after the fact.
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

describe("a routed row draws NO address chrome — the 2026-09-20 deletion", () => {
  it("faces nothing at all for an agent the server picked", () => {
    // 🔒 The exact row that used to render `→ @dopl-worker` under the pill.
    renderWith(routed("ship it", [A]));
    expect(screen.queryByText(/^→ /)).toBeNull();
    expect(screen.queryByText(/@dopl-worker/)).toBeNull();
  });

  it("faces nothing for an agent the feed has no name for either", () => {
    // ⚠ THE UNNAMED ARM WAS THE ONE THAT LEAKED A RAW ID ONCE (2026-09-15). It
    // cannot leak anything now, and this is the case that says so.
    renderWith(routed("ship it", [B]));
    expect(screen.queryByText(/^→ /)).toBeNull();
    expect(screen.queryByText(/h1anog51/)).toBeNull();
  });

  it("faces nothing when the server resolved TWO", () => {
    renderWith(routed("ship it", [A, B]));
    expect(screen.queryByText(/^→ /)).toBeNull();
  });

  it("🔒 and the BODY still carries the words the author wrote, untouched", () => {
    // ⚠ THE INVARIANT THE DELETION MUST NOT BE READ AS RELAXING: nothing rewrites
    // a stored post. The tag a reader sees on a message sent by this build was put
    // in the draft before it left the composer, which is a different act entirely.
    renderWith(routed("ship it", [A]));
    expect(screen.getByText("ship it")).toBeTruthy();
  });
});

describe("the cases that already added nothing, and still do", () => {
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
    expect(screen.queryByText(/@dopl-worker ship it/)).toBeNull();
  });
});
