/**
 * THE ESCALATION KEYS — the reserved pair that renders a card with BUTTONS and
 * routes the pressed one back to an agent.
 *
 * ⚠ ITS OWN FILE for the reason the keys are reserved at all. `escalation`
 * renders a working control in somebody's transcript; `escalationAnswer` is a
 * WAKE PRIMITIVE — it names an agent instance and a machine acts on it. Both are
 * security properties a reader should find by name rather than eighteen
 * describes down the metadata fold's file.
 *
 * ⚠ EVERY CASE DRIVES THE REAL `postMessage` → `resolvePostMetadata` and reads
 * the metadata object that crossed into `insertMessage` (INVARIANTS §14: a regex
 * over source text is not a behavioural assertion). The harness mirrors
 * `service-writes-metadata-mentions.test.ts`'s deliberately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
} from "../escalation";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ProfileRef,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const ESC_ID = "44444444-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};
const peerCtx: ChannelContext = { ...ctx, userId: PEER };
const thirdCtx: ChannelContext = { ...ctx, userId: THIRD };
const agentCtx: ChannelContext = { ...ctx, source: "agent" };

const ESCALATION = {
  issue: "Ship now or wait?",
  context: "It is reversible.",
  options: [
    { label: "Ship now", consequence: "Live in ten minutes." },
    { label: "Wait", consequence: "Blocked until tomorrow." },
  ],
  recommendation: { index: 0, why: "Reversible." },
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Website",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-08-31T00:00:00Z",
  };
}

function profile(id: string, name: string, email: string): ProfileRef {
  return { id, display_name: name, email, avatar_url: null };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 12,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-08-31T00:00:00Z",
  };
}

/**
 * THE STORED ESCALATION an answer names.
 *
 * `clientMsgId` carries the per-instance stamp `main/session-outbound-tag.js ›
 * nextOwnPostId` mints, which is where the derived `agentId` comes from.
 */
function storedEscalation(
  over: Partial<ChannelMessageRow> = {},
  meta: Record<string, unknown> = {}
): ChannelMessageRow {
  return {
    id: ESC_ID,
    seq: 9,
    channel_id: "chan-1",
    workspace_id: WS,
    author_user_id: USER,
    author_kind: "agent",
    kind: "message",
    body: "**Escalation:** Ship now or wait?",
    metadata: { [ESCALATION_METADATA_KEY]: ESCALATION, ...meta },
    client_msg_id: "agent-k3wpf7c5-4",
    created_at: "2026-08-31T00:00:00Z",
    ...over,
  };
}

function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    [USER, PEER, THIRD].includes(userId) ? memberRow(userId) : null
  );
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
    memberRow(THIRD),
  ]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([
    profile(USER, "Sam Wang", "sam@example.com"),
    profile(PEER, "Diana Taylor", "diana@example.com"),
    profile(THIRD, "Daniel Anderson", "dan@example.com"),
  ]);
  vi.mocked(repoMessages.findMessageById).mockResolvedValue(
    storedEscalation()
  );
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
    rows: [],
    truncated: false,
  });
});

describe("the escalation payload is RESERVED", () => {
  it("stamps it from the validated field", async () => {
    await postMessage(agentCtx, "room", {
      body: "**Escalation:** Ship now or wait?",
      escalation: ESCALATION,
    });
    expect(capturedMetadata()[ESCALATION_METADATA_KEY]).toEqual(ESCALATION);
  });

  it("STRIPS a caller's own metadata copy, and stamps nothing in its place", async () => {
    // ⚠ THE WHOLE SECURITY CONTENT. The card renders buttons that write back and
    // wake an agent, so a settable key would let any member hang a working
    // control off any words at all.
    await postMessage(ctx, "room", {
      body: "not an escalation",
      metadata: { [ESCALATION_METADATA_KEY]: ESCALATION },
    });
    expect(has(capturedMetadata(), ESCALATION_METADATA_KEY)).toBe(false);
  });

  it("STRIPS a caller's own ANSWER copy — a forged one is a forged WAKE", async () => {
    await postMessage(ctx, "room", {
      body: "plain message",
      metadata: {
        [ESCALATION_ANSWER_METADATA_KEY]: {
          escalationMessageId: ESC_ID,
          optionIndex: 0,
          agentId: "k3wpf7c5",
        },
      },
    });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("stamps NOTHING on an ordinary post, so no existing row shape moved", async () => {
    await postMessage(ctx, "room", { body: "hello" });
    expect(has(capturedMetadata(), ESCALATION_METADATA_KEY)).toBe(false);
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });
});

describe("who may ANSWER — the tagged member, else the author", () => {
  it("the TAGGED member may answer", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { [MENTIONS_METADATA_KEY]: [PEER] })
    );
    await postMessage(peerCtx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("a member the escalation did NOT tag is refused, LOUDLY", async () => {
    // ⚠ 403, not a silent strip. A foreign thread tag is stripped because
    // installed desktops post legacy ids; this key has no installed writers, and
    // a silent strip would let the button report success over an answer nobody
    // received.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { [MENTIONS_METADATA_KEY]: [PEER] })
    );
    await expect(
      postMessage(thirdCtx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/not addressed to you/i);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("with NOBODY tagged, the AUTHOR's operator may answer", async () => {
    // §5's 2026-08-22 ruling made useful: an untagged escalation is addressed to
    // the person whose machine it runs on.
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 1 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("with NOBODY tagged, a peer is still refused", async () => {
    await expect(
      postMessage(peerCtx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/not addressed to you/i);
  });
});

describe("what an answer may NAME", () => {
  it("refuses a message id that is not in this channel", async () => {
    // ⚠ `findMessageById` is scoped by channel — the `eq('channel_id')` is the
    // fence, not a narrowing. `null` here IS the cross-channel case.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(null);
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });

  it("refuses a message that carries no escalation payload", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ metadata: {} })
    );
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });

  it("refuses an option index outside THAT escalation's own list", async () => {
    // The schema's own bound is the 0..5 range; this is the per-row one.
    await expect(
      postMessage(ctx, "room", {
        body: "Ship now",
        escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 4 },
      })
    ).rejects.toThrow(/No answerable escalation here/i);
  });
});

describe("the wake key is DERIVED, never accepted", () => {
  it("takes the agent id off the ESCALATION's own stamp", async () => {
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: string })
        .agentId
    ).toBe("k3wpf7c5");
  });

  it("answers `null` for an escalation nothing stamped — an EXTERNAL agent's", async () => {
    // ⚠ `null` IS "CANNOT SAY", never "no agent". An MCP session's post carries
    // no per-instance stamp; the answer is still an ordinary visible message, so
    // `feedLiveSession` still delivers it to every live agent on the thread.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ client_msg_id: null })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: null })
        .agentId
    ).toBeNull();
  });

  it("does NOT attribute a MACHINE-level courtesy stamp to an agent", async () => {
    // `main/channel-post.js › postCourtesy` stamps `agent-<channelUUID>-<seq>`,
    // and a channel UUID can BEGIN with eight id-shaped characters — the anchored
    // pattern is the discriminator, and a `startsWith` would invent an agent.
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({
        client_msg_id: "agent-3f8ab19c-4d2e-4c1a-9b77-1e2f3a4b5c6d-7",
      })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: null })
        .agentId
    ).toBeNull();
  });
});
