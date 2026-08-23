// @vitest-environment jsdom
/**
 * WHICH OF MY AGENTS SAID THIS — per-message attribution in the transcript
 * (Samuel, 2026-08-22: two of his agents posted in one thread and the transcript
 * showed an undifferentiated "Agent" pill — *"it looks like one agent sending"*).
 *
 * The properties that fail quietly, and are therefore what this file is for:
 *
 *  - **THE RUN-GROUPING IS HALF THE FIX, AND THE HALF THAT IS EASY TO LOSE.** A
 *    continuation drops the avatar, the name line AND the chip — so two agents
 *    alternating collapsed into one unbroken run under one name, and no amount of
 *    work on the PILL fixes a row that has no pill. `isContinuation` therefore
 *    breaks on a different agent id.
 *  - **UNSTAMPED IS "CANNOT SAY", NOT "SOME OTHER AGENT".** Three real classes of
 *    agent post carry no per-instance stamp, and all three must render exactly as
 *    they did before this existed (INVARIANTS §11).
 *  - **THE COURTESY FORM IS THE DISCRIMINATOR CASE.** `main/channel-post.js`
 *    stamps machine-level posts `agent-<channelUUID>-<seq>`, and a channel UUID
 *    can BEGIN with eight id-shaped characters — so only an ANCHORED match tells
 *    the two apart, and a `startsWith` would attribute a machine post to an agent
 *    that does not exist.
 *  - **ONE REGEX.** `agentSentMessages` (F-251) splits the agent panel's Sent lane
 *    on the same token. Two hand-written charsets for one wire format is how the
 *    two come to disagree about what an agent id is — the review wave already
 *    caught one duplicate attempt.
 *  - **THE ACCENT IS DETERMINISTIC.** An operator who learns that `k3v7d2mq` is
 *    the blue one must still be right after a refetch reorders the transcript.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { agentAccent } from "./bits";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { parseAgentPostStamp } from "./agents-model";
import { agentSentMessages } from "./agent-panel";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

const A = "k3v7d2mq";
const B = "a1b2c3d4";

/** An agent post by ONE of the viewer's own instances. */
function byAgent(
  id: string,
  over: { agentId?: string | null; seq?: number; body?: string } = {}
) {
  const seq = over.seq ?? 1;
  return message({
    id,
    seq,
    body: over.body ?? `BODY-${id}`,
    authorUserId: ME,
    authorKind: "agent",
    metadata: { taskId: "t-1" },
    clientMsgId:
      over.agentId === null ? null : `agent-${over.agentId ?? A}-${seq}`,
  });
}

