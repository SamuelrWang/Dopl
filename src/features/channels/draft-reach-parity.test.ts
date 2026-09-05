/**
 * 🔒 **THE COMPOSER'S PREDICTION AND THE SERVER'S VERDICT, OVER ONE FIXTURE
 * TABLE** (F-551; added 2026-09-02 in the batch-2 review).
 *
 * ⚠ **THE PROBLEM IS NOT THAT THERE ARE TWO IMPLEMENTATIONS — IT IS THAT THEY
 * HAD NO SHARED CASE.** `lib/draft-recipients.ts › draftReach` predicts who an
 * unsent draft will reach; `server/service-wake-verdict.ts › resolveWakeVerdict`
 * decides it at write time and stores the answer. Each had a suite that agreed
 * with ITSELF, which is not the two ends agreeing — the same distinction the
 * escalation-body parity suite exists for. A composer line that overstates reach
 * is worse than no line: it tells a guest their message was seen.
 *
 * ⚠ **WHY NOT ONE SHARED RESOLVER, WHICH IS WHAT F-551 ASKS FOR.** The two are
 * not the same function and cannot be: the server's arms take DATABASE reads
 * (the room projection, the last address to an agent, the fold's own metadata
 * stamps) and this module is `server-only`; the client has a rendered pane and
 * no credentials. What they must SHARE is the arm ORDER and the parsers, and
 * they already do — `lib/mentions.ts`, `lib/agent-mentions.ts`, and
 * `resolveDefaultResponder`, which the server's `defaultResponder` is an adapter
 * over. **This file is the assertion that the sharing is real.** Folding the two
 * callers into one resolver stays F-551's, in the slice that owns both files.
 *
 * ⚠ **RR2 IS PREDICTED NOWHERE, AND THAT IS RECORDED RATHER THAN FIXED.** It is
 * an AGENT author's arm and no browser holds an agent credential, so this
 * surface cannot reach it — but that also means the one arm with no client
 * prediction is the one whose author is a machine, which is exactly the caller
 * least able to notice a silent non-delivery. The last case below pins the gap
 * so it is a decision and not an oversight.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server/repository-sessions");
vi.mock("./server/repository-messages");

import * as repoSessions from "./server/repository-sessions";
import * as repoMessages from "./server/repository-messages";
import { draftReach } from "./lib/draft-recipients";
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
const NOW = Date.parse("2026-09-02T12:00:00Z");

const CTX = { workspaceId: WS, userId: ME, source: "user" } as ChannelContext;

function member(userId: string, name: string): ChannelMember {
  return { userId, displayName: name, email: `${name}@x.test` } as ChannelMember;
}

const MEMBERS = [member(ME, "me"), member(PEER, "ada")];

function sessionRow(
  name: string,
  displayName: string | null = null,
  /** When the session LAUNCHED — RR3 arm 4's ordering on the server side. */
  startedAt: number = NOW
): SessionStateRow {
  return {
    id: `s-${name}`,
    channel_id: CHAN,
    workspace_id: WS,
    user_id: ME,
    name,
    display_name: displayName,
    updated_at: new Date(NOW).toISOString(),
    created_at: new Date(startedAt).toISOString(),
    started_at: new Date(startedAt).toISOString(),
  } as SessionStateRow;
}

/**
 * ONE CASE, ASKED BOTH WAYS.
 *
 * ⚠ THE SESSIONS ARE THE SAME ROWS FOR BOTH SIDES. The client is handed what the
 * peer projection rendered; the server reads the same rows out of
 * `channel_sessions`. A fixture that gave them different sets would prove the
 * two agree about nothing.
 */
