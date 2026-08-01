/**
 * Unit tests for the TWO-AGENT HANDSHAKE derivation — the function that turns a
 * `thread-open-<channelId>-<seq>` idempotency key into the participant set a
 * thread must have for BOTH woken agents to be able to write into it.
 *
 * The repositories are mocked; `service-participants`' `identityBelongs` runs
 * for real (it is the one definition of "belongs to this channel", and these
 * tests are largely about what drops out of the derived set because it does
 * not).
 *
 * The load-bearing rules, and every one of them is a test below:
 *  - a key that is not EXACTLY the protocol's shape derives nothing;
 *  - the set comes from `metadata.to_agent_ids`, which is server-stamped and so
 *    cannot be forged by a caller writing metadata by hand;
 *  - every miss (no opener, no addressing, a deleted agent, an owner who has
 *    left) drops out SILENTLY — a create must never fail because a
 *    caller-supplied, unverifiable key pointed somewhere stale.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");
vi.mock("./repository-messages");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import {
  deriveHandshakeParticipants,
  parseHandshakeSeq,
} from "./service-thread-handshake";
import type { ChannelAgentRow } from "./agents-dto";
import type { ChannelMemberRow, ChannelMessageRow } from "./dto";

const CHAN = "11111111-e29b-41d4-a716-446655440000";
const WS = "ws-1";
const HUMAN = "aaaaaaaa-e29b-41d4-a716-446655440000";
const OWNER_A = "bbbbbbbb-e29b-41d4-a716-446655440000";
const OWNER_B = "cccccccc-e29b-41d4-a716-446655440000";
const QUARTZ = "dddddddd-e29b-41d4-a716-446655440000";
const ONYX = "eeeeeeee-e29b-41d4-a716-446655440000";

const KEY = `thread-open-${CHAN}-7`;

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: CHAN,
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: HUMAN,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: QUARTZ,
    channel_id: CHAN,
    workspace_id: WS,
    owner_user_id: OWNER_A,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** The human's instruction: "@quartz @onyx work together on X". */
function instruction(
  metadata: Record<string, unknown> = { to_agent_ids: [QUARTZ, ONYX] }
): ChannelMessageRow {
  return {
    id: "msg-7",
    seq: 7,
    channel_id: CHAN,
    workspace_id: WS,
    author_user_id: HUMAN,
    author_kind: "user",
    kind: "message",
    body: "@quartz @onyx work together on X",
    metadata,
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Everyone in this room is a member; the tests that care revoke it.
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    memberRow(uid)
  );
  vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
    id === QUARTZ
      ? agentRow()
      : id === ONYX
        ? agentRow({ id: ONYX, name: "onyx", owner_user_id: OWNER_B })
        : null
  );
  vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(instruction());
});

describe("parseHandshakeSeq — the protocol's key shape, and nothing else", () => {
  it("reads the triggering seq out of the handshake key", () => {
    expect(parseHandshakeSeq(KEY, CHAN)).toBe(7);
  });

  it("is anchored on THIS channel — a key minted for another one is not ours", () => {
    const other = "99999999-e29b-41d4-a716-446655440000";
    expect(parseHandshakeSeq(`thread-open-${other}-7`, CHAN)).toBeNull();
  });

  it("refuses every other key shape (the ordinary idempotency key included)", () => {
    expect(parseHandshakeSeq("dedupe-1", CHAN)).toBeNull();
    expect(parseHandshakeSeq(`task-open-${CHAN}-7`, CHAN)).toBeNull();
    expect(parseHandshakeSeq(`thread-open-${CHAN}-`, CHAN)).toBeNull();
    expect(parseHandshakeSeq(`thread-open-${CHAN}-7x`, CHAN)).toBeNull();
    expect(parseHandshakeSeq(`thread-open-${CHAN}--7`, CHAN)).toBeNull();
    expect(parseHandshakeSeq(undefined, CHAN)).toBeNull();
    expect(parseHandshakeSeq(null, CHAN)).toBeNull();
  });

  it("refuses a seq that is not a real one (0, or past integer precision)", () => {
    // `seq` is a 1-based identity column, so 0 names nothing.
    expect(parseHandshakeSeq(`thread-open-${CHAN}-0`, CHAN)).toBeNull();
    expect(
      parseHandshakeSeq(`thread-open-${CHAN}-99999999999999999999`, CHAN)
    ).toBeNull();
  });
});

