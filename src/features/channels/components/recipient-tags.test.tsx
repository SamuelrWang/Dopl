// @vitest-environment jsdom
/**
 * 🔒 **THE TAG ROW IS DERIVED FROM WHAT THE MESSAGE NAMES** (Samuel, 2026-10-08, reversing the
 * same day's pill removal). Every message, human or agent, shows a row of everyone it names:
 * people from the server-stamped `mentionedUserIds`, agents from the server-resolved
 * `recipient_agent_ids`. Never a client re-parse, so a typed `@word` that resolved to nobody is
 * never pilled. Ordered by where each name first appears in the body.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

/** Two agent instances: A is named on this machine, B is known only by id. */
const A = "k3v7d2mq";
const B = "h1anog51";

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
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

/** A post one of the viewer's own agents sent, addressed however the caller says. */
function byAgent(
  over: {
    body?: string;
    seq?: number;
    agentIds?: string[] | null;
    userIds?: string[] | null;
  } = {}
) {
  const seq = over.seq ?? 1;
  return message({
    id: `m-${seq}`,
    seq,
    body: over.body ?? "ship it",
    authorUserId: ME,
    authorKind: "agent",
    clientMsgId: `agent-${A}-${seq}`,
    recipientAgentIds: over.agentIds === undefined ? [] : over.agentIds,
    recipientUserIds: over.userIds === undefined ? [] : over.userIds,
  });
}

/** One row, by the seq `byAgent` keys its id on. */
const rowAt = (seq: number) =>
  document.querySelector(`[data-message-id="m-${seq}"]`) as HTMLElement;

const MENTIONS = "mentionedUserIds";

/** ⚠ ASKED BY HOOK: the same face also appears in the BODY as a typed mention. */
const tagsAt = (seq: number): string[] =>
  [...rowAt(seq).querySelectorAll("[data-recipient-tag]")].map((el) => el.textContent ?? "");

/** A post by a PERSON (the viewer), with the server's stamps as given. */
function byPerson(over: { body: string; seq?: number; tagged?: string[]; agentIds?: string[] }) {
  const seq = over.seq ?? 1;
  return message({
    id: `m-${seq}`,
    seq,
    body: over.body,
    authorUserId: ME,
    metadata: over.tagged ? { [MENTIONS]: over.tagged } : {},
    recipientAgentIds: over.agentIds ?? [],
  });
}

describe("the tag row names what the server resolved", () => {
  it("tags the people the BODY tags, on a person's own post (one rule for everyone)", () => {
    renderWith(byPerson({ body: "@diana-taylor can you look", tagged: [PEER] }));
    expect(tagsAt(1)).toEqual(["@diana-taylor"]);
  });

  it("tags a `to=`-only AGENT the body never names", () => {
    renderWith(byAgent({ body: "ship it", agentIds: [A] }));
    expect(tagsAt(1)).toEqual(["@dopl-worker"]);
  });

  it("draws each name ONCE however often the body repeats it", () => {
    renderWith(
      byPerson({ body: "@diana-taylor hi, @diana-taylor again", tagged: [PEER, PEER], agentIds: [A, A] })
    );
    expect(tagsAt(1)).toEqual(["@diana-taylor", "@dopl-worker"]);
  });

  it("never pills a typed @word the server resolved to nobody", () => {
    renderWith(byPerson({ body: "cc @nobody and @ghost" }));
    expect(tagsAt(1)).toEqual([]);
    expect(rowAt(1).textContent).toContain("@nobody");
  });

  it("orders by the BODY, not by the server's stamp order", () => {
    renderWith(
      byPerson({ body: "@dopl-worker first, then @diana-taylor", tagged: [PEER], agentIds: [A] })
    );
    expect(tagsAt(1)).toEqual(["@dopl-worker", "@diana-taylor"]);
  });

  it("faces an unnamed agent by its shared face, never its id", () => {
    renderWith(byAgent({ body: "go", agentIds: [B] }));
    expect(tagsAt(1)).toEqual(["New Agent"]);
    expect(screen.queryByText(/h1anog51/)).toBeNull();
  });

  it("draws nothing for a message that names nobody", () => {
    renderWith(byPerson({ body: "just a note" }));
    expect(tagsAt(1)).toEqual([]);
  });
});

describe("a run may hold only one address", () => {
  it("BREAKS the run when the same agent posts to somewhere else", () => {
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: [A] }),
      byAgent({ seq: 2, body: "second", agentIds: [B] })
    );
    // Two runs, so the AUTHOR pill appears on both rows.
    expect(screen.getAllByText("Dopl Worker")).toHaveLength(2);
  });

  it("keeps the run when the address is unchanged", () => {
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: [A] }),
      byAgent({ seq: 2, body: "second", agentIds: [A] })
    );
    expect(screen.getAllByText("Dopl Worker")).toHaveLength(1);
  });

  it("keeps a LEGACY run whose rows carry no address at all", () => {
    // ⚠ ABSENT IS ITS OWN KEY (`addressKey`), so history groups as it always did.
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: null, userIds: null }),
      byAgent({ seq: 2, body: "second", agentIds: null, userIds: null })
    );
    expect(screen.getAllByText("Dopl Worker")).toHaveLength(1);
  });
});
