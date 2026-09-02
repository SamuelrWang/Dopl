import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESILIENCE_WINDOW_MS } from "@/shared/channels/caps";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";
import type { SessionStateRow } from "./collab-dto";
import { ownLiveAgentIds, resolveWakeVerdict } from "./service-wake-verdict";
import type { ChannelContext } from "./service-shared";
import type { ChannelRow, ChannelMessageRow } from "./dto";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");

import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";

/**
 * **THE SERVER'S OWN ANSWER TO "WHO IS THIS FOR, AND DID IT WAKE ANYBODY"**
 * (2026-09-02, A9 — G11, G12, G15).
 *
 * ⚠ **THE CASES THAT MATTER ARE THE THREE-WAY DISTINCTION**, not the happy path:
 * `[]` (resolved to nobody), `null` (not resolved here — the machine decides)
 * and `"none"` (addresses nobody) are three different answers, and collapsing
 * any two of them either silences an agent the desktop can see or reports a
 * delivery that never happened.
 */

const NOW = Date.parse("2026-09-02T12:00:00Z");
const CTX: ChannelContext = {
  userId: "user-1",
  workspaceId: "ws-1",
} as ChannelContext;

function sessionRow(over: Partial<SessionStateRow>): SessionStateRow {
  return {
    id: "s-1",
    channel_id: "chan-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    session_key: "chan-1:task-1:k3v7d2mq",
    task_id: null,
    name: "k3v7d2mq",
    state: "working",
    channel_name: null,
    thread_title: null,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW - 1_000).toISOString(),
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    display_name: null,
    template_name: null,
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    ...over,
  } as SessionStateRow;
}

/** The CALLER'S OWN live sessions — the own-scoped door the body parse reads. */
function projection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue(rows);
}

/** EVERY member's sessions in the room — RR3's candidate set. ⚠ A DIFFERENT
 *  read from {@link projection}, and asserting on the wrong one is how the
 *  same-account carve would appear to hold while being widened. */
function roomProjection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(rows);
}

/** RR2's one read — the last main-room row addressed to this agent. */
function lastAddress(row: Partial<ChannelMessageRow> | null): void {
  vi.mocked(repoMessages.findLastRoomAddressToAgent).mockResolvedValue(
    row === null ? null : ({ seq: 7, author_user_id: "user-2", ...row } as ChannelMessageRow)
  );
}

function channelRow(over: Partial<ChannelRow> = {}): ChannelRow {
  return { id: "chan-1", workspace_id: "ws-1", ...over } as ChannelRow;
}

interface ResolveOpts {
  kind?: "message" | "task_progress";
  authorKind?: string;
  toAgentId?: string | null;
  threadTagStripped?: boolean;
  clientMsgId?: string;
  channel?: Partial<ChannelRow>;
}

/** One post, resolved. `metadata` is the fold's OUTPUT, which is what the
 *  resolver reads — never the caller's raw input. */
function resolve(
  body: string,
  metadata: Record<string, unknown> = {},
  opts: ResolveOpts = {}
) {
  return resolveWakeVerdict(
    CTX,
    channelRow(opts.channel),
    {
      body,
      kind: opts.kind ?? "message",
      clientMsgId: opts.clientMsgId,
    } as Parameters<typeof resolveWakeVerdict>[2],
    metadata,
    {
      authorKind: opts.authorKind ?? "user",
      toAgentId: opts.toAgentId ?? null,
      threadTagStripped: opts.threadTagStripped,
    },
    NOW
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  lastAddress(null);
});

