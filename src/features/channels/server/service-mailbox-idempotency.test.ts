/**
 * **A RETRY MAY NOT QUEUE A SECOND AGENT** — G10, on both agent mailboxes
 * (2026-09-02, MCP/architecture v2 slice A10).
 *
 * ⚠ **WHAT THIS SUITE IS ACTUALLY FOR.** Until this wave the rule was a
 * SENTENCE: `channel-doctrine.ts` told the caller that a timed-out launch is
 * still pending and must not be re-issued because a second launch starts a
 * second agent on the same work — and nothing enforced it. A timeout is
 * indistinguishable from a lost response, so the instruction asked the caller to
 * accept an unknown outcome. These cases are the code that replaces it.
 *
 * The four properties, each of which fails silently and in a different
 * direction:
 *  1. **THE PROBE CONVERGES.** A repeated key returns the stored row and files
 *     nothing.
 *  2. **THE PROBE SITS ABOVE THE IDENTITY, THREAD AND PRESENCE GATES.** A retry
 *     of a request that already succeeded may not be re-decided against today's
 *     world — a since-deleted identity, or a laptop that has since closed, would
 *     otherwise answer "nothing was filed" about a directive that IS filed.
 *  3. **THE RACE IS REPAIRED.** Two retries arriving together both miss the
 *     probe; the partial unique index refuses the second insert and the loser
 *     converges rather than 500-ing.
 *  4. **A 23505 THAT IS NOT THIS KEY STILL THROWS.** Both tables carry other
 *     unique objects, and swallowing on the error code alone would turn an
 *     unrelated violation into a silent success with no row.
 *
 * ⚠ AND `existing` IS PART OF THE ANSWER, not bookkeeping: the MCP result
 * renders it as `retry=existing`, which is the only thing separating "your retry
 * was absorbed" from "a second agent was requested".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
// ⚠ THE FOREIGN-AGENT READ (2026-09-02, A9 / F-418). `createAgentDirection` now
// asks whether a FRESH projection row says the target belongs to another member —
// the only case a server can answer — so this suite has to say "no" or it reaches
// a live Supabase client. `false` is the ordinary answer: unknown, stale and quiet
// all still FILE, which is the whole of F-418's warning.
vi.mock("./repository-agent-owner", () => fx.mocks.agentOwner);
vi.mock("./repository-directions");
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as directionRepo from "./repository-directions";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { resolveIdentityRef } from "@/features/agent-identities/server/service";
import { loadVisibleChannel } from "./service-shared";
import { createLaunchDirective } from "./service-launch";
import { createAgentDirection } from "./service-directions";
import { AGENT_DIRECTION_TTL_MS } from "../constants";
import {
  CHAN,
  CHANNEL_ROW,
  DIR,
  ME,
  WS,
  ctx,
  row,
  wireLaunchDefaults,
} from "./service-launch-fixtures";

const AGENT = "k3wpf7c5";
const KEY = "orchestrator-run-7:launch-1";

const launchRow = (over: Record<string, unknown> = {}) => row({ client_msg_id: KEY, ...over });

function directionRow(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    agent_id: AGENT,
    sender_agent_id: null,
    body: "status?",
    status: "pending",
    refusal_reason: null,
    reply: null,
    claimed_at: null,
    decided_at: null,
    client_msg_id: KEY,
    expires_at: new Date(Date.now() + AGENT_DIRECTION_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  } as never;
}

/** A PostgREST unique violation, the shape `pgErrorCode` reads. */
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
  });

beforeEach(() => {
  wireLaunchDefaults();
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(launchRow());
  vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(null);
  vi.mocked(directionRepo.insertAgentDirection).mockResolvedValue(directionRow());
});

describe("launch_agent — the probe converges instead of filing a second directive", () => {
  it("no key means no probe and today's behaviour byte for byte", async () => {
    const result = await createLaunchDirective(ctx, { channel: "general", goal: "go" });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
    expect(launchRepo.insertLaunchDirective).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ offline: false, existing: false });
  });

  it("a key is written to the row, so the retry has something to find", async () => {
    await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(launchRepo.insertLaunchDirective).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({ client_msg_id: KEY })
    );
  });

  it("a repeated key returns the FIRST directive and files nothing", async () => {
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(
      launchRow({ status: "launched", agent_id: "abcd1234" })
    );
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
    expect(result).toMatchObject({ offline: false, existing: true });
    expect(result.directive?.id).toBe(DIR);
    // ⚠ THE PROBE IS OWN-SCOPED AND CHANNEL-SCOPED IN THE REPOSITORY, and the
    // arguments are the index: drop the operator and another member's key
    // answers, drop the channel and a key minted for one room converges onto a
    // directive filed in another.
    expect(launchRepo.findLaunchDirectiveByClientMsgId).toHaveBeenCalledWith(ME, CHAN, KEY);
  });

  it("a MEMBERSHIP row is still required — converging is still a read of that channel", async () => {
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: CHANNEL_ROW,
      membership: null,
    } as never);
    await expect(
      createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY })
    ).rejects.toThrow();
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
  });
});