interface Case {
  name: string;
  body: string;
  /** Live agents in the room, ALL of them the caller's own here — the two arms
   *  that read an own-scoped set and a channel-wide one then coincide, which is
   *  what lets one fixture drive both. */
  sessions: SessionStateRow[];
  defaultResponder?: string | null;
  /** RR3 arm 3's input — **the agents THIS AUTHOR tagged here lately, most recent first**
   *  (2026-09-04; it was "the agents that posted here" for one day, and an agent tagging another
   *  agent moved everyone's default). The client is handed it directly; the server derives it from
   *  the author's own rows this fixture stands in for. */
  recentAgentIds?: string[];
  /** RR1: the composer is inside a thread whose other party is this member. */
  threadOtherParty?: ChannelMember | null;
  /** What BOTH sides must answer. */
  expect: {
    via: "tagged" | "responder" | "thread" | "none";
    verdict: "agent" | "member" | "thread_peer" | "responder" | "none";
    agentIds: string[];
    userIds: string[];
    /** ⚠ THE ARM, NOT JUST THE NAME. Two arms can name the same agent for
     *  different reasons, and the surfaces PRINT the reason. */
    reason?: string | null;
  };
}

const CASES: Case[] = [
  {
    name: "an @-tagged live agent — the address the author wrote",
    body: "@agent-k3v7d2mq please look at the build",
    sessions: [sessionRow("k3v7d2mq")],
    expect: { via: "tagged", verdict: "agent", agentIds: ["k3v7d2mq"], userIds: [] },
  },
  {
    name: "an unaddressed post with ONE live agent — RR3 arm 2",
    body: "can someone look at the build?",
    sessions: [sessionRow("k3v7d2mq")],
    expect: { via: "responder", verdict: "responder", agentIds: ["k3v7d2mq"], userIds: [] },
  },
  {
    // ⚠ THE #966 CASE. Both sides answered "nobody" until 2026-09-04 and the
    // post reached nobody — in the ORDINARY shape of a multiplayer channel.
    // Samuel's B1: a forgotten `@` must never stall.
    name: "TWO live agents and no setting — RR3 arm 3, the one THIS AUTHOR tagged last",
    body: "can someone look at the build?",
    sessions: [sessionRow("k3v7d2mq"), sessionRow("m8q1zzzz")],
    recentAgentIds: ["m8q1zzzz"],
    expect: {
      via: "responder",
      verdict: "responder",
      agentIds: ["m8q1zzzz"],
      userIds: [],
      reason: "most recent",
    },
  },
  {
    // ⚠ ARM 4, AND THE ORDERING IS THE ANSWER. Neither has posted, so both sides
    // take the FIRST candidate in the order they hold them — the server sorts by
    // `started_at`, the composer takes the projection's own order, and the
    // fixture hands them the same list.
    name: "TWO live agents, neither has spoken — RR3 arm 4, the newest launched",
    body: "can someone look at the build?",
    sessions: [
      sessionRow("m8q1zzzz", null, NOW),
      sessionRow("k3v7d2mq", null, NOW - 60_000),
    ],
    expect: {
      via: "responder",
      verdict: "responder",
      agentIds: ["m8q1zzzz"],
      userIds: [],
      reason: "most recently launched",
    },
  },
  {
    name: "TWO live agents and a configured responder — RR3 arm 1",
    body: "can someone look at the build?",
    sessions: [sessionRow("k3v7d2mq"), sessionRow("m8q1zzzz")],
    defaultResponder: "agent-m8q1zzzz",
    expect: { via: "responder", verdict: "responder", agentIds: ["m8q1zzzz"], userIds: [] },
  },
  {
    name: "a responder that is NOT live degrades to arm 2 rather than failing",
    body: "anyone?",
    sessions: [sessionRow("k3v7d2mq")],
    defaultResponder: "agent-nothere",
    expect: { via: "responder", verdict: "responder", agentIds: ["k3v7d2mq"], userIds: [] },
  },
  {
    name: "no agents at all — `none` is an ANSWER, not a failure",
    body: "just thinking out loud",
    sessions: [],
    expect: { via: "none", verdict: "none", agentIds: [], userIds: [] },
  },
  {
    name: "a thread reply with no address — RR1, the exchange's other party",
    body: "done",
    sessions: [sessionRow("k3v7d2mq")],
    threadOtherParty: MEMBERS[1],
    expect: { via: "thread", verdict: "thread_peer", agentIds: [], userIds: [PEER] },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoMessages.findLastRoomAddressToAgent).mockResolvedValue(null);
});