describe("resolveWakeVerdict — the recipient", () => {
  it("resolves a `to=` member to `member`, and the id is the SERVER'S stamp", async () => {
    // ⚠ It reads `metadata.to_user_id`, not `input.toUserId`: the anti-spoof
    // strip in `resolvePostMetadata` is what makes that key trustworthy, and a
    // resolver reading the raw input would resolve a recipient the strip
    // rejected.
    const out = await resolve("anything", { to_user_id: "user-2" });
    expect(out).toMatchObject({
      verdict: "member",
      recipientUserIds: ["user-2"],
      delivery: "delivered",
    });
  });

  it("resolves `@agent-<id>` against the caller's own live sessions", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq take this");
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
  });

  it("resolves the BARE id form too — every message written before 2026-08-27 carries it", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    expect((await resolve("@k3v7d2mq ping")).recipientAgentIds).toEqual([
      "k3v7d2mq",
    ]);
  });

  it("resolves a renamed agent's SLUG through the one shared index", async () => {
    // ⚠ The picker inserts the slug (`lib/agent-mentions.ts ›
    // agentMentionHandle` prefers it), so a resolver that read only the id form
    // would answer "nobody" for very nearly every named agent.
    projection(sessionRow({ name: "k3v7d2mq", display_name: "Research Bot" }));
    expect((await resolve("@research-bot go")).recipientAgentIds).toEqual([
      "k3v7d2mq",
    ]);
  });

  it("fails CLOSED on an ambiguous slug — two agents, one name, neither resolves", async () => {
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" })
    );
    // ⚠ NOT `[]`: the tokens are real and this server cannot say who they mean,
    // so the machine — which can — is left to decide.
    const out = await resolve("@bot go");
    expect(out.recipientAgentIds).toBeNull();
    expect(out.delivery).toBe("unreachable");
  });

  it("prefers the AGENT over the member when a post does both", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq please", { to_user_id: "user-2" });
    expect(out.verdict).toBe("agent");
    // ⚠ The member is still RECORDED. The verdict names the loudest reach; the
    // recipient columns are the full answer, and a consent card still keys on
    // `metadata.to_user_id`.
    expect(out.recipientUserIds).toEqual(["user-2"]);
  });

  it("answers `thread` for an unaddressed post that carries a thread tag", async () => {
    const out = await resolve("status?", { taskId: "task-1" });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("answers `none` for a plain unaddressed post", async () => {
    expect(await resolve("morning")).toMatchObject({
      verdict: "none",
      recipientUserIds: [],
      recipientAgentIds: [],
      delivery: "none",
    });
  });
});

describe("resolveWakeVerdict — the three-way distinction", () => {
  it("a body with NO handle resolves to `[]` — a complete answer", async () => {
    expect((await resolve("no tags here")).recipientAgentIds).toEqual([]);
  });

  it("a handle nothing answers to resolves to NULL, and the delivery says `unreachable`", async () => {
    // ⚠ THE CASE THE WHOLE FILE IS FOR. `[]` would tell the desktop "nobody",
    // and it would stop feeding an agent it can see — the token may name a
    // PEER's agent, whose id is minted on their machine and known to no server.
    const out = await resolve("@agent-zzzzzzzz over to you");
    expect(out.recipientAgentIds).toBeNull();
    expect(out.verdict).toBe("none");
    expect(out.delivery).toBe("unreachable");
  });

  it("a STALE projection row resolves nothing — a quiet row is not an absent agent", async () => {
    projection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    expect((await resolve("@agent-k3v7d2mq go")).recipientAgentIds).toBeNull();
  });

  it("a row on the freshness boundary still counts", async () => {
    projection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS + 1).toISOString(),
      })
    );
    expect((await resolve("@agent-k3v7d2mq go")).recipientAgentIds).toEqual([
      "k3v7d2mq",
    ]);
  });

  it("an unparseable stamp is STALE, not fresh", async () => {
    projection(sessionRow({ name: "k3v7d2mq", updated_at: "not-a-date" }));
    expect((await resolve("@agent-k3v7d2mq go")).recipientAgentIds).toBeNull();
  });
});

