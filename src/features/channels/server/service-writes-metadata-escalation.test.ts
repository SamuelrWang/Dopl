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
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
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
 * nextOwnPostId` mints — ONE of the two doors the derived `agentId` comes from.
 * ⚠ The other is `metadata.session_id`, and a row may carry either or both; see
 * the BOTH-doors describe below for why reading only this one made every agent
 * that chose its own idempotency key anonymous.
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
  // ⚠ THE AUTHOR'S OWN PROJECTION, EMPTY (2026-09-02, F-589). RR2 reads it to
  // check the `client_msg_id` agent stamp — a CALLER-SUPPLIED claim — against
  // the agents this author actually runs, so a file that leaves it unstubbed
  // reaches the real admin client and times out rather than failing.
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  // ⚠ THE ROOM'S PROJECTION, EMPTY (2026-09-02, B4). RR3 reads it for every
  // UNADDRESSED HUMAN message, so a file that leaves it unstubbed reaches the
  // real admin client and times out rather than failing. Empty = no live agent,
  // which is this file's subject: it measures the METADATA fold, not the wake.
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
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
  // ⚠ THE TYPED DOOR'S TWO READS, EMPTY BY DEFAULT (2026-09-05, task 13b). Fold
  // 11b runs on every HUMAN post that is not itself a card, so an unstubbed file
  // measures a typed door that found nothing — which is the right default here:
  // every case above is about the BUTTON, and no card should be open under it.
  vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([]);
  vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
    new Set<string>()
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

describe("the derived agentId — BOTH doors, so a careful caller is not anonymous", () => {
  /**
   * ⚠ THE BUG THIS IS FOR (2026-09-05, task 13a). `agentId` came off
   * `parseAgentPostStamp(row.client_msg_id)` alone, and the stamp is absent from
   * every post that carried its OWN idempotency key — `main/session-outbound-tag.js
   * › threadTagFor` never overwrites one an agent chose. So an agent that filed its
   * decision card with `client_msg_id: "ask-2"` stamped `agentId: null`, and the
   * press that answered it named nobody to wake: this feature's own failure mode, a
   * button reporting success over an answer that reached no one, firing on exactly
   * the callers careful enough to set a key before retrying.
   */
  it("a card whose client_msg_id is the CALLER's own key still resolves an agent", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation(
        { client_msg_id: "ask-2" },
        // ⚠ THE SERVER'S OWN STAMP, and the STRONGER fact: `session_id` is stripped
        // from caller input unconditionally and re-stamped from the
        // `X-Dopl-Session-Id` header (`service-writes-metadata.ts` fold 6b), so
        // reading it names FEWER forgeable things than the stamp did.
        { session_id: "chan::k3wpf7c5" }
      )
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("the STAMP still wins where a row carries one — the older form is unmoved", async () => {
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({}, { session_id: "chan::zzzzzzzz" })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { agentId: string })
        .agentId
    ).toBe("k3wpf7c5");
  });

  it("an EXTERNAL MCP escalation still answers null — cannot say, never a guess", async () => {
    // Nothing stamped it and it carries no desktop session key. The answer is still
    // an ordinary visible message, so `feedLiveSession` delivers it to every live
    // agent on the thread; `null` here removes no delivery (INVARIANTS §11).
    vi.mocked(repoMessages.findMessageById).mockResolvedValue(
      storedEscalation({ client_msg_id: "mcp-1" })
    );
    await postMessage(ctx, "room", {
      body: "Ship now",
      escalationAnswer: { escalationMessageId: ESC_ID, optionIndex: 0 },
    });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: null,
    });
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

/**
 * THE TYPED DOOR (task 13b, rulings #1081–#1085).
 *
 * The gap: Samuel answered a card by TYPING "Approve the package". The post
 * carried no `escalationAnswer`, tied to no card and woke nobody — and #1084's
 * finding is that this was never a regression, the path was never built.
 *
 * ⚠ EVERY NEGATIVE CASE ASSERTS **SILENCE**, not an error. A near miss is an
 * ordinary message, which is what it already was; the feature may only ever ADD
 * a stamp. A rejects.toThrow anywhere in this describe would be the bug.
 */
describe("a TYPED answer presses the same button", () => {
  function openCard(
    over: Partial<ChannelMessageRow> = {},
    meta: Record<string, unknown> = {}
  ): void {
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(over, meta),
    ]);
  }

  it("stamps the answer when the body IS an option's label", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("matches case-insensitively and trims, so real typing counts", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "  wAiT  " });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("accepts the BARE NUMBER the card's own body prints", async () => {
    // `escalationBody` renders "2. **Wait** — …", so "2" is 1-BASED in and
    // 0-based out. It is read off what the operator SEES.
    openCard();
    await postMessage(ctx, "room", { body: "2" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
        .optionIndex
    ).toBe(1);
  });

  it("stamps the SAME shape a press does — one path downstream", async () => {
    // ⚠ #1085 ›3: the wake verdict must never learn there were two entrances.
    // Same derived `agentId`, off the STRONGER door, for a card that carried its
    // own idempotency key — the 13a repair reached through the typed path too.
    openCard({ client_msg_id: "ask-2" }, { session_id: "chan::k3wpf7c5" });
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY]).toEqual({
      escalationMessageId: ESC_ID,
      optionIndex: 0,
      agentId: "k3wpf7c5",
    });
  });

  it("leaves PARTIAL text as ordinary prose, silently", async () => {
    // ⚠ THE WHOLE FAIL-CLOSED RULING. A wrong match presses a button the person
    // did not press, through a UI that has no unpress.
    openCard();
    await postMessage(ctx, "room", { body: "I think we should ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("leaves an out-of-range number as ordinary prose", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "5" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("treats '0' as prose — the render has no option zero", async () => {
    openCard();
    await postMessage(ctx, "room", { body: "0" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("refuses to guess when TWO options share a label", async () => {
    openCard({
      metadata: {
        [ESCALATION_METADATA_KEY]: {
          ...ESCALATION,
          options: [
            { label: "Ship now", consequence: "Live in ten minutes." },
            { label: "Ship now", consequence: "Live tomorrow." },
          ],
          recommendation: null,
        },
      },
    });
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  /**
   * LABEL FIRST, NUMBER AS THE FALLBACK (ruled 2026-09-06).
   *
   * The digit arm used to run first, so an option whose FACE is a number could
   * never be answered by typing that face — the digits were spent reading a
   * position before anything looked at the labels, and `matchTypedOption`'s own
   * docblock ("the whole body equal to one option's whole label") was false for
   * exactly that shape.
   */
  describe("precedence: a label beats the position it happens to look like", () => {
    /** A card whose SECOND option is faced with a number. */
    function numericFacedCard(): void {
      openCard({
        metadata: {
          [ESCALATION_METADATA_KEY]: {
            ...ESCALATION,
            options: [
              { label: "Ship now", consequence: "Live in ten minutes." },
              { label: "2026", consequence: "Slip to next year." },
            ],
            recommendation: null,
          },
        },
      });
    }

    it("answers a NUMERICALLY-FACED option by typing its face", async () => {
      // ⚠ THE GAP THIS CLOSES. Under digits-first, "2026" was read as position
      // 2026, fell off the end of a two-option card, and stamped nothing — the
      // one label on the card that could not be typed was the one printed on
      // the button.
      numericFacedCard();
      await postMessage(ctx, "room", { body: "2026" });
      expect(
        (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
          .optionIndex
      ).toBe(1);
    });

    it("still resolves a bare number BY POSITION when no label matches it", async () => {
      // ⚠ THE FALLBACK IS INTACT, and this is the common card: "2" is what the
      // render prints beside the second option, and typing it must keep working.
      openCard();
      await postMessage(ctx, "room", { body: "2" });
      expect(
        (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as { optionIndex: number })
          .optionIndex
      ).toBe(1);
    });

    it("refuses two options sharing a NUMERIC face, without falling through to the position", async () => {
      // ⚠ AMBIGUITY STOPS, it does not get a second chance. Reading "2" as a
      // position after two options called "2" already refused would be the guess
      // this function exists not to make, taken one step later.
      openCard({
        metadata: {
          [ESCALATION_METADATA_KEY]: {
            ...ESCALATION,
            options: [
              { label: "2", consequence: "One of them." },
              { label: "2", consequence: "The other." },
            ],
            recommendation: null,
          },
        },
      });
      await postMessage(ctx, "room", { body: "2" });
      expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
    });
  });

  it("does not answer an ALREADY-ANSWERED card", async () => {
    openCard();
    vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
      new Set([ESC_ID])
    );
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("does not answer a card the typist could not have PRESSED", async () => {
    // ⚠ AUTHORIZATION IS THE CANDIDATE FILTER. The typed door must never answer a
    // card the button path would refuse with a 403 — here, a peer's card that
    // tagged somebody else.
    openCard({ author_user_id: PEER }, { [MENTIONS_METADATA_KEY]: [PEER] });
    await postMessage(thirdCtx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("answers the MOST RECENT open card, never an older one", async () => {
    const older = storedEscalation({ id: "older-card", seq: 3 });
    // `listRecentEscalations` is `seq` DESC; the newest survivor wins.
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(),
      older,
    ]);
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as {
        escalationMessageId: string;
      }).escalationMessageId
    ).toBe(ESC_ID);
  });

  it("skips the ANSWERED newest and takes the most recent OPEN one", async () => {
    vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([
      storedEscalation(),
      storedEscalation({ id: "older-card", seq: 3 }),
    ]);
    vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
      new Set([ESC_ID])
    );
    await postMessage(ctx, "room", { body: "Ship now" });
    expect(
      (capturedMetadata()[ESCALATION_ANSWER_METADATA_KEY] as {
        escalationMessageId: string;
      }).escalationMessageId
    ).toBe("older-card");
  });

  it("an AGENT's post never presses its operator's card", async () => {
    // ⚠ THE FENCE. An agent posts as its operator's user id, so without this an
    // agent writing "Ship now" would press a button nobody touched.
    openCard();
    await postMessage(agentCtx, "room", { body: "Ship now" });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("a post that IS a card does not answer the card before it", async () => {
    openCard();
    await postMessage(agentCtx, "room", {
      body: "Ship now",
      escalation: ESCALATION,
    });
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("does not fail the POST when the lookup itself fails", async () => {
    // ⚠ THIS FOLD MAY ONLY EVER ADD A STAMP. A member's ordinary sentence must
    // not fail to send because an optional convenience could not run.
    vi.mocked(repoMessages.listRecentEscalations).mockRejectedValue(
      new Error("db is having a day")
    );
    await expect(
      postMessage(ctx, "room", { body: "Ship now" })
    ).resolves.toBeDefined();
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
  });

  it("drops the guessed stamp and still posts when a press wins the race", async () => {
    // ⚠ **THE PROMISE IS ABOUT THE WRITE, NOT ONLY THE FOLD** (2026-09-06).
    // "Most recent OPEN card" is a read; one-answer-per-escalation is a partial
    // unique index enforced at COMMIT. A press landing in between made this
    // member's ordinary sentence 23505 and fail to send — the exact outcome 11b
    // chose silence to avoid. The honest answer is the message WITHOUT the key.
    openCard();
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(repoMessages.insertMessage).mockRejectedValueOnce(
      new Error("duplicate key value violates unique constraint")
    );

    await expect(
      postMessage(ctx, "room", { body: "Ship now" })
    ).resolves.toBeDefined();

    // The first attempt DID carry the guess — this is a retry, not a fold that
    // quietly stopped matching.
    expect(has(capturedMetadata(), ESCALATION_ANSWER_METADATA_KEY)).toBe(true);
    const retried = vi.mocked(repoMessages.insertMessage).mock.calls[1][0];
    expect(has(retried.metadata, ESCALATION_ANSWER_METADATA_KEY)).toBe(false);
    // ⚠ AND THE MEMBER'S WORDS ARE UNTOUCHED. Dropping the stamp must never
    // edit what they wrote.
    expect(retried.body).toBe("Ship now");
  });

  it("reads nothing at all for a body no label could be", async () => {
    // The free prune: an option label is a single-line `safeLabel` ≤ 80 chars, so
    // ordinary prose is refused without touching the database — every message on
    // the post path pays this fold's cost.
    await postMessage(ctx, "room", { body: "x".repeat(200) });
    expect(repoMessages.listRecentEscalations).not.toHaveBeenCalled();
  });
});
