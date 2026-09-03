import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { SessionStateRow } from "./collab-dto";
import { resolveWakeVerdict } from "./service-wake-verdict";
import type { ChannelContext } from "./service-shared";
import type { ChannelRow } from "./dto";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");

import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";

/**
 * 🔒 **THE SERVER'S VERDICT AND THE DESKTOP'S EXECUTION, DRIVEN TOGETHER.**
 *
 * ⚠ **THIS IS THE SHAPE GAP C ASKED FOR, AND THE REASON IS ITS OWN HISTORY**: two defects, one
 * on each side of a seam, hid each other, and only a test that drove BOTH ends caught them.
 * Here the two ends are a server that decides who a message is for and a machine that executes
 * that decision — and every failure this slice can have lives exactly between them:
 *   • the server answers `[]` where it should answer "not resolved", and the machine stops
 *     feeding an agent it can see;
 *   • the machine reads the field with `||` instead of `??`, and re-derives an answer it was
 *     given;
 *   • the two disagree about what an `@` handle IS, and every unit test on both sides passes.
 *
 * ⚠ **IT READS THE DESKTOP FILE; IT DOES NOT IMPORT IT.** `src/**` may not depend on
 * `dopl-desktop-app/**` — the two ship on different cadences — so the routing block is SLICED
 * and evaluated, exactly as `lib/agent-handle-parity.test.ts` does for the handle rule. A
 * `require` sneaking into that block throws here, which is the block's own contract.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..");
const MAIN = path.join(REPO_ROOT, "dopl-desktop-app", "main");
const require_ = createRequire(import.meta.url);

const DISPATCH_SRC = readFileSync(path.join(MAIN, "session-dispatch.js"), "utf8");

function dispatchBlock(): string {
  const from = DISPATCH_SRC.indexOf("// ─── BEGIN SESSION-DISPATCH-PURE");
  const to = DISPATCH_SRC.indexOf("// ─── END SESSION-DISPATCH-PURE");
  expect(from, "the desktop's BEGIN sentinel is gone").toBeGreaterThan(-1);
  expect(to, "the desktop's END sentinel is gone").toBeGreaterThan(from);
  return DISPATCH_SRC.slice(from, to);
}

/** ⚠ THE REAL SLUG RULE, pure — a stub would let this suite agree with itself about a rule the
 *  app does not run. ⚠ **NOTHING ELSE IS INJECTED ANY MORE (2026-09-02, B9):** the tier module and
 *  the triage model call were the two things standing between "who is this message for" and "who
 *  is live here", and both are deleted. The machine reads the answer off the row this same test
 *  just had the server write, which is the whole point of driving the two ends together. */
const agentHandles = require_(path.join(MAIN, "agent-handles.js"));
// ⚠ THE REAL RECEIPT VOCABULARY. `delivery-ack.js › verdictFor` is pure and is the ONE place
// the four outcome words are ordered — a stub would let this suite assert a word the machine
// does not produce, which is the whole thing a composed drive exists to prevent.
const deliveryAck = require_(path.join(MAIN, "delivery-ack.js"));

type Session = { agentId: string; ownPostIds: Set<string>; awaitingDirective?: boolean };

interface Machine {
  feedLiveSession: (
    entry: unknown,
    m: Record<string, unknown>,
    myUserId: string
  ) => boolean;
}

/** One desktop, with a live roster and a recorder for what it fed and what it acked. */
function machine(live: Session[]) {
  const fed: Array<{ agentId: string; wake: boolean }> = [];
  const acked: Array<[string, string, number, string, string, string]> = [];
  const api = new Function(
    "targeting", "sessionEngine", "io", "agentHandles", "deliveryAck", "diag",
    `${dispatchBlock()}\n return { feedLiveSession };`
  )(
    { firstClassTaskId: (m: { taskId?: string }) => m.taskId || "" },
    {
      liveOnThread: () => live,
      feedInbound: (a: { agentId: string; wake: boolean }) => {
        fed.push({ agentId: a.agentId, wake: a.wake });
        return true;
      },
    },
    { displayNameFor: (id: string) => `name:${id}` },
    agentHandles,
    {
      verdictFor: deliveryAck.verdictFor,
      // ⚠ The BUFFER is a recorder: it holds module state keyed by workspace, so a real one
      // would leak one case's receipts into the next. `delivery-ack.test.mjs` drives it.
      note: (...a: [string, string, number, string, string, string]) => { acked.push(a); return true; },
    },
    () => {}
  ) as Machine;
  return { ...api, fed, acked };
}