describe("resolveWakeVerdict — what it does NOT do", () => {
  it("reads the projection ONLY when the body carries a handle", async () => {
    // ⚠ EVERY post would otherwise pay for a `channel_sessions` read. The early
    // return in `resolveAgentRecipients` is the bound, and it is asserted rather
    // than assumed because a later edit that moved the read above the token
    // check would be invisible in every other case here.
    await resolve("plain words", { to_user_id: "user-2" });
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
  });

  it("does not resolve agents for a non-`message` kind", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq done", {}, { kind: "task_progress" });
    // Only `message` reaches a session at all (`main/session-dispatch.js`'s kind
    // filter), so resolving one here would promise a wake that cannot happen.
    expect(out.recipientAgentIds).toBeNull();
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
  });

  it("a non-`message` kind is NOT `unreachable` — it never asked the agent half", async () => {
    // 🔒 `recipientAgentIds` IS `null` FOR TWO REASONS AND THE COLUMN CANNOT TELL
    // THEM APART (fixed 2026-09-02): "handles were named and none resolved", and
    // "the kind gate never asked". Reading the null alone stamped `unreachable`
    // on EVERY `task_progress` and `task_finished` row — so a thread's own
    // milestones read, to an orchestrator, as a room full of failed deliveries.
    const threaded = await resolve("step two done", { taskId: "task-1" }, { kind: "task_progress" });
    expect(threaded.verdict).toBe("thread");
    expect(threaded.delivery).toBe("idle");

    const bare = await resolve("done", {}, { kind: "task_progress" });
    expect(bare.verdict).toBe("none");
    expect(bare.delivery).toBe("none");

    // …even when the body is full of handles: the gate ran before the resolver.
    const named = await resolve("@agent-k3v7d2mq done", {}, { kind: "task_progress" });
    expect(named.delivery).toBe("none");
  });

  it("a MESSAGE whose handles resolve to nobody IS `unreachable` — the arm is kept", async () => {
    // ⚠ THE OTHER SIDE OF THE SAME GATE. The kind term must not swallow the case
    // `unreachable` exists for: a post whose whole point was a name, reaching
    // nothing this server can see (G15).
    projection(sessionRow({ name: "zzzzzzzz" }));
    const out = await resolve("@agent-k3v7d2mq go", { taskId: "task-1" });
    expect(out.recipientAgentIds).toBeNull();
    expect(out.delivery).toBe("unreachable");
  });

  it("scopes the projection read to the caller and this channel", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    await resolve("@agent-k3v7d2mq go");
    expect(vi.mocked(repoSessions.listSessionStates).mock.calls).toEqual([
      ["user-1", "ws-1", "chan-1"],
    ]);
  });

  it("does not resolve the escalation-answer door — that agent is not the author's", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    // ⚠ TWO live agents and no default responder, so RR3 answers NOBODY and the
    // case still measures what it was written to measure: the server does not
    // reach for `escalationAnswer.agentId`. With one live agent RR3 arm 2 would
    // resolve that same handle for an unrelated reason and the assertion would
    // pass by coincidence.
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("option two", {
      escalationAnswer: { agentId: "k3v7d2mq" },
    });
    // The machine unions it in against the ids live on the thread; answering
    // here would mean answering `[]`, and `[]` is authoritative.
    expect(out.verdict).toBe("none");
    expect(out.recipientAgentIds).toEqual([]);
  });
});

describe("ownLiveAgentIds — the shared projection read (G3 / F-418)", () => {
  it("reports the ids and that the projection had something recent to say", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    expect(await ownLiveAgentIds(CTX, "chan-1", NOW)).toEqual({
      ids: ["k3v7d2mq"],
      projectionFresh: true,
    });
  });

  it("reports `projectionFresh: false` when every row is stale — NOT that the agent is gone", async () => {
    projection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    expect(await ownLiveAgentIds(CTX, "chan-1", NOW)).toEqual({
      ids: [],
      projectionFresh: false,
    });
  });

  it("reports `projectionFresh: false` for an empty projection", async () => {
    expect((await ownLiveAgentIds(CTX, "chan-1", NOW)).projectionFresh).toBe(
      false
    );
  });
});

describe("the outcome and the verdict are separate answers", () => {
  it("a THREADED post naming an agent nothing answers to reports `unreachable`, not `idle`", () => {
    // ⚠ FOUND BY THE COMPOSED DRIVE (`delivery-composed.test.ts`), not by a unit case, which is
    // the whole argument for that file: read alone, `verdict: "thread"` and `delivery: "idle"`
    // are both defensible — together they hid the fact that the post's whole point was a name
    // nobody here answers to.
    return expect(
      resolve("@agent-zzzzzzzz please", { taskId: "task-1" })
    ).resolves.toMatchObject({ verdict: "thread", delivery: "unreachable" });
  });

  it("a STRONGER reach wins — an unresolvable handle beside a real `to=` still `delivered`", async () => {
    const out = await resolve("@agent-zzzzzzzz fyi", { to_user_id: "user-2" });
    expect(out).toMatchObject({ verdict: "member", delivery: "delivered" });
  });

  it("…and beside an agent that DID resolve, the wake is the story", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq and @agent-zzzzzzzz");
    expect(out).toMatchObject({ verdict: "agent", delivery: "woken" });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });
});

