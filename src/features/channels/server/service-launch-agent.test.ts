/**
 * AGENT MANAGEMENT OVER MCP — `end` / `rename` directives (2026-09-01, Samuel's
 * ruling: *"dopl mcp being able to end agents. Dopl MCP need to be able to do all
 * that stuff"*).
 *
 * ⚠ **THE PROPERTIES THIS SUITE EXISTS FOR ARE THE TWO FENCES, AND THEY ARE NOT
 * THE SAME FENCE.**
 *
 *  1. **`operator_user_id` IS ALWAYS `ctx.userId`** — the structural one, and the
 *     entire cross-member story. A directive only ever asks the CALLER'S OWN
 *     machine, so "end an agent on somebody else's computer" has no spelling on
 *     this path. Driven adversarially below: no input field names an operator,
 *     and the stamp is a separate repository ARGUMENT.
 *  2. **A DEMONSTRABLY FOREIGN TARGET IS REFUSED EARLY** — the friendlier one,
 *     and it is deliberately weaker. `channel_sessions` is a projection the
 *     desktop pushes, so silence means nobody reported, never that an agent does
 *     not exist. It refuses only on a POSITIVE fact and otherwise proceeds. Both
 *     halves are cases here, because the second one is the one a future reader is
 *     most likely to mistake for the fence and then "harden" into a refusal that
 *     breaks every end of an agent whose machine had not pushed yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({ insertLaunchDirective: vi.fn() }));
// ⚠ THE MOCK MOVED TO THE PREDICATE ON 2026-09-02 (A9 / F-418). `refuseForeignTarget`
// now asks `agentIsAnotherMembers`, which bounds the projection row's AGE before it will
// say anything — the raw owner read is its detail, and mocking that would let this suite
// assert a refusal the freshness rule may no longer make.
vi.mock("./repository-agent-owner", () => ({ agentIsAnotherMembers: vi.fn() }));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
// ⚠ MOCKED THOUGH THIS FILE NAMES NO TEMPLATE: `service-launch-agent.ts` imports
// `operatorIsOnline` from `service-launch.ts`, which pulls the agent-templates
// barrel at module scope — `server-only`, with a live Supabase admin client under
// it. The same mock `service-launch.test.ts` carries, for the same reason.
vi.mock("@/features/agent-templates/server/service", () => ({
  resolveTemplateRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { agentIsAnotherMembers } from "./repository-agent-owner";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import {
  AgentDirectiveForeignError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import { createAgentDirective } from "./service-launch-agent";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const CHAN = "11111111-1111-1111-1111-111111111111";
const DIR = "55555555-5555-5555-5555-555555555555";
const AGENT = "a1b2c3d4";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

const CHANNEL_ROW = { id: CHAN, slug: "general", name: "General", visibility: "private" };
const MEMBERSHIP = { channel_id: CHAN, user_id: ME, role: "member" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    kind: "end",
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    goal: null,
    model: null,
    template_id: null,
    template_name: null,
    target_agent_id: AGENT,
    target_name: null,
    status: "pending",
    refusal_reason: null,
    agent_id: null,
    claimed_at: null,
    decided_at: null,
    expires_at: new Date(Date.now() + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  };
}

/** Online, and recently — the ordinary case. */
function online() {
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { lastSeenAt: new Date().toISOString(), online: true }]]) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: CHANNEL_ROW,
    membership: MEMBERSHIP,
  } as never);
  vi.mocked(agentIsAnotherMembers).mockResolvedValue(false);
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(row() as never);
  online();
});