describe("launch_agent — the probe sits ABOVE the gates a retry must not be re-judged by", () => {
  it("an OFFLINE machine does not turn a filed directive into `nothing was filed`", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(launchRow());
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    // ⚠ THE HAZARD INVERTED. `offline: true` says NOTHING WAS FILED, which is the
    // one answer most likely to make a caller retry — over a row that exists and
    // may already be running.
    expect(result).toMatchObject({ offline: false, existing: true });
  });

  it("an identity deleted since the first call does not refuse the retry", async () => {
    vi.mocked(resolveIdentityRef).mockResolvedValue({ kind: "not-found" } as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(
      launchRow({ identity_id: null, identity_name: "Code Auditor" })
    );
    const result = await createLaunchDirective(ctx, {
      channel: "general",
      identity: "Code Auditor",
      clientMsgId: KEY,
    });
    expect(resolveIdentityRef).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
  });

  it("a thread id is not re-validated either — the stored row already names one", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null as never);
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(launchRow());
    const result = await createLaunchDirective(ctx, {
      channel: "general",
      threadId: "44444444-4444-4444-4444-444444444444",
      clientMsgId: KEY,
    });
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
  });
});

describe("launch_agent — the race, where both probes miss", () => {
  it("a lost race converges on the winner rather than 500-ing", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(
      uniqueViolation("channel_launch_directives_client_msg_key")
    );
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(launchRow());
    const result = await createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY });
    expect(result).toMatchObject({ offline: false, existing: true });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).toHaveBeenCalledTimes(2);
  });

  it("a 23505 from SOME OTHER constraint still throws — no silent success with no row", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(
      uniqueViolation("channel_launch_directives_replica_identity_idx")
    );
    vi.mocked(launchRepo.findLaunchDirectiveByClientMsgId).mockResolvedValue(null);
    await expect(
      createLaunchDirective(ctx, { channel: "general", clientMsgId: KEY })
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a keyless call rethrows a 23505 untouched — there is nothing to converge on", async () => {
    vi.mocked(launchRepo.insertLaunchDirective).mockRejectedValue(uniqueViolation("whatever"));
    await expect(createLaunchDirective(ctx, { channel: "general" })).rejects.toMatchObject({
      code: "23505",
    });
    expect(launchRepo.findLaunchDirectiveByClientMsgId).not.toHaveBeenCalled();
  });
});

describe("direct_agent — the same rule, and the reply is what a converged retry collects", () => {
  it("no key means no probe", async () => {
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
    });
    expect(directionRepo.findAgentDirectionByClientMsgId).not.toHaveBeenCalled();
    expect(result).toMatchObject({ offline: false, existing: false });
  });

  it("a key is written to the row", async () => {
    await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(directionRepo.insertAgentDirection).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({ client_msg_id: KEY })
    );
  });

  it("a repeated key returns the stored direction, REPLY INCLUDED", async () => {
    // ⚠ THIS IS THE HALF THE LAUNCH LANE HAS NO EQUIVALENT OF. A direction's
    // answer is private and reaches the caller nowhere else — not through `read`,
    // not through `await` — so a converged retry is how a caller whose hold timed
    // out collects it, instead of asking a live agent the same thing twice.
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(
      directionRow({ status: "delivered", reply: "done, 3 files changed" })
    );
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(directionRepo.insertAgentDirection).not.toHaveBeenCalled();
    expect(result).toMatchObject({ existing: true });
    expect(result.direction?.reply).toBe("done, 3 files changed");
  });

  it("an OFFLINE machine does not turn a filed direction into `nothing was filed`", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId).mockResolvedValue(directionRow());
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(result).toMatchObject({ offline: false, existing: true });
  });

  it("a lost race converges on the winner", async () => {
    vi.mocked(directionRepo.insertAgentDirection).mockRejectedValue(
      uniqueViolation("channel_agent_directions_client_msg_key")
    );
    vi.mocked(directionRepo.findAgentDirectionByClientMsgId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(directionRow());
    const result = await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    expect(result).toMatchObject({ existing: true });
  });

  it("the key never becomes an identity — the operator is still a separate argument", async () => {
    await createAgentDirection(ctx, {
      channel: "general",
      agentId: AGENT,
      body: "status?",
      clientMsgId: KEY,
    });
    const [operator, body] = vi.mocked(directionRepo.insertAgentDirection).mock.calls[0];
    expect(operator).toBe(ME);
    expect(Object.keys(body)).not.toContain("operator_user_id");
  });
});