describe("deriveHandshakeParticipants — the set a handshake create seeds", () => {
  it("derives both agents, both owners, and the human who asked", async () => {
    const refs = await deriveHandshakeParticipants(CHAN, KEY);

    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: "agent", id: QUARTZ },
        { kind: "agent", id: ONYX },
        { kind: "user", id: OWNER_A },
        { kind: "user", id: OWNER_B },
        { kind: "user", id: HUMAN },
      ])
    );
    expect(refs).toHaveLength(5);
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledWith(CHAN, 7);
  });

  it("brings each agent's OWNER in as a user, because that is who the write gate sees", async () => {
    // An agent posts with `author_user_id` = its owner. Seeding the agent row
    // alone would admit it in name and refuse it on any post that did not also
    // claim `authorAgentId`.
    const refs = await deriveHandshakeParticipants(CHAN, KEY);
    expect(refs).toContainEqual({ kind: "user", id: OWNER_B });
  });

  it("derives NOTHING for a create with no client_msg_id (the ordinary path)", async () => {
    expect(await deriveHandshakeParticipants(CHAN, undefined)).toEqual([]);
    // Not merely an empty answer — no read happens at all, so an ordinary
    // create costs exactly what it cost before.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("derives NOTHING for an ordinary idempotency key", async () => {
    expect(await deriveHandshakeParticipants(CHAN, "dedupe-1")).toEqual([]);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("derives nothing when the named seq has no message (never throws)", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);
    await expect(deriveHandshakeParticipants(CHAN, KEY)).resolves.toEqual([]);
  });

  it("derives nothing when the triggering message addressed no agents", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      instruction({ to_user_id: OWNER_A })
    );
    expect(await deriveHandshakeParticipants(CHAN, KEY)).toEqual([]);
  });

  it("drops an addressed agent that no longer exists, keeping the rest", async () => {
    vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
      id === QUARTZ ? agentRow() : null
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);

    expect(refs).toContainEqual({ kind: "agent", id: QUARTZ });
    expect(refs).not.toContainEqual({ kind: "agent", id: ONYX });
  });

  it("drops an agent of ANOTHER channel — it has no listener in this room", async () => {
    vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
      id === ONYX
        ? agentRow({ id: ONYX, channel_id: "some-other-channel" })
        : agentRow()
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);
    expect(refs).not.toContainEqual({ kind: "agent", id: ONYX });
  });

  it("drops an agent WITH its owner when that owner has left the channel", async () => {
    // `channel_agents` has no FK to `channel_members`, so an agent outlives its
    // owner's membership. Admitting a writer who can no longer READ the channel
    // is the one thing a participant set must never do.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === OWNER_B ? null : memberRow(uid)
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);

    expect(refs).not.toContainEqual({ kind: "agent", id: ONYX });
    expect(refs).not.toContainEqual({ kind: "user", id: OWNER_B });
    expect(refs).toContainEqual({ kind: "agent", id: QUARTZ });
  });

  it("omits the instruction's author when they are no longer a member", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === HUMAN ? null : memberRow(uid)
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);
    expect(refs).not.toContainEqual({ kind: "user", id: HUMAN });
    expect(refs).toContainEqual({ kind: "agent", id: QUARTZ });
  });

  it("collapses a repeated address into one identity", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      instruction({ to_agent_ids: [QUARTZ, QUARTZ, QUARTZ] })
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);
    expect(refs).toEqual([
      { kind: "agent", id: QUARTZ },
      { kind: "user", id: OWNER_A },
      { kind: "user", id: HUMAN },
    ]);
  });

  it("ignores junk in the stored array rather than trusting it", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      instruction({ to_agent_ids: ["not-a-uuid", 42, null, QUARTZ] })
    );

    const refs = await deriveHandshakeParticipants(CHAN, KEY);
    expect(refs).toContainEqual({ kind: "agent", id: QUARTZ });
    expect(refs).toHaveLength(3); // quartz, its owner, the human
  });

  it("ignores a to_agent_ids that is not an array at all", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      instruction({ to_agent_ids: QUARTZ })
    );
    expect(await deriveHandshakeParticipants(CHAN, KEY)).toEqual([]);
  });

  it("caps how many addressed agents one derivation will resolve", async () => {
    const many = Array.from(
      { length: 30 },
      (_v, i) => `${i.toString(16).padStart(8, "0")}-e29b-41d4-a716-446655440000`
    );
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      instruction({ to_agent_ids: many })
    );
    vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
      agentRow({ id, owner_user_id: OWNER_A })
    );

    await deriveHandshakeParticipants(CHAN, KEY);

    // Bounded work, not "whatever the jsonb column happens to hold".
    expect(vi.mocked(repoAgents.findAgentById).mock.calls).toHaveLength(8);
  });
});
