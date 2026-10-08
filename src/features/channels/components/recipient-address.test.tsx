// @vitest-environment jsdom
/**
 * 🔒 **NO RECIPIENT PILL** (Samuel, 2026-10-08 — reverses decision #2200 of 2026-09-22).
 *
 * The pill that faced an agent post's `to=` set beside its attribution pill is gone. A person
 * an agent writes to is @-tagged inline in the body (the agent prompt and MCP doctrine say so),
 * and the server counts explicit `to=` members as mentions so the post reaches their Tags inbox
 * (`server/service-writes-metadata.ts`). What stays: a run still breaks when the address changes
 * (`view-model-rows.ts › isContinuation` over `lib/recipient-tags.ts › addressKey`).
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

describe("no chrome for the address", () => {
  it("🔒 an addressed agent post draws no recipient tag; the body is the only face", () => {
    renderWith(byAgent({ body: "@diana-taylor ship it", agentIds: [A], userIds: [PEER] }));
    expect(document.querySelectorAll("[data-recipient-tag]")).toHaveLength(0);
    expect(rowAt(1).textContent).toContain("ship it");
    expect(screen.queryByText(/h1anog51/)).toBeNull();
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
