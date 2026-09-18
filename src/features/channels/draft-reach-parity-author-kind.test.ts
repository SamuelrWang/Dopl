/**
 * 🔒 **AN AGENT-AUTHORED TAG IS NOT ITS OPERATOR'S ADDRESSING — PINNED ON BOTH ENDS AT ONCE**
 * (F-704, 2026-09-15; Samuel's FOURTH round on this bug: *"the last addressed agent must track
 * the USER'S own most recent addressing ONLY"*).
 *
 * ⚠ **WHY THIS IS A SEPARATE FILE FROM `draft-reach-parity.test.ts`, WHICH IS ITS FAMILY.**
 * That suite sat exactly at the 500-line cap (ENGINEERING.md §2), so this case is a SPLIT rather
 * than an insertion — same mocks, same fixture shapes, one concern. It is also outside that
 * file's TABLE on purpose: the table hands the client an already-resolved `recentAgentIds` list,
 * which is one step PAST where this defect lives. The bug is in DERIVING that list from a
 * transcript, so the client half below runs `recentAgentsAddressedBy` over real rows exactly as
 * `components/derivations.ts › recentAgentIds` does, and the server half is handed the SAME rows
 * through its own read. One rule, two inputs, one answer — and if either end stops reading
 * `author_kind`, this goes red on that end alone.
 *
 * ⚠ **THE DEFECT: AN AGENT POSTS UNDER ITS OPERATOR'S `author_user_id`.**
 * `server/service-writes.ts` writes `author_user_id: ctx.userId` and `author_kind: authorKind`
 * in ONE insert for people and agents alike, so on the only field arm 3's walk filtered,
 * *Samuel addressing an agent* and *Samuel's agent addressing an agent* were the same row. An
 * orchestrator handing work to a worker therefore re-pointed its own operator's default
 * responder. `author_kind` is the sole discriminator and neither end read it for eleven days.
 *
 * ⚠ **AND IT IS INDEPENDENT OF THE `wake_reason` GUARD ALREADY IN THAT FILE.** The agent TYPES
 * its own tag, so the server stamps nothing and `isAuthorTypedAgentTag` answers `true` — the
 * sibling case *"ignores a row the SERVER aimed"* cannot catch this one, and a fixture that gave
 * the agent row a `wake_reason` would pass against the broken code and prove nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server/repository-sessions");
vi.mock("./server/repository-messages");
/** ⚠ PARTIAL, for `draft-reach-parity.test.ts`'s reason: RR3 reads the author's own
 *  `unaddressed_responder` through a module this file also needs whole, and the real
 *  `unaddressedResponderFor` SWALLOWS a read error into the default — so an unmocked repository
 *  would leave this suite green by way of the fail-safe rather than the setting. */
