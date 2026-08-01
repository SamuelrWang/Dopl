/**
 * ENGAGEMENT, THE STAMP SIDE — an agent is IDLE (sees everything in the room,
 * acts on nothing) or ENGAGED (also acts on UNTAGGED messages from humans in
 * that channel). TAGGING ENGAGES, and this file drives that through its real
 * entry point, `postMessage`. How an engagement ENDS is
 * `service-agents-disengage.test.ts`; both share one room
 * (`service-agents-engagement.fixtures.ts`).
 *
 * What this file pins:
 *  - **The loop brake, and it is absolute: an AGENT-DRIVEN message engages
 *    NOBODY.** The decisive tell is the CREDENTIAL (`ctx.source`), which is
 *    derived from the token and cannot be asserted. `authorKind` is a
 *    caller-assertable display/routing claim, so an agent-token caller sending
 *    `authorKind:"user"` engages nothing — the case this file used to pin the
 *    other way round, which made the brake defeatable by one word. The two
 *    CLAIM checks stay as defence in depth and catch what the credential
 *    cannot: an operator's COOKIE session (a human credential) posting with
 *    `author_agent_id`, or with `authorKind:"agent"` — the shape installed
 *    desktop 1.7.17 posts its agent replies in.
 *  - **Engagement follows a post that LANDED, and a REPLAY REPAIRS IT.** It is
 *    recorded after the insert, so a failed post leaves none behind; it reads
 *    the STORED row, so a hand-written `metadata` cannot reach it; and every
 *    idempotent return path re-drives it, so an engagement write lost after the
 *    insert landed is repaired by the retry instead of being swallowed by the
 *    `client_msg_id` short-circuit forever.
 *  - **The engager is the MESSAGE's author**, never whoever replayed its key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import {
  agentCtx,
  agentRow,
  AGENTS,
  ctx,
  insertedRow,
  ONYX,
  PEER,
  QUARTZ,
  resetEngagementFakes,
  USER,
  WS,
} from "./service-agents-engagement.fixtures";

beforeEach(() => {
  resetEngagementFakes();
});

describe("postMessage — a HUMAN address engages", () => {
  it("engages the addressed agent, for the caller", async () => {
    await postMessage(ctx, "room", { body: "@quartz go", toAgent: "quartz" });

    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith([QUARTZ], USER);
  });

  it("engages EVERY agent of a multi-address in one call", async () => {
    await postMessage(ctx, "room", {
      body: "@quartz @onyx work together",
      toAgents: ["quartz", "onyx"],
    });

    // One statement for one decision — half a room listening is not a state
    // anybody asked for.
    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledTimes(1);
    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith(
      [QUARTZ, ONYX],
      USER
    );
  });

  it("does not engage anyone when nothing is addressed", async () => {
    await postMessage(ctx, "room", { body: "morning all" });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("does not engage on a HUMAN-only address (that is not an agent)", async () => {
    await postMessage(ctx, "room", { body: "over to you", toUserId: PEER });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });
});

describe("postMessage — THE LOOP BRAKE: an agent-authored message engages nobody", () => {
  it("does not engage when the caller posts AS its own agent", async () => {
    vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
      id === ONYX
        ? agentRow({ id: ONYX, name: "onyx", owner_user_id: USER })
        : (Object.values(AGENTS).find((a) => a.id === id) ?? null)
    );

    await postMessage(ctx, "room", {
      body: "@quartz over to you",
      toAgent: "quartz",
      authorAgentId: ONYX,
    });

    // The message is posted and addressed — it simply arms nothing standing.
    expect(repoMessages.insertMessage).toHaveBeenCalled();
    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  /**
   * The half that covers the build in the field. Installed desktop 1.7.17 posts
   * its agent replies with `authorKind:"agent"` over the operator's cookie
   * session and NO `author_agent_id` (agents are newer than it), so a rule that
   * keyed on the claim alone would let precisely those messages engage.
   */
  it("does not engage on an explicit authorKind:agent with no agent id", async () => {
    await postMessage(ctx, "room", {
      body: "@quartz your turn",
      toAgent: "quartz",
      authorKind: "agent",
    });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("does not engage on an AGENT-credential post that asserts no kind", async () => {
    // `authorKind` defaults to `agent` for an agent credential, so the brake
    // holds without the caller having to label anything.
    await postMessage(agentCtx, "room", {
      body: "@quartz your turn",
      toAgent: "quartz",
    });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  /**
   * THE BYPASS, closed. `authorKind` is caller-ASSERTABLE
   * (`PostableAuthorKindSchema` takes `"user"` from anybody), so while
   * engagement keyed on it the brake was defeatable by one word: an agent-token
   * caller posted `{toAgent:"quartz", authorKind:"user"}`, quartz was engaged
   * for 60 minutes, and the agent then drove it with untagged lines carrying
   * the same assertable label — the desktop's only brake being that same
   * column. Two agents could sustain each other with no human at any hop.
   *
   * Engagement now keys on `ctx.source`, which is derived from the CREDENTIAL
   * (`auth.agentTokenId ? "agent" : "user"`) and has no wire field behind it.
   */
  it("SECURITY: an agent credential asserting authorKind:user engages NOBODY", async () => {
    await postMessage(agentCtx, "room", {
      body: "@quartz go",
      toAgent: "quartz",
      authorKind: "user",
    });

    // Posted, addressed, routed — it simply arms nothing standing.
    expect(repoMessages.insertMessage).toHaveBeenCalled();
    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("SECURITY: nor does it on a multi-address", async () => {
    // The claim cannot be laundered through the plural field either.
    await postMessage(agentCtx, "room", {
      body: "@quartz @onyx keep going",
      toAgents: ["quartz", "onyx"],
      authorKind: "user",
    });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("but a GENUINE human credential asserting the same kind still engages", async () => {
    // The sibling that proves the brake is not just "never engage": the fact,
    // not the claim, is what changed. Same payload, cookie-session credential.
    await postMessage(ctx, "room", {
      body: "@quartz go",
      toAgent: "quartz",
      authorKind: "user",
    });

    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith([QUARTZ], USER);
  });
});

describe("postMessage — engagement follows a post that LANDED", () => {
  it("does not engage when the insert throws", async () => {
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(new Error("boom"));

    await expect(
      postMessage(ctx, "room", { body: "go", toAgent: "quartz" })
    ).rejects.toThrow("boom");
    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  /**
   * S1 — THE REPAIR. `markAgentsEngaged` runs after the insert as a separate
   * statement. When it threw, the message HAD posted, the caller got a 500, and
   * the retry hit the `client_msg_id` short-circuit — which returned the stored
   * message and engaged nobody, so one transient failure lost that engagement
   * permanently (and a retry without the key duplicated the message instead).
   * Every idempotent return path now re-drives it, exactly as `create_thread`
   * re-drives its opening post (v3.1).
   */
  const storedAddressedPost = () =>
    insertedRow({
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: USER,
      author_kind: "user",
      kind: "message",
      body: "go",
      metadata: { to_agent_ids: [QUARTZ] },
      client_msg_id: "k1",
    });

  it("REPAIRS a lost engagement on the idempotent replay", async () => {
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      storedAddressedPost()
    );

    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "quartz",
      clientMsgId: "k1",
    });

    // No second message — the post is still the source of truth — and the
    // engagement the first attempt failed to write is now written.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith([QUARTZ], USER);
  });

  it("re-drives it on the lost-insert RACE path too", async () => {
    // The same short-circuit reached the other way (23505 on the unique index);
    // the two must answer identically.
    let seen = 0;
    vi.mocked(repoMessages.findMessageByClientId).mockImplementation(async () =>
      seen++ === 0 ? null : storedAddressedPost()
    );
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(new Error("dup"));
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");

    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "quartz",
      clientMsgId: "k1",
    });

    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith([QUARTZ], USER);
  });

  it("records the STORED message's author as the engager, not the replayer", async () => {
    // A `client_msg_id` is unique per CHANNEL, not per member, so a replay can
    // return someone else's message. The engagement belongs to whoever actually
    // addressed the agents — a replayer cannot redirect it to themselves.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: PEER,
        author_kind: "user",
        kind: "message",
        body: "go",
        metadata: { to_agent_ids: [QUARTZ] },
        client_msg_id: "k1",
      })
    );

    await postMessage(ctx, "room", { body: "go", clientMsgId: "k1" });

    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith([QUARTZ], PEER);
  });

  it("the loop brake still holds on a replay (stored agent-authored post)", async () => {
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "agent",
        kind: "message",
        body: "go",
        metadata: { to_agent_ids: [QUARTZ] },
        client_msg_id: "k1",
      })
    );

    await postMessage(ctx, "room", { body: "go", clientMsgId: "k1" });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("a replay engages nothing when the stored post addressed no agent", async () => {
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "user",
        kind: "message",
        body: "morning all",
        metadata: {},
        client_msg_id: "k1",
      })
    );

    await postMessage(ctx, "room", { body: "morning all", clientMsgId: "k1" });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("SECURITY: a hand-written metadata.to_agent_ids engages nobody", async () => {
    // It is read from the STAMPED metadata, and that key is reserved — the
    // strip runs before anything is re-added, so there is nothing to engage.
    await postMessage(ctx, "room", {
      body: "hi",
      metadata: { to_agent_ids: [QUARTZ, ONYX] },
    });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });
});
