// @vitest-environment jsdom
/**
 * MY OWN AGENTS' ACTIVITY ROWS above the composer (Samuel, 2026-08-25).
 *
 * The properties that fail quietly:
 *
 *  - **AN INDICATOR IS A POSITIVE CLAIM.** "Could not ask" (`null` sessions — a
 *    plain browser, or a main without the feed) must render NOTHING, not an
 *    empty-but-present strip and certainly not a row. INVARIANTS §11: UNKNOWN is
 *    not EMPTY.
 *  - **AN IDLE AGENT IS NOT A WORKING ONE.** It is listening, and a row for it
 *    would be a permanent band over every channel that has ever launched one.
 *  - **THE SCOPE TRACKS THE COMPOSER.** A thread-scoped composer must not
 *    advertise an agent working on a different thread of the same channel — the
 *    reader would wait for a reply that is not coming to the transcript they are
 *    looking at.
 *  - **THE NAME IS THE POINT.** These are the operator's own agents, renameable,
 *    and a row that keeps saying `#ab12` after a rename is a row about
 *    somebody they no longer recognise.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  AgentActivityRows,
  agentActivityText,
  ownAgentsWorking,
} from "./agent-activity";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(cleanup);

const THREAD = "t-1";

function session(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: THREAD,
    agentId: "ab12cd34",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

describe("ownAgentsWorking — what the strip is allowed to claim", () => {
  it("takes a WORKING agent in this channel", () => {
    expect(ownAgentsWorking([session()], CHANNEL_ID)).toHaveLength(1);
  });

  it("leaves out idle and ended agents", () => {
    // ⚠ `idle` is LISTENING, not working. A row for it never clears, because
    // nothing about listening ends.
    const agents = ownAgentsWorking(
      [session({ sessionId: "s-i", state: "idle" }), session({ sessionId: "s-e", state: "ended" })],
      CHANNEL_ID
    );
    expect(agents).toHaveLength(0);
  });

  it("leaves out another channel's agent", () => {
    expect(
      ownAgentsWorking([session({ channelId: "ch-other" })], CHANNEL_ID)
    ).toHaveLength(0);
  });

  it("narrows to the OPEN THREAD when the composer is thread-scoped", () => {
    // ⚠ The row sits above the composer, so its scope has to be the composer's:
    // advertising a sibling thread's agent makes the reader wait on a transcript
    // they are not looking at.
    const agents = [session(), session({ sessionId: "s-2", taskId: "t-2" })];
    expect(ownAgentsWorking(agents, CHANNEL_ID, THREAD)).toHaveLength(1);
    expect(ownAgentsWorking(agents, CHANNEL_ID, THREAD)[0].taskId).toBe(THREAD);
  });

  it("shows the whole CHANNEL's agents when the composer is not thread-scoped", () => {
    const agents = [session(), session({ sessionId: "s-2", taskId: "t-2" })];
    expect(ownAgentsWorking(agents, CHANNEL_ID, null)).toHaveLength(2);
  });

  it("claims NOTHING when the feed could not be asked", () => {
    // ⚠ `null` is a plain browser or an older main — NOT an idle machine.
    expect(ownAgentsWorking(null, CHANNEL_ID)).toHaveLength(0);
  });
});

describe("the rows themselves", () => {
  it("renders one working agent, named", () => {
    render(<AgentActivityRows agents={ownAgentsWorking([session()], CHANNEL_ID)} />);
    expect(screen.getByText("#ab12cd34 is working…")).toBeTruthy();
  });

  it("STACKS two, one row each — never a count", () => {
    // ⚠ Samuel's ruling: these are the operator's own agents and they have names.
    // Collapsing to "2 agents are working…" (which the PEER row does, because it
    // cannot say anything useful about which) throws that away.
    render(
      <AgentActivityRows
        agents={ownAgentsWorking(
          [session(), session({ sessionId: "s-2", agentId: "zz99yy88" })],
          CHANNEL_ID
        )}
      />
    );
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("#ab12cd34 is working…")).toBeTruthy();
    expect(screen.getByText("#zz99yy88 is working…")).toBeTruthy();
    expect(screen.queryByText(/2 agents/)).toBeNull();
  });

  it("renders NOTHING at all when nobody is working", () => {
    // ⚠ Not an empty strip: this band sits directly above the composer and a
    // permanent blank one is chrome every channel pays for forever.
    const { container } = render(<AgentActivityRows agents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects a RENAME, because the name comes from the feed", () => {
    // `agentDisplayName` prefers the operator's own `displayName` over the id.
    render(
      <AgentActivityRows
        agents={ownAgentsWorking([session({ displayName: "Scout" })], CHANNEL_ID)}
      />
    );
    expect(screen.getByText("Scout is working…")).toBeTruthy();
    expect(screen.queryByText(/#ab12cd34/)).toBeNull();
  });

  it("says the same word the PEER row says", () => {
    // ⚠ One vocabulary for "this agent is busy" across both lanes. The finer
    // local signal (`agentDetailLabel`) belongs on the cards, not on a caption
    // that would flicker once per tool call.
    expect(agentActivityText(session())).toMatch(/ is working…$/);
  });
});