vi.mock("./server/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server/repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import * as repoSessions from "./server/repository-sessions";
import * as repoMessages from "./server/repository-messages";
import * as repo from "./server/repository";
import { draftReach } from "./lib/draft-recipients";
import { recentAgentsAddressedBy } from "./lib/agent-post-stamp";
import { resolveWakeVerdict } from "./server/service-wake-verdict";
import type { ChannelContext } from "./server/service-shared";
import type { ChannelRow } from "./server/dto";
import type { SessionStateRow } from "./server/collab-dto";
import type { ChannelMember } from "./types";
import type { ChannelMessageCreateInput } from "./schema";

const WS = "ws-1";
const ME = "user-1";
const PEER = "user-2";
const CHAN = "chan-1";
const NOW = Date.parse("2026-09-15T12:00:00Z");

const CTX = { workspaceId: WS, userId: ME, source: "user" } as ChannelContext;

function member(userId: string, name: string): ChannelMember {
  return { userId, displayName: name, email: `${name}@x.test` } as ChannelMember;
}

const MEMBERS = [member(ME, "me"), member(PEER, "ada")];

/** `PRIME` is the agent the human addressed; `WORKER` is the one PRIME handed work to. */
const PRIME = "k3v7d2mq";
const WORKER = "m8q1zzzz";

function sessionRow(name: string, startedAt: number = NOW): SessionStateRow {
  return {
    id: `s-${name}`,
    channel_id: CHAN,
    workspace_id: WS,
    user_id: ME,
    name,
    display_name: null,
    updated_at: new Date(NOW).toISOString(),
    created_at: new Date(startedAt).toISOString(),
    started_at: new Date(startedAt).toISOString(),
  } as SessionStateRow;
}

/**
 * The transcript both halves reason over — `components/derivations.ts`'s row shape.
 *
 * ⚠ **BOTH ROWS SHARE `authorUserId: ME`, WHICH IS THE WHOLE DEFECT** (see the header), and the
 * AGENT row is the NEWEST (`seq` 102) so it must LOSE to an older human tag rather than merely
 * tie. `WORKER` is also the most-recently-LAUNCHED session, so arm 4 would name it too: the only
 * way to answer `PRIME` is to read the human's own older tag and honour it.
 */
const TRANSCRIPT = [
  {
    // Samuel → Prime. The human's own act, and the older of the two tags.
    seq: 101,
    createdAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
    authorUserId: ME,
    authorKind: "user",
    recipientAgentIds: [PRIME],
    metadata: {},
  },
  {
    // Prime → a worker, under SAMUEL'S user id, tag typed by the agent itself.
    seq: 102,
    createdAt: new Date(NOW - 60 * 60_000).toISOString(),
    authorUserId: ME,
    authorKind: "agent",
    recipientAgentIds: [WORKER],
    metadata: {},
  },
];

/** `PRIME` launched first, so `WORKER` is arm 4's answer — see {@link TRANSCRIPT}. */
const SESSIONS = [sessionRow(PRIME, NOW - 60 * 60_000), sessionRow(WORKER, NOW)];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("F-704 — my own agent's tag moves neither the line nor the verdict", () => {
  /**
   * Channel `bb0f57db`, exactly as reported: Samuel addresses Prime, Prime posts to a worker, and
   * Samuel's next UNTAGGED message must still reach Prime.
   *
   * ⚠ **THE THREE PRIOR FIXES EACH CHANGED WHICH ROWS THE ARM SELECTS AND NONE ADDED THIS
   * PREDICATE**, which is why the bug kept coming back: `c0794ed3` (09-04) fed arm 3 "who POSTED
   * here last", so any agent post moved everybody's default; the fix for THAT swapped
   * `author_kind = 'agent'` **for** `author_user_id = <person>` — a REPLACE where an INTERSECT
   * was wanted, deleting the only "a human did this" signal in the walk; `f5035e66` (09-06) then
   * removed the 15-minute window, which did not cause the stomp but made it permanent instead of
   * self-healing. The rule wants BOTH halves: this person, and this person themselves.
   */
  it("🔒 the client's line and the server's verdict both still name PRIME", async () => {
    // ── the CLIENT half — the feed is DERIVED, not handed in ──────────────
    const recentAgentIds = recentAgentsAddressedBy(ME, TRANSCRIPT);
    expect(recentAgentIds, "derived feed").toEqual([PRIME]);

    const client = draftReach({
      body: "what is left to do?",
      members: MEMBERS,
      sessions: SESSIONS.map((s) => ({
        name: s.name,
        displayName: s.display_name,
      })),
      currentUserId: ME,
      unaddressedResponder: "last_addressed",
      recentAgentIds,
      threadOtherParty: null,
    });
    expect(client.reason, "client reason").toBe("most recent");
    expect(
      client.recipients.filter((r) => r.kind === "agent").map((r) => r.agentId),
      "client agents"
    ).toEqual([PRIME]);

    // ── the SERVER half — the same rows, through its own read ─────────────
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue(SESSIONS);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(SESSIONS);
    vi.mocked(repo.findUnaddressedResponder).mockResolvedValue("last_addressed");
    vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue(
      TRANSCRIPT.map(
        (row) =>
          ({
            seq: row.seq,
            created_at: row.createdAt,
            author_user_id: row.authorUserId,
            author_kind: row.authorKind,
            recipient_agent_ids: row.recipientAgentIds,
            metadata: row.metadata,
          }) as never
      )
    );

    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS } as ChannelRow,
      { body: "what is left to do?", kind: "message" } as ChannelMessageCreateInput,
      {},
      { authorKind: "user", toAgentIds: [], toUserIds: [] },
      NOW
    );
    expect(server.reason, "server reason").toBe("most recent");
    expect(server.recipientAgentIds ?? [], "server agents").toEqual([PRIME]);
  });

  /**
   * 🔒 **AND THE HUMAN'S OWN NEWER TAG STILL WINS — the fix narrows arm 3, it does not freeze it.**
   * Without this, "agent rows are not evidence" could be satisfied by a rule that had stopped
   * reading recency altogether. Samuel tags the WORKER himself after Prime's handoff, so the
   * answer moves to the worker on both ends.
   */
  it("🔒 a human tag AFTER the agent's still moves the default", async () => {
    const rows = [
      ...TRANSCRIPT,
      {
        seq: 103,
        createdAt: new Date(NOW - 30 * 60_000).toISOString(),
        authorUserId: ME,
        authorKind: "user",
        recipientAgentIds: [WORKER],
        metadata: {},
      },
    ];

    expect(recentAgentsAddressedBy(ME, rows)).toEqual([WORKER, PRIME]);

    vi.mocked(repoSessions.listSessionStates).mockResolvedValue(SESSIONS);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(SESSIONS);
    vi.mocked(repo.findUnaddressedResponder).mockResolvedValue("last_addressed");
    vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue(
      rows.map(
        (row) =>
          ({
            seq: row.seq,
            created_at: row.createdAt,
            author_user_id: row.authorUserId,
            author_kind: row.authorKind,
            recipient_agent_ids: row.recipientAgentIds,
            metadata: row.metadata,
          }) as never
      )
    );

    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS } as ChannelRow,
      { body: "and now?", kind: "message" } as ChannelMessageCreateInput,
      {},
      { authorKind: "user", toAgentIds: [], toUserIds: [] },
      NOW
    );
    expect(server.reason).toBe("most recent");
    expect(server.recipientAgentIds ?? []).toEqual([WORKER]);
  });
});

