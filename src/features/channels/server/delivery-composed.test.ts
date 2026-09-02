import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { SessionStateRow } from "./collab-dto";
import { resolveWakeVerdict } from "./service-wake-verdict";
import type { ChannelContext } from "./service-shared";

vi.mock("./repository-sessions");

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

/** ⚠ THE REAL TIER MODULE AND THE REAL SLUG RULE, both pure — a stub of either would let this
 *  suite agree with itself about a rule the app does not run. Only the model call is faked. */
const wakeTiers = require_(path.join(MAIN, "session-wake-tiers.js"));
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
  ) => Promise<boolean>;
}

/** One desktop, with a live roster and a recorder for what it fed and what it acked. */
function machine(live: Session[]) {
  const fed: Array<{ agentId: string; wake: boolean }> = [];
  const acked: Array<[string, string, number, string, string, string]> = [];
  const api = new Function(
    "targeting", "sessionEngine", "io", "wakeTiers", "sessionTriage", "agentHandles",
    "deliveryAck", "diag",
    `${dispatchBlock()}\n return { feedLiveSession };`
  )(
    { firstClassTaskId: (m: { taskId?: string }) => m.taskId || "" },
    {
      liveOnThread: () => live,
      agentIdsInChannel: () => live.map((s) => s.agentId),
      feedInbound: (a: { agentId: string; wake: boolean }) => {
        fed.push({ agentId: a.agentId, wake: a.wake });
        return true;
      },
    },
    { displayNameFor: (id: string) => `name:${id}` },
    wakeTiers,
    { claim: async () => "" },
    agentHandles,
    {
      verdictFor: deliveryAck.verdictFor,
      // ⚠ The BUFFER is a recorder: it holds module state keyed by workspace, so a real one
      // would leak one case's receipts into the next. `delivery-ack.test.mjs` drives it.
      note: (...a: [string, string, number, string, string, string]) => { acked.push(a); return true; },
    },
    () => {}
  ) as Machine;
  wakeTiers.resetForTests();
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
 * ⚠ THE HAND-OFF IS THE SUBJECT, so it is spelled out rather than hidden in a helper: what
 * crosses is `recipientAgentIds`, and nothing else about addressing does.
 */
async function post(body: string, live: Session[], threaded = true) {
  const verdict = await resolveWakeVerdict(
    CTX,
    CHAN,
    { body, kind: "message" } as Parameters<typeof resolveWakeVerdict>[2],
    threaded ? { taskId: THREAD } : {},
    NOW
  );
  const desktop = machine(live);
  const row = {
    kind: "message",
    authorUserId: ME,
    authorKind: "user",
    body,
    taskId: threaded ? THREAD : "",
    seq: 42,
    recipientAgentIds: verdict.recipientAgentIds,
  };
  await desktop.feedLiveSession({ channel: { id: CHAN }, workspaceId: "ws-1" }, row, ME);
  return { verdict, desktop };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
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
    // ⚠ BOTH ARE FED — narrowing the fan-out is Samuel's ruling 4 and spec ruling B1, not this
    // slice's. What the verdict changes is WHO IT WAKES.
    expect(desktop.fed.map((f) => f.agentId).sort()).toEqual([A1, A2].sort());
    expect(desktop.fed.filter((f) => f.wake).map((f) => f.agentId)).toEqual([A1]);
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
    expect(desktop.fed).toEqual([{ agentId: A1, wake: false }]);
  });

  it("an UNRESOLVED handle falls back to the machine's own parse — nothing is silenced", async () => {
    // ⚠ THE CASE THAT MAKES THE WHOLE CHANGE SAFE. The projection is empty (a session pushed
    // nothing yet), so the server answers `null` and `delivery=unreachable`; the machine still
    // knows this agent and still wakes it. An `[]` here would have silenced a live agent.
    const { verdict, desktop } = await post(`@agent-${A1} urgent`, [
      agent(A1, { awaitingDirective: true }),
    ]);
    expect(verdict.recipientAgentIds).toBeNull();
    expect(verdict.delivery).toBe("unreachable");
    expect(desktop.fed).toEqual([{ agentId: A1, wake: true }]);
  });

  it("a dormant agent nobody named is fed nothing, and the machine says so", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow(A1),
      sessionRow(A2),
    ]);
    // Two agents in the room ⇒ no SOLO tier, and the triage router claims nobody.
    const { verdict, desktop } = await post("thinking out loud", [
      agent(A1, { awaitingDirective: true }),
      agent(A2, { awaitingDirective: true }),
    ]);
    expect(verdict.verdict).toBe("thread");
    expect(verdict.delivery).toBe("idle");
    expect(desktop.fed).toEqual([]);
    expect(desktop.acked[0]?.[3]).toBe("refused");
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
    expect(desktop.acked[0][3]).toBe("idle");
  });

  it("says NOTHING when nothing happened — no live session on the thread", async () => {
    const { desktop } = await post("hello", []);
    expect(desktop.acked).toEqual([]);
  });
});