describe("createAgentDirective — the operator stamp", () => {
  it("stamps ctx.userId, and the input type has no field that could say otherwise", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    // ⚠ THE STAMP IS THE FIRST ARGUMENT, NOT A KEY IN THE PAYLOAD — the whole
    // reason `LaunchDirectiveInsert` has no `operator_user_id` field. A caller
    // cannot smuggle one inside an object it built from a request body.
    const [operatorId, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
    expect(operatorId).toBe(ME);
    expect(insert).not.toHaveProperty("operator_user_id");
  });

  it("writes kind='end' with the target and NO name", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    const [, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
    expect(insert.kind).toBe("end");
    expect(insert.target_agent_id).toBe(AGENT);
    // ⚠ `null`, NOT ABSENT AND NOT ''. The column CHECK forbids a name on any kind
    // but `rename`, so an end that smuggled one is refused AT REST.
    expect(insert.target_name).toBeNull();
  });

  it("writes kind='rename' with the name, and '' survives as the CLEAR gesture", async () => {
    await createAgentDirective(ctx, {
      kind: "rename", channel: "general", agentId: AGENT, name: "Research",
    });
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].target_name)
      .toBe("Research");

    vi.mocked(launchRepo.insertLaunchDirective).mockClear();
    await createAgentDirective(ctx, {
      kind: "rename", channel: "general", agentId: AGENT, name: "",
    });
    // ⚠ **`""` MUST NOT COLLAPSE TO `null`.** Empty is how a caller CLEARS a
    // display name back to `Agent #<id>`; null means "this is not a rename". A
    // truthiness check anywhere on this path deletes the only gesture that undoes
    // a rename and reports success.
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].target_name).toBe("");
  });

  it("never stamps a thread — an agent is addressed as an INSTANCE", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    // `task_id` says where a LAUNCH should work. Stamping one here would invite a
    // reader to think an end is scoped to a thread; the instance id is the whole
    // address.
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].task_id).toBeNull();
  });
});

describe("createAgentDirective — the channel gate", () => {
  it("refuses a non-member of a channel it can otherwise READ, not-found-shaped", async () => {
    // ⚠ `loadVisibleChannel` ADMITS A NON-MEMBER TO A PUBLIC CHANNEL (§5), and
    // managing an agent is not a read. The refusal is NOT-FOUND-shaped on purpose:
    // to that caller this must look exactly like a private channel they cannot
    // see, which is the answer §5 gives everywhere else. A distinct "you may read
    // but not manage agents here" would be a new fact about the room.
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: CHANNEL_ROW, membership: null,
    } as never);
    await expect(
      createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });
});