/**
 * 🔒 **THE TERTIARY ARM IS NOBODY — ON BOTH ENDS** (F-705, 2026-09-15; Samuel's words: *"when
 * the last-tagged agent has ENDED, the fallback answers NOBODY — auto-address resets to
 * none-selected and stays there until the user tags someone new"*).
 *
 * ⚠ **IT LIVES BESIDE F-704's CASES BECAUSE THE TWO DEFECTS WORE ONE COMPLAINT.** "It sends to
 * an agent I never addressed" had two independent causes: arm 3 counting an AGENT's tag as its
 * operator's (F-704, fixed in `bb39ac61`), and the tertiary arm answering *whichever session
 * launched last* once nobody the asker addressed was still alive (this). Fixing the first left
 * the second visible, which is why Samuel saw the symptom survive the fix and asked a fifth
 * time. Keeping both sets in one file keeps that history legible to whoever comes sixth.
 * ⚠ **AN ORCHESTRATOR-SHAPED FALLBACK WAS BUILT, GREEN, AND THROWN AWAY THE SAME DAY** — it
 * answered the asker's own `Orchestrator` template. Rejected on PRODUCT grounds: that is one
 * operator's setup and this rule ships to every user. Re-proposing a named fallback needs a
 * concept that exists for all users first.
 */