const NOW = Date.parse("2026-09-02T12:00:00Z");
const CHAN = "chan-1";
const THREAD = "11111111-2222-4333-8444-555555555555";
const ME = "user-1";
const CTX: ChannelContext = { userId: ME, workspaceId: "ws-1" } as ChannelContext;
const A1 = "a1b2c3d4";
const A2 = "z9y8x7w6";

function sessionRow(name: string, displayName: string | null = null): SessionStateRow {
  return {
    id: `s-${name}`,
    channel_id: CHAN,
    workspace_id: "ws-1",
    user_id: ME,
    session_key: `${CHAN}:${THREAD}:${name}`,
    task_id: THREAD,
    name,
    state: "working",
    display_name: displayName,
    updated_at: new Date(NOW - 1_000).toISOString(),
    created_at: new Date(NOW).toISOString(),
  } as SessionStateRow;
}

// ⚠ `key` IS PART OF THE FIXTURE BECAUSE THE RECEIPT NAMES IT (2026-09-02, review D3) and the
// server's ack fence checks it against this machine's own live set. `session-store.js ›
// sessionKey`'s three-part shape, carried — not composed inside the dispatch.
const agent = (id: string, over: Partial<Session> = {}): Session => ({
  agentId: id,
  key: `${CHAN}::${id}`,
  ownPostIds: new Set<string>(),
  ...over,
} as Session);

/**
 * ONE POST, END TO END: the server resolves it, the row is written as the server would write
 * it, and the machine is handed exactly that row.
 *
 * ⚠ THE HAND-OFF IS THE SUBJECT, so it is spelled out rather than hidden in a helper. ⚠ **ALL
 * THREE COLUMNS CROSS SINCE 2026-09-02 (B9)** — `wakeVerdict` says WHICH rule resolved the
 * message, `recipientAgentIds` names the agents and `recipientUserIds` the members. The machine
 * executes them and re-derives nothing; before the narrowing only the agent half crossed, because
 * only a wake depended on it.
 */
async function post(
  body: string,
  live: Session[],
  threaded = true,
  // ⚠ THE WRITE-PATH FACTS THE FOLD DOES NOT CARRY (2026-09-02, B4): the author
  // kind (RR2 vs RR3), an agent `to=` already resolved at the door, and the
  // thread pair RR1 reads. Defaulted to "a person, addressing nobody", which is
  // what every case below except the resilience ones is about.
  // ⚠ `author` SPLITS THE TWO ENDS APART, and the RR1 case is why it had to (2026-09-02, B9).
  // Every case above is the author's OWN machine, so one id served as the server's context, the
  // row's author and the desktop's operator. A repaired MEMBER address is the one shape where
  // that collapse hides the answer: the recipient is the party who did NOT write it, so proving
  // that a message addressed to me reaches my sessions needs somebody else to have written it.
  over: {
    metadata?: Record<string, unknown>;
    authorKind?: string;
    author?: string;
    toAgentId?: string | null;
    clientMsgId?: string;
    channel?: Partial<ChannelRow>;
  } = {}
) {
  const author = over.author ?? ME;
  const verdict = await resolveWakeVerdict(
    { ...CTX, userId: author } as ChannelContext,
    { id: CHAN, workspace_id: "ws-1", ...over.channel } as ChannelRow,
    {
      body,
      kind: "message",
      clientMsgId: over.clientMsgId,
    } as Parameters<typeof resolveWakeVerdict>[2],
    { ...(threaded ? { taskId: THREAD } : {}), ...over.metadata },
    { authorKind: over.authorKind ?? "user", toAgentId: over.toAgentId ?? null },
    NOW
  );
  const desktop = machine(live);
  const row = {
    kind: "message",
    authorUserId: author,
    authorKind: over.authorKind ?? "user",
    body,
    taskId: threaded ? THREAD : "",
    seq: 42,
    wakeVerdict: verdict.verdict,
    recipientUserIds: verdict.recipientUserIds,
    recipientAgentIds: verdict.recipientAgentIds,
  };
  desktop.feedLiveSession({ channel: { id: CHAN }, workspaceId: "ws-1" }, row, ME);
  return { verdict, desktop };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repoMessages.findLastRoomAddressToAgent).mockResolvedValue(null);
});