describe("createAgentDirective — the cross-member refusal", () => {
  it("REFUSES a target another member is reporting, and files nothing", async () => {
    // ⚠ THE NAMED CASE THE BRIEF ASKS FOR. It is a 403 rather than the lane's
    // usual 404 (see `AgentDirectiveForeignError`): the caller has already proved
    // channel membership, inside which the roster and the live agent set are
    // readable anyway, so nothing is disclosed — while a 404 would tell an
    // orchestrator its OWN agent had vanished and send it to re-launch.
    vi.mocked(agentIsAnotherMembers).mockResolvedValue(true);
    await expect(
      createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT })
    ).rejects.toBeInstanceOf(AgentDirectiveForeignError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("refuses a foreign target on RENAME too — same fence, both verbs", async () => {
    vi.mocked(agentIsAnotherMembers).mockResolvedValue(true);
    await expect(
      createAgentDirective(ctx, {
        kind: "rename", channel: "general", agentId: AGENT, name: "Research",
      })
    ).rejects.toBeInstanceOf(AgentDirectiveForeignError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("scopes the ownership read to THIS workspace — it is not a deployment-wide oracle", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    expect(agentIsAnotherMembers).toHaveBeenCalledWith(WS, AGENT, ME);
  });

  it("PASSES a target the caller owns", async () => {
    vi.mocked(agentIsAnotherMembers).mockResolvedValue(false);
    const res = await createAgentDirective(ctx, {
      kind: "end", channel: "general", agentId: AGENT,
    });
    expect(res.offline).toBe(false);
    expect(launchRepo.insertLaunchDirective).toHaveBeenCalledOnce();
  });

  it("PASSES an UNREPORTED target — silence is not evidence, and refusing would break the feature",
    async () => {
      // ⚠ **THE CASE MOST WORTH READING BEFORE CHANGING THIS FILE.**
      // `channel_sessions` is a one-way projection the desktop pushes, so an
      // absent row means NOBODY SAID ANYTHING — not that no such agent exists. An
      // agent launched seconds ago is routinely in exactly this state. Refusing
      // here would fail closed on a check that was never the fence: the STRUCTURAL
      // fence is `operator_user_id`, and the machine that claims the row holds only
      // its own operator's sessions, so an unknown id is answered `no-session` by
      // the one party that actually knows.
      vi.mocked(agentIsAnotherMembers).mockResolvedValue(false);
      const res = await createAgentDirective(ctx, {
        kind: "end", channel: "general", agentId: AGENT,
      });
      expect(res.offline).toBe(false);
      expect(launchRepo.insertLaunchDirective).toHaveBeenCalledOnce();
    });

  it("checks ownership BEFORE presence — a foreign id is answerable with every machine asleep",
    async () => {
      // ⚠ THIS BREAKS THE CHEAPNESS ORDER ON PURPOSE, the same way the template
      // gate does one file over. `offline` is a 200 meaning "nothing was asked" and
      // is the ordinary answer for a closed laptop; answering a PEER'S AGENT ID
      // with "your machine is asleep" sends the caller to fix the wrong thing and
      // get the real refusal a minute later.
      vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
      vi.mocked(agentIsAnotherMembers).mockResolvedValue(true);
      await expect(
        createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT })
      ).rejects.toBeInstanceOf(AgentDirectiveForeignError);
    });
});

describe("createAgentDirective — presence", () => {
  it("files NOTHING when the operator's machine is not reporting in", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    const res = await createAgentDirective(ctx, {
      kind: "end", channel: "general", agentId: AGENT,
    });
    expect(res).toEqual({ offline: true, directive: null });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("reuses the LAUNCH TTL rather than minting a second liveness number", async () => {
    // ⚠ What is being waited on is identical — a claim by a machine that is either
    // listening or not — and a second TTL on ONE table is how two rows written a
    // second apart come to disagree about when they died.
    //
    // ⚠ **THE CLOCK IS FROZEN, AND `Date.now()` MUST NOT COME BACK HERE (F-454).**
    // This case used to take its own `Date.now()` and measure the delta. The
    // service takes a SECOND `Date.now()` after that one, so the delta is really
    // `TTL + (serviceNow − before)` — the lower bound had 5s of slack and the
    // upper bound had NONE, so a single elapsed millisecond failed it. It flaked
    // on machine SPEED, which is why CI saw it and a local run did not.
    // ⚠ **WIDENING THE UPPER BOUND IS NOT THE FIX** — slack there makes the
    // assertion blind to a second, LONGER TTL, which is the only thing this case
    // exists to forbid. Neither `createAgentDirective` nor `createLaunchDirective`
    // accepts an injectable `now` (F-454 assumed they did), so the clock is pinned
    // from outside and the expiry is asserted EXACTLY, on one bound rather than
    // two. Only `Date` is faked — the timer functions stay real so the awaits here
    // behave as they always did.
    const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    // ⚠ Presence is read through the SAME frozen clock, so it has to be re-stamped
    // under it — `beforeEach` stamped `lastSeenAt` with the real one, which reads
    // as decades stale from here and files nothing at all.
    online();
    try {
      await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
      const [, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
      expect(Date.parse(insert.expires_at)).toBe(NOW + LAUNCH_DIRECTIVE_TTL_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createAgentDirective — the DTO it answers with", () => {
  it("carries the kind and the target, so the caller can read back what it asked", async () => {
    const res = await createAgentDirective(ctx, {
      kind: "end", channel: "general", agentId: AGENT,
    });
    expect(res.offline).toBe(false);
    if (res.offline) throw new Error("unreachable");
    expect(res.directive.kind).toBe("end");
    expect(res.directive.targetAgentId).toBe(AGENT);
    // ⚠ `agentId` IS THE **OUTPUT** AND STAYS NULL HERE. Two fields because they
    // answer two questions — what this row aimed at, and what it produced — and a
    // table read back as a record of what was asked cannot afford to lose that.
    expect(res.directive.agentId).toBeNull();
  });

  it("survives a stale cached payload that predates the new columns", async () => {
    // ⚠ THE STALE-CACHE RULE (INVARIANTS): a new field on a cached payload needs a
    // fallback, or it renders as `undefined` in a sentence naming the agent to be
    // ended. `kind` falls back to `launch` — the branch that is fully gated — and
    // both targets to `null`.
    const stale = { ...row() } as Record<string, unknown>;
    delete stale.kind;
    delete stale.target_agent_id;
    delete stale.target_name;
    vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(stale as never);
    const res = await createAgentDirective(ctx, {
      kind: "end", channel: "general", agentId: AGENT,
    });
    if (res.offline) throw new Error("unreachable");
    expect(res.directive.kind).toBe("launch");
    expect(res.directive.targetAgentId).toBeNull();
    expect(res.directive.targetName).toBeNull();
  });
});