describe("🔒 the composer's line and the server's verdict agree, case for case", () => {
  it.each(CASES)("$name", async (c) => {
    // ── the CLIENT half ───────────────────────────────────────────────────
    const client = draftReach({
      body: c.body,
      members: MEMBERS,
      sessions: c.sessions.map((s) => ({ name: s.name, displayName: s.display_name })),
      currentUserId: ME,
      defaultResponderAgentName: c.defaultResponder ?? null,
      recentAgentIds: c.recentAgentIds ?? [],
      threadOtherParty: c.threadOtherParty ?? null,
    });
    expect(client.via, "client `via`").toBe(c.expect.via);
    if (c.expect.reason !== undefined) {
      expect(client.reason, "client reason").toBe(c.expect.reason);
    }
    expect(
      client.recipients.filter((r) => r.kind === "agent").map((r) => r.agentId).sort(),
      "client agents"
    ).toEqual([...c.expect.agentIds].sort());
    expect(
      client.recipients.filter((r) => r.kind === "member").map((r) => r.userId).sort(),
      "client members"
    ).toEqual([...c.expect.userIds].sort());

    // ── the SERVER half, over the same rows ───────────────────────────────
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue(c.sessions);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(c.sessions);
    // ⚠ THE SERVER GETS THE SAME RECENCY FACT AS ROWS, NOT AS THE ANSWER — its
    // half runs `recentAgentsAddressedBy` over these, which is the whole point of
    // the pair: one rule, two inputs, one answer.
    // ⚠ THE ROWS ARE THE AUTHOR'S OWN TAGS SINCE 2026-09-04 (Samuel's ruling), not agent POSTS:
    // `author_user_id: ME`, the addressed agent in `recipient_agent_ids`, and — load-bearing — NO
    // `wake_reason`, because a row the SERVER aimed is not evidence of what the author addressed.
    // The case below with a `wake_reason` row is what pins that half.
    vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue(
      (c.recentAgentIds ?? []).map(
        (id, i) =>
          ({
            seq: 100 - i,
            created_at: new Date(NOW - 1_000).toISOString(),
            author_user_id: ME,
            recipient_agent_ids: [id],
            metadata: {},
          }) as never
      )
    );
    // ⚠ RR1 reaches the server through the fold's OWN stamps, not through a
    // thread row — the client cannot see those and asks the pane instead. The
    // two answers must still match, which is what this case pair proves.
    const metadata: Record<string, unknown> =
      c.threadOtherParty !== undefined && c.threadOtherParty !== null
        ? { taskId: "t-1", taskCreatedBy: ME, taskTarget: c.threadOtherParty.userId }
        : {};

    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS, default_responder_agent_name: c.defaultResponder ?? null } as ChannelRow,
      { body: c.body, kind: "message" } as ChannelMessageCreateInput,
      metadata,
      { authorKind: "user", toAgentId: null },
      NOW
    );
    expect(server.verdict, "server verdict").toBe(c.expect.verdict);
    if (c.expect.reason !== undefined) {
      expect(server.reason, "server reason").toBe(c.expect.reason);
    }
    expect([...(server.recipientAgentIds ?? [])].sort(), "server agents").toEqual(
      [...c.expect.agentIds].sort()
    );
    expect([...(server.recipientUserIds ?? [])].sort(), "server members").toEqual(
      [...c.expect.userIds].sort()
    );
  });
});

