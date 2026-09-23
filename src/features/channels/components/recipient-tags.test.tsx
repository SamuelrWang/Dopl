// @vitest-environment jsdom
/**
 * 🔒 **THE VISIBLE TAG IS THE REAL ADDRESS** (Samuel, 2026-09-22, decision #2200
 * option 1: *"Render the tag from the real address"*).
 *
 * The ask, verbatim in the room: *"i want to avoid scenarios where an agent has a
 * visible tag but it wasn't actually sent to that agent, and the other way
 * around."* So the tag is drawn from `recipient_user_ids` / `recipient_agent_ids`
 * — server-stamped, stripped from caller input — and NEVER from the body. The
 * cases below are that property from both sides: a tag appears for everyone the
 * post reached, and no tag can appear for anyone it did not.
 *
 * ⚠ **IT REVERSES THE DIRECTION OF THE 2026-09-20 CONSOLIDATION AND NOT ITS
 * PRINCIPLE** (`routed-tag.test.tsx`, which is still green and still right about
 * HUMAN rows). There is one surface for the address; that surface is now the
 * chrome, and the same wave updates the MCP tool description so agents stop typing
 * recipients into their prose.
 *
 * ⚠ **AGENT ROWS ONLY, AND THAT GATE IS TESTED HERE AS A CASE** — a person's
 * composer still inserts the handle into the words they send, so chrome on their
 * row would put one address in two places.
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

/** ⚠ THE TAGS ON ONE ROW, ASKED FOR BY HOOK AND NOT BY TEXT. The same face can appear
 *  in the BODY as a typed mention — which is the very state this feature is retiring — so
 *  a text query cannot tell the chrome from the words. */
const tagsAt = (seq: number): string[] =>
  [...rowAt(seq).querySelectorAll("[data-recipient-tag]")].map(
    (el) => el.textContent ?? ""
  );

describe("the tag says who the post actually reached", () => {
  it("faces a NAMED agent recipient as its handle", () => {
    renderWith(byAgent({ agentIds: [A] }));
    expect(tagsAt(1)).toEqual(["@dopl-worker"]);
  });

  it("faces an UNNAMED agent recipient by its shared face, never its id", () => {
    // ⚠ THE ARM THAT LEAKED A RAW ID ONCE (2026-09-15, `agent-id-visibility`). No
    // retypable handle exists, so there is no `@` to promise one — and eight
    // machine characters may not reach the screen in either form.
    renderWith(byAgent({ agentIds: [B] }));
    expect(tagsAt(1)).toEqual(["New Agent"]);
    expect(screen.queryByText(/h1anog51/)).toBeNull();
  });

  it("draws ONE TAG EACH when a post was addressed to several", () => {
    renderWith(byAgent({ agentIds: [A, B], userIds: [PEER] }));
    expect(tagsAt(1)).toEqual(["@dopl-worker", "New Agent", "@diana-taylor"]);
  });

  it("faces a PERSON recipient as their handle", () => {
    renderWith(byAgent({ userIds: [PEER] }));
    const tag = screen.getByText("@diana-taylor");
    // ⚠ THE HOVER CARRIES THE NAME THE HANDLE REPLACED — the `title` rule every
    // face in this tree follows.
    expect(tag.closest("[title]")?.getAttribute("title")).toBe("Diana Taylor");
  });

  it("names a recipient the roster cannot answer for rather than dropping them", () => {
    // ⚠ A DROPPED RECIPIENT IS THE SAME DEFECT IN THE OTHER DIRECTION: the row
    // would show fewer deliveries than it made. `Member` is `labelFor`'s own word.
    renderWith(byAgent({ userIds: ["u-nobody-knows"] }));
    expect(tagsAt(1)).toEqual(["Member"]);
  });

  it("🔒 reads the ADDRESS and not the body, even when the two disagree", () => {
    // 🔒 THE WHOLE POINT. The body names one agent; the delivery went to another.
    // The tag follows the delivery, and the words are left exactly as written.
    renderWith(byAgent({ body: "@orchestrator take this", agentIds: [A] }));
    expect(tagsAt(1)).toEqual(["@dopl-worker"]);
    expect(rowAt(1).textContent).toContain("@orchestrator take this");
  });
});

describe("no recipients draws nothing at all", () => {
  it("a RECORD — addressed to nobody by design — wears no tag and no marker", () => {
    renderWith(byAgent({ body: "for the log", agentIds: [], userIds: [] }));
    expect(tagsAt(1)).toEqual([]);
    expect(rowAt(1).textContent).not.toContain("@");
  });

  it("a row from before the address columns existed wears none either", () => {
    // ⚠ UNKNOWN IS NOT EMPTY (INVARIANTS §11) — but to a READER both are "nothing
    // to say", so one silence covers both and neither gets a badge the other lacks.
    renderWith(byAgent({ body: "history", agentIds: null, userIds: null }));
    expect(tagsAt(1)).toEqual([]);
  });

  it("🔒 a PERSON's own post wears none, however it was addressed", () => {
    // ⚠ THE GATE, AS A CASE. Their composer writes the handle into the words they
    // send (`composer.tsx › submit`), so chrome here would be one fact twice —
    // the 2026-09-20 ruling, kept.
    renderWith(
      message({
        body: "@agent-k3v7d2mq ship it",
        authorUserId: ME,
        recipientAgentIds: [A],
      })
    );
    // ⚠ ASKED BY HOOK: the BODY's own typed mention faces `@dopl-worker` too, which is
    // exactly the doubling a tag here would create.
    expect(document.querySelectorAll("[data-recipient-tag]")).toHaveLength(0);
  });
});

describe("a run may hold only one address", () => {
  it("BREAKS the run when the same agent posts to somewhere else", () => {
    // ⚠ THE TAG HANGS OFF THE PILL AND A CONTINUATION HAS NO PILL, so grouping two
    // different addresses would show the second row under the first row's tag —
    // the disagreement this whole change removes, rebuilt by the layout.
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: [A] }),
      byAgent({ seq: 2, body: "second", agentIds: [B] })
    );
    expect(tagsAt(1)).toEqual(["@dopl-worker"]);
    expect(tagsAt(2)).toEqual(["New Agent"]);
  });

  it("keeps the run when the address is unchanged", () => {
    // ⚠ THE OTHER HALF: the break is on the ADDRESS, not on every post, so an
    // agent's ordinary run still reads as one speaker with one header.
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: [A] }),
      byAgent({ seq: 2, body: "second", agentIds: [A] })
    );
    expect(document.querySelectorAll("[data-recipient-tag]")).toHaveLength(1);
    expect(tagsAt(1)).toEqual(["@dopl-worker"]);
  });

  it("keeps a LEGACY run whose rows carry no address at all", () => {
    // ⚠ ABSENT IS ITS OWN KEY (`addressKey`), so history groups as it always did
    // and this change cannot re-cut a transcript nobody edited.
    renderWith(
      byAgent({ seq: 1, body: "first", agentIds: null, userIds: null }),
      byAgent({ seq: 2, body: "second", agentIds: null, userIds: null })
    );
    // The AUTHOR pill ("Dopl Worker") appears once for the run, not once per row.
    expect(screen.getAllByText("Dopl Worker")).toHaveLength(1);
  });
});