describe("F-705 — nobody I addressed is alive, so nobody answers", () => {
  /** One human tag, naming whoever the case wants, plus nothing else. */
  const taggedBy = (agentId: string) => [
    {
      seq: 101,
      createdAt: new Date(NOW - 60_000).toISOString(),
      authorUserId: ME,
      authorKind: "user",
      recipientAgentIds: [agentId],
      metadata: {},
    },
  ];

  /** Both halves over one fixture — the sibling describe's arrangement, factored. */
  async function bothEnds(
    rows: ReturnType<typeof taggedBy>,
    sessions: SessionStateRow[]
  ) {
    const recentAgentIds = recentAgentsAddressedBy(ME, rows);
    const client = draftReach({
      body: "what is left to do?",
      members: MEMBERS,
      sessions: sessions.map((s) => ({
        name: s.name,
        displayName: s.display_name,
      })),
      currentUserId: ME,
      unaddressedResponder: "last_addressed",
      recentAgentIds,
      threadOtherParty: null,
    });
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue(sessions);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(sessions);
    vi.mocked(repo.findUnaddressedResponder).mockResolvedValue("last_addressed");
    vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue(
      rows.map(
        (row) =>
          ({
            seq: row.seq,
            created_at: row.createdAt,
            author_user_id: row.authorUserId,
            author_kind: row.authorKind,
            recipient_agent_ids: row.recipientAgentIds,
            metadata: row.metadata,
          }) as never
      )
    );
    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS } as ChannelRow,
      { body: "what is left to do?", kind: "message" } as ChannelMessageCreateInput,
      {},
      { authorKind: "user", toAgentIds: [], toUserIds: [] },
      NOW
    );
    return { client, server };
  }

  /**
   * 🔒 **THE PRIMARY RULE IS UNTOUCHED, AND THIS IS THE CASE THAT PROVES IT** — Samuel's #1 in
   * his own words: *"tagged messages sent from me go to the agent that was tagged by me last."*
   *
   * ⚠ **IT IS HERE BECAUSE THE FIX HAD ONE WAY TO GO WRONG.** The tertiary arm now answers
   * `null`, and `defaultResponder`'s laziness gate used to return early on a `null` settle — so
   * an implementation that kept that gate would skip arm 3 entirely and answer NOBODY even when
   * the asker's last-tagged agent is alive and well. That would break the primary rule while
   * every "fallback is nobody" test stayed green. `WORKER` is live and addressed; it must win.
   */
  it("🔒 a LIVE last-tagged agent still wins — the tertiary arm never outranks it", async () => {
    const { client, server } = await bothEnds(taggedBy(WORKER), [
      sessionRow(PRIME, NOW - 60 * 60_000),
      sessionRow(WORKER, NOW),
    ]);
    expect(client.reason, "client reason").toBe("most recent");
    expect(
      client.recipients.filter((r) => r.kind === "agent").map((r) => r.agentId)
    ).toEqual([WORKER]);
    expect(server.reason, "server reason").toBe("most recent");
    expect(server.recipientAgentIds ?? []).toEqual([WORKER]);
  });

  /**
   * 🔒 **THE LAST-TAGGED AGENT HAS ENDED → NOBODY, AND THE LINE SAYS SO TOO.**
   *
   * ⚠ `deadbeef` was tagged and is gone, so arm 3 has nothing live to offer. TWO agents are
   * live and one of them launched most recently — the old arm would have named it, which is the
   * wander Samuel kept seeing. Both ends must now answer silence, and the parity half is what
   * makes the silence honest: a composer line naming an agent the server will not wake is the
   * overstatement this suite exists to catch.
   */
  it("🔒 last-tagged agent ended → nobody, on both ends", async () => {
    const { client, server } = await bothEnds(taggedBy("deadbeef"), [
      sessionRow(PRIME, NOW - 60 * 60_000),
      sessionRow(WORKER, NOW),
    ]);
    expect(client.via, "client via").toBe("none");
    expect(client.recipients, "client recipients").toEqual([]);
    expect(server.verdict, "server verdict").toBe("none");
    expect(server.recipientAgentIds ?? []).toEqual([]);
    expect(server.reason ?? null, "server reason").toBeNull();
  });

  /**
   * 🔒 **AND ONE LIVE AGENT STILL ANSWERS — B1 IS NARROWED, NOT DELETED.**
   *
   * ⚠ Arm 2 ("only agent") sits ABOVE the tertiary arm and is untouched: a room holding exactly
   * one live agent needs no guess, so a forgotten `@` still does not stall there. Without this
   * case, "the fallback is nobody" could be read as "untagged messages never route", and the
   * next change would implement that.
   */
  it("🔒 a room with ONE live agent still answers, tag or no tag", async () => {
    const { client, server } = await bothEnds(taggedBy("deadbeef"), [
      sessionRow(PRIME, NOW - 60 * 60_000),
    ]);
    expect(client.reason, "client reason").toBe("only agent");
    expect(
      client.recipients.filter((r) => r.kind === "agent").map((r) => r.agentId)
    ).toEqual([PRIME]);
    expect(server.reason, "server reason").toBe("only agent");
    expect(server.recipientAgentIds ?? []).toEqual([PRIME]);
  });
});
