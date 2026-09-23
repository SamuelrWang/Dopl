/**
 * An agent-authored tag is not its operator's addressing, pinned on the client (`recentAgentsAddressedBy`
 * over transcript rows, as `components/derivations.ts` derives it) and the server (`resolveWakeVerdict`
 * over the same rows) at once (F-704). An agent posts under its operator's `author_user_id`, so
 * `author_kind` is the only discriminator; the agent types its own tag, so no `wake_reason` guard applies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./server/repository-sessions");
vi.mock("./server/repository-messages");
/** Partial: the real `unaddressedResponderFor` swallows a read error into the default, so an unmocked
 *  repository would pass by the fail-safe rather than the setting. */
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

/** Both rows share `authorUserId: ME`. The agent row is newest, and `WORKER` launched last, so only
 *  honouring the human's older tag answers `PRIME`. */
const TRANSCRIPT = [
  {
    // The human → PRIME.
    seq: 101,
    createdAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
    authorUserId: ME,
    authorKind: "user",
    recipientAgentIds: [PRIME],
    metadata: {},
  },
  {
    // PRIME → WORKER, under the human's user id, tag typed by the agent.
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

/** The client half: the composer line over a derived feed. */
function clientReach(recentAgentIds: string[], sessions: SessionStateRow[]) {
  return draftReach({
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
}

/** The server half: the same rows through its own reads. */
async function serverVerdict(
  rows: typeof TRANSCRIPT,
  sessions: SessionStateRow[],
  body = "what is left to do?"
) {
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
  return resolveWakeVerdict(
    CTX,
    { id: CHAN, workspace_id: WS } as ChannelRow,
    { body, kind: "message" } as ChannelMessageCreateInput,
    {},
    { authorKind: "user", toAgentIds: [], toUserIds: [], toDesktopOperatorIds: [] },
    NOW
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("my own agent's tag moves neither the line nor the verdict", () => {
  /** The rule needs both halves: this person, and this person themselves (not their agent). */
  it("the client's line and the server's verdict both still name PRIME", async () => {
    // The client half derives the feed rather than being handed it.
    const recentAgentIds = recentAgentsAddressedBy(ME, TRANSCRIPT);
    expect(recentAgentIds, "derived feed").toEqual([PRIME]);

    const client = clientReach(recentAgentIds, SESSIONS);
    expect(client.reason, "client reason").toBe("most recent");
    expect(
      client.recipients.filter((r) => r.kind === "agent").map((r) => r.agentId),
      "client agents"
    ).toEqual([PRIME]);

    const server = await serverVerdict(TRANSCRIPT, SESSIONS);
    expect(server.reason, "server reason").toBe("most recent");
    expect(server.recipientAgentIds ?? [], "server agents").toEqual([PRIME]);
  });

  /** The fix narrows arm 3; it must not stop reading recency. */
  it("a human tag AFTER the agent's still moves the default", async () => {
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

    const server = await serverVerdict(rows, SESSIONS, "and now?");
    expect(server.reason).toBe("most recent");
    expect(server.recipientAgentIds ?? []).toEqual([WORKER]);
  });
});

/** When nobody the asker addressed is alive, the tertiary arm answers nobody on both ends (F-705).
 *  A named fallback (e.g. an `Orchestrator` identity) was rejected: it encodes one operator's setup. */
describe("nobody I addressed is alive, so nobody answers", () => {
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

  async function bothEnds(
    rows: ReturnType<typeof taggedBy>,
    sessions: SessionStateRow[]
  ) {
    const client = clientReach(recentAgentsAddressedBy(ME, rows), sessions);
    return { client, server: await serverVerdict(rows, sessions) };
  }

  /** A null tertiary settle must not skip arm 3: a live last-tagged agent still wins. */
  it("a LIVE last-tagged agent still wins — the tertiary arm never outranks it", async () => {
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

  /** `deadbeef` is gone while two agents are live, and neither may be guessed; a composer line
   *  naming an agent the server will not wake is the overstatement this suite catches. */
  it("last-tagged agent ended → nobody, on both ends", async () => {
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

  /** Arm 2 ("only agent") sits above the tertiary arm: a one-agent room needs no guess. */
  it("a room with ONE live agent still answers, tag or no tag", async () => {
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