describe("the server decides, the machine executes", () => {
  it("a resolved `@agent-<id>` wakes exactly that agent, and only it", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow(A1),
      sessionRow(A2),
    ]);
    const { verdict, desktop } = await post(`@agent-${A1} take this`, [
      agent(A1),
      agent(A2),
    ]);
    expect(verdict.verdict).toBe("agent");
    expect(verdict.delivery).toBe("woken");
    // 🔒 **ONLY THE ADDRESSEE IS FED (ruling B1).** This case asserted `[A1, A2]` until the
    // desktop narrowed: the sibling used to be DELIVERED the message and told, in a 330-character
    // preamble, to stand down. It is not fed at all now.
    expect(desktop.fed).toEqual([{ agentId: A1, wake: true }]);
  });

  it("a resolved SLUG reaches the renamed agent — one handle rule, two trees", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow(A1, "Research Bot"),
    ]);
    const { verdict, desktop } = await post("@research-bot go", [agent(A1)]);
    expect(verdict.recipientAgentIds).toEqual([A1]);
    expect(desktop.fed).toEqual([{ agentId: A1, wake: true }]);
  });

  it("the server's EMPTY answer is executed, not re-derived", async () => {
    // ⚠ THE `??` vs `||` CASE. The body carries a handle-shaped token the server resolved to
    // nobody by design (it is a MEMBER tag, not an agent one), so `[]` is a complete answer.
    // A machine reading it with `||` would fall through to its own parse and could wake an
    // agent the server said nothing about.
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { verdict, desktop } = await post("morning all", [agent(A1)]);
    expect(verdict.recipientAgentIds).toEqual([]);
    // ⚠ THE VERDICT IS `thread` — a threaded post naming nobody reaches the sessions already
    // working that thread and wakes none of them. That is a delivery the machine EXECUTES, not
    // one it inferred from an empty array.
    expect(verdict.verdict).toBe("thread");
    expect(desktop.fed).toEqual([{ agentId: A1, wake: false }]);
  });

  it("RR3 repairs a forgotten `@` and the machine wakes exactly the responder", async () => {
    // 🔒 **THE ARM THE FAN-OUT NARROWING DEPENDS ON.** A person says something in
    // the main room and names nobody; two agents are live; the channel nominates
    // one. The server stores that repair, and the machine wakes THAT agent and
    // not its sibling — which is the behaviour `b-fanout-narrow` will make the
    // only one, and is already the only WAKE today.
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow(A1),
      sessionRow(A2),
    ]);
    const { verdict, desktop } = await post("can someone look at the build?", [
      agent(A1),
      agent(A2),
    ], false, { channel: { default_responder_agent_name: `agent-${A2}` } });
    expect(verdict.verdict).toBe("responder");
    expect(verdict.recipientAgentIds).toEqual([A2]);
    expect(verdict.delivery).toBe("woken");
    // 🔒 **THE REPAIR IS THE WHOLE DELIVERY.** The body names nobody, so a machine that parsed it
    // would feed nobody; the nominee is fed and woken, and its sibling hears nothing.
    expect(desktop.fed).toEqual([{ agentId: A2, wake: true }]);
  });

  it("RR1 repairs a threaded reply to a MEMBER, and wakes no agent at all", async () => {
    // 🔒 **THE ARM THE MACHINE ROUTES ON `recipientUserIds`.** The repair is a
    // PERSON's id, so `recipientAgentIds` is `[]` — a complete answer, not a null
    // — and the recipient is a PEER (`user-2`), whose side decides what runs. This
    // machine is the AUTHOR's, so it feeds nothing at all: no cross-account wake,
    // and no cross-account delivery either.
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { verdict, desktop } = await post("what about the migration?", [agent(A1)], true, {
      metadata: { taskCreatedBy: ME, taskTarget: "user-2" },
    });
    expect(verdict.verdict).toBe("thread_peer");
    expect(verdict.recipientUserIds).toEqual(["user-2"]);
    expect(verdict.recipientAgentIds).toEqual([]);
    expect(desktop.fed).toEqual([]);
    expect(desktop.acked).toEqual([]);
  });

  it("RR1 addressed to ME reaches my own live sessions, and wakes none of them", async () => {
    // The mirror of the case above, and the reason `member`/`thread_peer`/`reciprocal` share one
    // arm: a MEMBER recipient is not an agent address. My agents on the thread hear it as context;
    // what runs is my decision, taken on the consent lane (`targeting.classify`), not here.
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { verdict, desktop } = await post("and the other one?", [agent(A1), agent(A2)], true, {
      author: "user-2",
      metadata: { taskCreatedBy: "user-2", taskTarget: ME },
    });
    expect(verdict.verdict).toBe("thread_peer");
    expect(verdict.recipientUserIds).toEqual([ME]);
    expect(desktop.fed).toEqual([
      { agentId: A1, wake: false },
      { agentId: A2, wake: false },
    ]);
  });

  it("an UNRESOLVED handle falls back to the machine's own parse — nothing is silenced", async () => {
    // ⚠ THE CASE THAT MAKES THE WHOLE CHANGE SAFE. The projection is empty (a session pushed
    // nothing yet), so the server answers `null` and `delivery=unreachable`; the machine still
    // knows this agent and still wakes it. An `[]` here would have silenced a live agent.
    const { verdict, desktop } = await post(`@agent-${A1} urgent`, [
      agent(A1, { awaitingDirective: true }),
      agent(A2),
    ]);
    expect(verdict.recipientAgentIds).toBeNull();
    expect(verdict.delivery).toBe("unreachable");
    // ⚠ AND THE PARSE NARROWS EXACTLY AS A VERDICT DOES: the fallback answers the AGENT half only.
    // The verdict still routes the rest, so the sibling is not swept in with it.
    expect(desktop.fed).toEqual([{ agentId: A1, wake: true }]);
  });

  it("a dormant agent nobody named is fed nothing, and the machine says so", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow(A1),
      sessionRow(A2),
    ]);
    // ⚠ NO LOCAL TIER DECIDES THIS ANY MORE. Two dormant agents on a thread the post named
    // nobody in: the verdict reaches them and wakes neither, so both are HELD and the machine
    // reports what it declined rather than an absence.
    const { verdict, desktop } = await post("thinking out loud", [
      agent(A1, { awaitingDirective: true }),
      agent(A2, { awaitingDirective: true }),
    ]);
    expect(verdict.verdict).toBe("thread");
    expect(verdict.delivery).toBe("idle");
    expect(desktop.fed).toEqual([]);
    expect(desktop.acked[0]?.[3]).toBe("refused");
  });

  it("🔒 MUTATION: feeding a session the verdict did not name FAILS this suite", async () => {
    // ⚠ THE CASE THAT MAKES THE REST OF THE FILE WORTH HAVING. Every assertion above says which
    // sessions were fed; this one says the same thing about the shape of the change — a desktop
    // that widened `planFor` back toward the fan-out (dropping the `!named && !plan.context`
    // skip, say) feeds A2 here and every narrowed case above goes red with it.
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow(A1), sessionRow(A2)]);
    const { desktop } = await post(`@agent-${A1} only you`, [agent(A1), agent(A2)]);
    expect(desktop.fed.map((f) => f.agentId)).not.toContain(A2);
    expect(desktop.acked.map((a) => a[5])).toEqual([`${CHAN}::${A1}`]);
  });
});

