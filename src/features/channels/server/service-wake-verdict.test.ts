import { beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * **AN AGENT IS NEVER A RECIPIENT OF ITS OWN POST** (2026-09-04, Samuel's report
 * from Mobile Command Center).
 *
 * ⚠ **THE DOOR IS THE OWN-SCOPE, WHICH IS OTHERWISE THE CARVE WORKING.** Both
 * agent doors resolve against the AUTHOR'S OWN fresh sessions — and the author's
 * own session is in that set. A session that wrote its own handle in prose (or,
 * after a rename, its own NAME) resolved to itself, the row stored
 * `recipient_agent_ids: [self]`, and the desktop executed the stored answer and
 * woke it on its own words. Three turns of a 1M-context session went that way in
 * one four-minute stretch, and the loop is unbounded — the reply it wakes for can
 * name the same handle again.
 *
 * ⚠ **`[]` AND `null` ARE STILL DIFFERENT ANSWERS AND THE DROP MUST NOT COLLAPSE
 * THEM.** A body that named ONLY the author resolved fine; it just named no
 * addressee, so the answer is `[]`. `null` would send the desktop to its own body
 * parse, which would resolve the same self-tag against its live ids and feed the
 * session its own post — the same defect, one layer down.
 */
describe("resolveWakeVerdict — the author's own session is never a recipient", () => {
  const SELF = { session_id: "chan-1::k3v7d2mq" };

  it("drops the author's own handle from the body parse — the #976 row", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve(
      "@anthony Hello — tag @agent-k3v7d2mq to be explicit.",
      SELF,
      { authorKind: "agent" }
    );
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.verdict).not.toBe("agent");
    expect(out.delivery).not.toBe("woken");
  });

  it("drops the author's own RENAME too — the #979 row, which carried no id", async () => {
    // The live case: the operator renamed the session "1", so `@1` was a real
    // handle in its OWN index — and the agent quoting `"@1"` in prose woke itself.
    projection(sessionRow({ name: "k3v7d2mq", display_name: "1" }));
    const out = await resolve('"@1" still resolves to nobody as a tag', SELF, {
      authorKind: "agent",
    });
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.verdict).not.toBe("agent");
  });

  it("answers `[]`, not `null` — the desktop must not re-resolve the self-tag", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq", SELF, { authorKind: "agent" });
    expect(out.recipientAgentIds).not.toBeNull();
  });

  it("still reaches the operator's OTHER agent — the drop is one identity, not a branch", async () => {
    projection(
      sessionRow({ name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "a1b2c3d4" })
    );
    const out = await resolve("@agent-k3v7d2mq @agent-a1b2c3d4 go", SELF, {
      authorKind: "agent",
    });
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["a1b2c3d4"],
      delivery: "woken",
    });
  });

  it("drops a `to=` that named the author itself", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("anything", SELF, {
      authorKind: "agent",
      toAgentId: "k3v7d2mq",
    });
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.verdict).not.toBe("agent");
  });

  it("leaves a PERSON's post alone — a member's session_id names no agent", async () => {
    // ⚠ A cookie session carries a `session_id` too, and a person is not an agent.
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq take this", SELF, {
      authorKind: "user",
    });
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["k3v7d2mq"],
    });
  });

  it("leaves an UNSTAMPED agent post alone — 'cannot say' is not 'the author'", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("@agent-k3v7d2mq take this", {}, {
      authorKind: "agent",
    });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });
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