function renderThread(messages: ReturnType<typeof message>[]) {
  render(
    <Transcript
      rows={threadRows(messages, "t-1", INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={vi.fn()}
    />
  );
}

/** The `<article data-message-id>` a body landed in. */
const rowFor = (body: string) =>
  screen.getByText(body).closest("article") as HTMLElement;

describe("parseAgentPostStamp — the one reader of the wire format", () => {
  it("takes the id out of a per-instance stamp", () => {
    expect(parseAgentPostStamp(`agent-${A}-1`)).toBe(A);
    expect(parseAgentPostStamp(`agent-${A}-4096`)).toBe(A);
  });

  /**
   * ⚠ THE COURTESY FORM IS THE WHOLE REASON THE PATTERN IS ANCHORED. A channel
   * UUID's first eight characters can be id-shaped, and this post is about the
   * MACHINE rather than about one agent — attributing it to `a1b2c3d4` would put
   * a pill on a row naming an agent that never existed.
   */
  it("refuses the machine-level courtesy form, which begins id-shaped", () => {
    expect(
      parseAgentPostStamp("agent-a1b2c3d4-5e6f-7890-abcd-ef1234567890-12")
    ).toBeNull();
  });

  it("refuses everything that is not the exact shape", () => {
    expect(parseAgentPostStamp("agent-k3v7d2mq")).toBeNull(); // no seq
    expect(parseAgentPostStamp(`agent-${A}-1-extra`)).toBeNull();
    expect(parseAgentPostStamp("agent-K3V7D2MQ-1")).toBeNull(); // charset
    expect(parseAgentPostStamp("agent-3k7v2dmq-1")).toBeNull(); // leading digit
    expect(parseAgentPostStamp("agent-k3v7d2m-1")).toBeNull(); // seven chars
    expect(parseAgentPostStamp(`xagent-${A}-1`)).toBeNull(); // not anchored
  });

  it("reads an absent or non-string key as 'cannot say'", () => {
    expect(parseAgentPostStamp(null)).toBeNull();
    expect(parseAgentPostStamp(undefined)).toBeNull();
    expect(parseAgentPostStamp("")).toBeNull();
  });

  /**
   * ⚠ ONE REGEX, TWO READERS. `agentSentMessages` splits the agent panel's Sent
   * lane on this same token (F-251) — if the two ever parsed differently, a
   * message could be attributed to `A` in the transcript and to `B` in the panel.
   */
  it("agrees with agentSentMessages about which agent wrote a row", () => {
    const mine = byAgent("m-a", { agentId: A });
    const theirs = byAgent("m-b", { agentId: B, seq: 2 });
    const courtesy = message({
      id: "m-c",
      seq: 3,
      authorUserId: ME,
      authorKind: "agent",
      metadata: { taskId: "t-1" },
      clientMsgId: "agent-a1b2c3d4-5e6f-7890-abcd-ef1234567890-1",
    });
    expect(
      agentSentMessages([mine, theirs, courtesy], "t-1", ME, A).map((m) => m.id)
    ).toEqual(["m-a", "m-c"]);
    expect(parseAgentPostStamp(mine.clientMsgId)).toBe(A);
    expect(parseAgentPostStamp(theirs.clientMsgId)).toBe(B);
    expect(parseAgentPostStamp(courtesy.clientMsgId)).toBeNull();
  });
});

describe("the transcript's attribution pill", () => {
  it("names the agent when the post is stamped", () => {
    renderThread([byAgent("m-1", { agentId: A })]);
    expect(within(rowFor("BODY-m-1")).getByText(A)).not.toBeNull();
  });

  /** ⚠ An unstamped agent post renders exactly what it always did. Inventing an
   *  id, or dropping the chip, both report "cannot say" as something else. */
  it("keeps the plain chip on an UNSTAMPED agent post", () => {
    renderThread([byAgent("m-1", { agentId: null })]);
    const row = rowFor("BODY-m-1");
    expect(within(row).getByText("Agent")).not.toBeNull();
    expect(within(row).queryByText(A)).toBeNull();
  });

  it("keeps the plain chip on a machine-level courtesy post", () => {
    const courtesy = message({
      id: "m-c",
      seq: 1,
      body: "COURTESY",
      authorUserId: ME,
      authorKind: "agent",
      metadata: { taskId: "t-1" },
      clientMsgId: "agent-a1b2c3d4-5e6f-7890-abcd-ef1234567890-1",
    });
    renderThread([courtesy]);
    const row = rowFor("COURTESY");
    expect(within(row).getByText("Agent")).not.toBeNull();
    expect(within(row).queryByText("a1b2c3d4")).toBeNull();
  });

  /** ⚠ `client_msg_id` is CALLER-SUPPLIED. A human whose client happened to pick
   *  the stamp shape must not be able to hang an agent id off their own words. */
  it("never attributes a HUMAN post, whatever its client key looks like", () => {
    const human = message({
      id: "m-h",
      seq: 1,
      body: "HUMAN",
      authorUserId: ME,
      metadata: { taskId: "t-1" },
      clientMsgId: `agent-${A}-1`,
    });
    renderThread([human]);
    const row = rowFor("HUMAN");
    expect(within(row).queryByText("Agent")).toBeNull();
    expect(within(row).queryByText(A)).toBeNull();
  });
});

/**
 * THE RUN-GROUPING — the half of this fix that has no pill to work with.
 *
 * A continuation drops the avatar, the name line and the chip, so two of the
 * operator's agents alternating in one thread rendered as a single unbroken run
 * under one name. That IS the report.
 */
describe("a different agent breaks the run", () => {
  it("gives each of two agents its own header in one thread", () => {
    renderThread([
      byAgent("m-1", { agentId: A, seq: 1 }),
      byAgent("m-2", { agentId: B, seq: 2 }),
      byAgent("m-3", { agentId: A, seq: 3 }),
    ]);
    // Three rows, three headers, and each names its own agent.
    expect(within(rowFor("BODY-m-1")).getByText(A)).not.toBeNull();
    expect(within(rowFor("BODY-m-2")).getByText(B)).not.toBeNull();
    expect(within(rowFor("BODY-m-3")).getByText(A)).not.toBeNull();
  });

  /** ⚠ THE SAME agent still groups — this must not turn every agent post into
   *  its own header, which would undo the run rule entirely. */
  it("keeps a run when the SAME agent posts twice", () => {
    renderThread([
      byAgent("m-1", { agentId: A, seq: 1 }),
      byAgent("m-2", { agentId: A, seq: 2 }),
    ]);
    // The second row is a continuation: no name line, so no chip on it.
    expect(within(rowFor("BODY-m-2")).queryByText("Agent")).toBeNull();
    expect(within(rowFor("BODY-m-1")).getByText(A)).not.toBeNull();
  });

  /** ⚠ Two legacy posts still group — `null === null`. A main that predates the
   *  stamp renders exactly as it always did. */
  it("keeps a run between two UNSTAMPED posts", () => {
    renderThread([
      byAgent("m-1", { agentId: null, seq: 1 }),
      byAgent("m-2", { agentId: null, seq: 2 }),
    ]);
    expect(within(rowFor("BODY-m-2")).queryByText("Agent")).toBeNull();
  });

  /** ⚠ …but `null` never MATCHES a real id, so a stamped post after an unstamped
   *  one gets its own header. Both directions fail toward showing a name. */
  it("breaks the run between an unstamped post and a stamped one", () => {
    renderThread([
      byAgent("m-1", { agentId: null, seq: 1 }),
      byAgent("m-2", { agentId: A, seq: 2 }),
    ]);
    expect(within(rowFor("BODY-m-2")).getByText(A)).not.toBeNull();
  });

  /** A HUMAN run is untouched — the stamp is only read on agent rows. */
  it("leaves a human run grouped", () => {
    renderThread([
      message({ id: "h-1", seq: 1, body: "H1", authorUserId: ME, metadata: { taskId: "t-1" } }),
      message({ id: "h-2", seq: 2, body: "H2", authorUserId: ME, metadata: { taskId: "t-1" } }),
    ]);
    expect(within(rowFor("H2")).queryByText("You")).toBeNull();
    expect(within(rowFor("H1")).getByText("You")).not.toBeNull();
  });
});

describe("the accent that makes two agents glanceable", () => {
  /** ⚠ A pure function of the id and nothing else — no counter, no
   *  order-of-appearance index, no palette cursor. */
  it("is deterministic and stable", () => {
    expect(agentAccent(A)).toBe(agentAccent(A));
    expect(agentAccent(B)).toBe(agentAccent(B));
  });

  /** ⚠ Index 0 IS today's plain face, so a stamped agent that hashes to it is
   *  indistinguishable from an unstamped post's chip. The accent says WHICH
   *  agent, never THAT there is one. */
  it("only ever returns a face built from design tokens", () => {
    for (const id of [A, B, "zzzzzzzz", "aaaaaaaa", "m9q2x7bt"]) {
      const face = agentAccent(id);
      expect(face).not.toMatch(/#[0-9a-f]{3,6}/i);
      // ⚠ NEVER THE SEVERITY RAMP. Painting one of an operator's agents
      // alarm-red is a status claim about a thing that has no status.
      expect(face).not.toMatch(/\b(bg|text|border)-(danger|success|caution|warning)\b/);
    }
  });

  it("gives these two agents different faces, which is the case that was reported", () => {
    expect(agentAccent(A)).not.toBe(agentAccent(B));
  });
});