describe("the receipt says what the machine actually did", () => {
  it("reports `woken` for a wake, against the seq the server stored", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { desktop } = await post(`@agent-${A1} go`, [
      agent(A1, { awaitingDirective: true }),
    ]);
    // ⚠ THE SIXTH ELEMENT IS THE FENCE, not decoration: `service-writes-delivery.ts` skips a
    // receipt whose session key is not in this machine's own live set, so a dispatch that filed
    // an unkeyed one would look right here and land nothing.
    expect(desktop.acked).toEqual([["ws-1", CHAN, 42, "woken", ME, `${CHAN}::${A1}`]]);
  });

  it("reports `delivered` when the named agent was ALREADY running", async () => {
    // ⚠ A different fact from `woken`, and an orchestrator acts on it differently: nothing was
    // started, the turn is queued behind whatever that agent is doing.
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { desktop } = await post(`@agent-${A1} go`, [agent(A1)]);
    expect(desktop.acked[0][3]).toBe("delivered");
  });

  it("reports `idle` for a thread post that reached running sessions and named none", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([sessionRow(A1)]);
    const { desktop } = await post("status?", [agent(A1), agent(A2)]);
    // ⚠ ONE RECEIPT PER FED SESSION SINCE B9, each carrying that session's own outcome; the
    // BUFFER collapses them to one per (operator, channel, seq) and only ever strengthens.
    expect(desktop.acked.map((a) => a[3])).toEqual(["idle", "idle"]);
  });

  it("says NOTHING when nothing happened — no live session on the thread", async () => {
    const { desktop } = await post("hello", []);
    expect(desktop.acked).toEqual([]);
  });
});