describe("⚠ RR2 is predicted by NOBODY, and that is the recorded gap (F-551)", () => {
  it("the client module models three arms and names the fourth as out of scope", async () => {
    // ⚠ An agent author's reciprocal arm has no client prediction because no
    // browser holds an agent credential — so the ONE arm with no preview is the
    // one whose author is a machine, i.e. the caller least able to notice a
    // silent non-delivery. Pinned as a DECISION rather than left as an absence.
    const { readFileSync } = await import("node:fs");
    // ⚠ Comment prose wraps, so the scan squashes whitespace and the leading
    // `*` of each continuation line — a regex over the raw text would pin the
    // WRAPPING and go red on a re-flow that changed nothing.
    const src = readFileSync(
      new URL("./lib/draft-recipients.ts", import.meta.url),
      "utf8"
    )
      .replace(/^\s*\*/gm, "")
      .replace(/\s+/g, " ");
    expect(src).toContain(
      "RR2 is an agent author's arm and no browser holds an agent credential"
    );
    expect(src).not.toMatch(/reciprocalParty/);
  });

  /**
   * 🔒 **THE SERVER'S OWN PICK IS NOT EVIDENCE** (Samuel, 2026-09-04) — the case the whole
   * stored-metadata route exists for.
   *
   * ⚠ **THE BUG THIS CATCHES IS SELF-REINFORCEMENT.** RR3's pick is stored in
   * `recipient_agent_ids` exactly like a typed tag, so a rule that read recipients alone would
   * feed on its own output: pick an agent once, and every later read sees it "addressed" and picks
   * it again forever. `wake_reason` is present ONLY when the server chose, which is what tells the
   * two apart (`lib/agent-post-stamp.ts › isAuthorTypedAgentTag`).
   *
   * The fixture: the NEWEST row aimed `k3v7d2mq` and carries a `wake_reason`, so it is the
   * server's own doing and must be ignored; the older row is the author's own tag of `m8q1zzzz`.
   * A rule reading recency alone answers `k3v7d2mq`. The right answer is `m8q1zzzz`.
   */
  it("🔒 ignores a row the SERVER aimed, and takes the author's own older tag", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow("k3v7d2mq"),
      sessionRow("m8q1zzzz"),
    ]);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow("k3v7d2mq"),
      sessionRow("m8q1zzzz"),
    ]);
    vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue([
      {
        seq: 200,
        created_at: new Date(NOW - 1_000).toISOString(),
        author_user_id: ME,
        recipient_agent_ids: ["k3v7d2mq"],
        // ⚠ THE SERVER'S VOICE — this row was aimed by RR3, not typed by the author.
        metadata: { wake_reason: "most recent" },
      },
      {
        seq: 199,
        created_at: new Date(NOW - 2_000).toISOString(),
        author_user_id: ME,
        recipient_agent_ids: ["m8q1zzzz"],
        metadata: {},
      },
    ] as never);

    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS, default_responder_agent_name: null } as ChannelRow,
      { body: "can someone look at the build?", kind: "message" } as ChannelMessageCreateInput,
      {},
      { authorKind: "user", toAgentId: null },
      NOW
    );
    expect(server.recipientAgentIds ?? []).toEqual(["m8q1zzzz"]);
    expect(server.reason).toBe("most recent");
  });

  it("and the server's RR2 answers where the client would have said `none`", async () => {
    // The behaviour the client cannot show: same body, same room, agent author.
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow("k3v7d2mq")]);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([sessionRow("k3v7d2mq")]);
    vi.mocked(repoMessages.findLastRoomAddressToAgent).mockResolvedValue({
      seq: 7,
      author_user_id: PEER,
    } as never);

    const server = await resolveWakeVerdict(
      CTX,
      { id: CHAN, workspace_id: WS } as ChannelRow,
      { body: "done", kind: "message", clientMsgId: "agent-k3v7d2mq-4" } as ChannelMessageCreateInput,
      {},
      { authorKind: "agent", toAgentId: null },
      NOW
    );
    expect(server.verdict).toBe("reciprocal");
    expect(server.recipientUserIds).toEqual([PEER]);
  });
});