/**
 * **THE THREE RESILIENCE ARMS (B1)** — Samuel's ruling: narrowing the fan-out to
 * the addressed recipient must never let a forgotten `@` stall a conversation.
 *
 * ⚠ **EVERY CASE HERE IS PAIRED WITH ITS DEGENERATE ONE**, because each arm's
 * failure mode is silent: an arm that never fires looks exactly like a room
 * where nobody was addressed, and an arm that fires too eagerly looks exactly
 * like a delivery. Only the pair distinguishes them.
 */
describe("RR1 — a thread reply with no `to` goes to the thread's other party", () => {
  it("resolves the OTHER party from the server's own thread stamps", async () => {
    const out = await resolve("what about the migration?", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(out).toMatchObject({
      verdict: "thread_peer",
      recipientUserIds: ["user-2"],
      recipientAgentIds: [],
      delivery: "delivered",
    });
  });

  it("…in EITHER direction — the author is whichever of the two they are", async () => {
    const out = await resolve("on it", {
      taskId: "task-1",
      taskCreatedBy: "user-2",
      taskTarget: "user-1",
    });
    expect(out.recipientUserIds).toEqual(["user-2"]);
  });

  it("costs NO extra read — the pair is already stamped in the metadata fold", async () => {
    await resolve("hi", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("DEGENERATE: an unaddressed thread has no other party — `thread`, not a guess", async () => {
    // `taskTarget` absent = the thread names nobody. There is no "other" to be
    // the other of, and inventing one would route a reply at the opener's
    // machine on the strength of a missing key.
    const out = await resolve("anyone?", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
    });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a LEGACY tag stamps no pair, so it stays `thread`", async () => {
    // A `task-<channelId>-<seq>` id resolves to no row, so fold 3 stamps none of
    // the four keys. RR1 answering nobody here is what keeps every installed
    // desktop's lifecycle echo costing one read instead of two.
    const out = await resolve("step done", { taskId: "task-chan-1-4" });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a STRIPPED legacy tag answers `none` and repairs NOTHING", async () => {
    // The poster is not in that exchange, so the tag was dropped. The post LOOKS
    // like a main-room post and is not one — the author was talking to a thread,
    // and repairing the address would put their words in front of whoever
    // happens to be in the room.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("as discussed", {}, { threadTagStripped: true });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("an explicit `to=` still wins — RR1 only fires when NOBODY was addressed", async () => {
    const out = await resolve("ping", {
      to_user_id: "user-3",
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(out).toMatchObject({ verdict: "member", recipientUserIds: ["user-3"] });
  });
});

describe("RR2 — an unaddressed agent post in the main room goes back to whoever addressed it", () => {
  it("resolves the AUTHOR of the last row addressed to this agent, inside the window", async () => {
    lastAddress({ author_user_id: "user-9", seq: 12 });
    const out = await resolve("here is the summary", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out).toMatchObject({
      verdict: "reciprocal",
      recipientUserIds: ["user-9"],
      recipientAgentIds: [],
      delivery: "delivered",
    });
  });

  it("asks over the RESILIENCE WINDOW, read from `caps.ts` and never quoted", async () => {
    lastAddress({ author_user_id: "user-9" });
    await resolve("done", {}, { authorKind: "agent", clientMsgId: "agent-k3v7d2mq-4" });
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent).mock.calls).toEqual([
      ["chan-1", "k3v7d2mq", new Date(NOW - RESILIENCE_WINDOW_MS).toISOString()],
    ]);
  });

  it("resolves a MEMBER, never an agent — which is what keeps the same-account carve total", async () => {
    // 🔒 THE CROSS-ACCOUNT FENCE. "The party that addressed me" is an account,
    // whose own machine decides what runs. An arm that answered an AGENT id here
    // could aim an agent-authored wake at a PEER's agent through a rule the
    // author never wrote — exactly what Samuel's 2026-08-31 carve forbids.
    lastAddress({ author_user_id: "user-9" });
    const out = await resolve("reply", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out.recipientAgentIds).toEqual([]);
  });

  it("DEGENERATE: nobody addressed it inside the window — `none`, a broadcast", async () => {
    lastAddress(null);
    const out = await resolve("thinking out loud", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
  });

  it("DEGENERATE: an UNSTAMPED agent post cannot say which agent it is — no arm, no read", async () => {
    // `null` from `parseAgentPostStamp` is "cannot say", never "some other
    // agent". Guessing would aim somebody's reply at the wrong conversation.
    const out = await resolve("no key", {}, { authorKind: "agent" });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("DEGENERATE: a MACHINE-level courtesy stamp is not an agent stamp", async () => {
    // `main/channel-post.js › postCourtesy` stamps `agent-<channelUUID>-<seq>`,
    // and the parser is ANCHORED for exactly this reason.
    const out = await resolve("courtesy", {}, {
      authorKind: "agent",
      clientMsgId: "agent-3f2b9c1e-4a5d-4c8e-9f01-2b3c4d5e6f70-1",
    });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("never reaches RR3 — an agent author does not get the room's default responder", async () => {
    // 🔒 THE ARMS ARE DISJOINT. RR3 exists so a PERSON is answered; handing an
    // agent's unaddressed thinking to the room's responder is the fan-out this
    // wave is deleting, wearing a new name.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    lastAddress(null);
    const out = await resolve("musing", {}, {
      authorKind: "agent",
      clientMsgId: "agent-m8q1zzzz-2",
    });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });
});

describe("RR3 — an unaddressed human message is answered by one agent", () => {
  it("arm 1: the channel's configured DEFAULT RESPONDER wins", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("can someone look at the build?", {}, {
      channel: { default_responder_agent_name: "agent-m8q1zzzz" },
    });
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["m8q1zzzz"],
      recipientUserIds: [],
      delivery: "woken",
    });
  });

  it("arm 1: the setting accepts the BARE handle too, through the one index", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("hello", {}, {
      channel: { default_responder_agent_name: "m8q1zzzz" },
    });
    expect(out.recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  it("arm 1: a renamed responder resolves by its SLUG", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Build Bot" })
    );
    const out = await resolve("hello", {}, {
      channel: { default_responder_agent_name: "build-bot" },
    });
    expect(out.recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  it("arm 2: exactly ONE live agent answers by itself — no setting needed", async () => {
    // ⚠ THIS IS WHY THE LLM TRIAGE LOOP GOES (B6). `tierFor` collapses to
    // `n === 1 ? SOLO : NONE`, and solo is computed here for free.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
  });

  it("arm 2: a responder that is NOT LIVE degrades into the sole agent", async () => {
    // The setting stores a handle and nothing enforces that it names a live
    // session — an FK to `agent_templates` would be a cross-visibility
    // reference. It degrades; it does not dangle.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning", {}, {
      channel: { default_responder_agent_name: "agent-gone1234" },
    });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });

  it("arm 3: TWO live agents and no setting answer NOBODY — the pick is the guess this deletes", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "none",
      recipientAgentIds: [],
      delivery: "none",
    });
  });

  it("arm 3: no live agent at all is `none` too", async () => {
    const out = await resolve("morning");
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
  });

  it("a STALE room row is not a live agent — freshness gates the wake", async () => {
    roomProjection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    expect((await resolve("morning")).verdict).toBe("none");
  });

  it("does not fire for a non-`message` kind — a milestone repairs no address", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("step two", {}, { kind: "task_progress" });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("does not fire when the author addressed somebody", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("look at this", { to_user_id: "user-2" });
    expect(out.verdict).toBe("member");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });
});

describe("`to=@agent` — the union resolver's half of the verdict", () => {
  it("stores the agent the PARAMETER named, without reading the projection", async () => {
    // The resolution already happened at the door
    // (`service-writes-metadata-recipient.ts`); re-deriving it here would be a
    // second answer to a settled question.
    const out = await resolve("please take this", {}, { toAgentId: "k3v7d2mq" });
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
  });

  it("OVERRIDES a handle in the prose — the parameter is what the caller MEANT", async () => {
    projection(sessionRow({ name: "m8q1zzzz" }));
    const out = await resolve("@agent-m8q1zzzz fyi", {}, { toAgentId: "k3v7d2mq" });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });

  it("suppresses every resilience arm — an addressed post needs no repair", async () => {
    roomProjection(sessionRow({ name: "m8q1zzzz" }));
    const out = await resolve("hi", {}, { toAgentId: "k3v7d2mq" });
    expect(out.verdict).toBe("agent");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("is never `unreachable` — an unresolved `to` was refused at the door", async () => {
    const out = await resolve("go", {}, { toAgentId: "k3v7d2mq" });
    expect(out.delivery).toBe("woken");
  });
});
