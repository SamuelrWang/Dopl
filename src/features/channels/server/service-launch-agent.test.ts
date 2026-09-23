/**
 * `end` / `rename` directives, and their two fences:
 *  1. `operator_user_id` is always `ctx.userId` — the structural fence; no input field names an operator.
 *  2. A demonstrably foreign target is refused early — deliberately weaker: `channel_sessions` is a
 *     desktop-pushed projection, so silence never proves an agent does not exist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
// Mocked at the predicate, not the raw owner read: `agentIsAnotherMembers` also bounds the row's age (F-418).
vi.mock("./repository-agent-owner", () => fx.mocks.agentOwner);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import { agentIsAnotherMembers } from "./repository-agent-owner";
import { loadVisibleChannel } from "./service-shared";
import {
  AgentDirectiveForeignError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import { createAgentDirective } from "./service-launch-agent";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";
import { CHANNEL_ROW, ME, WS, ctx, online, row, wireLaunchDefaults } from "./service-launch-fixtures";

const AGENT = "a1b2c3d4";

/** A pending `end` directive aimed at {@link AGENT}. */
const endRow = (over: Record<string, unknown> = {}) =>
  row({ kind: "end", goal: null, target_agent_id: AGENT, ...over });

beforeEach(() => {
  wireLaunchDefaults();
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(endRow());
});

describe("createAgentDirective — the operator stamp", () => {
  it("stamps ctx.userId, and the input type has no field that could say otherwise", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    // The stamp is a separate argument, so a payload built from a request body cannot carry one.
    const [operatorId, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
    expect(operatorId).toBe(ME);
    expect(insert).not.toHaveProperty("operator_user_id");
  });

  it("writes kind='end' with the target and NO name", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    const [, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
    expect(insert.kind).toBe("end");
    expect(insert.target_agent_id).toBe(AGENT);
    // `null`, not absent or '': the column CHECK forbids a name on any kind but `rename`.
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
    // `""` clears the name back to `Agent #<id>`; `null` means "not a rename". A truthiness check would lose it.
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].target_name).toBe("");
  });

  it("never stamps a thread — an agent is addressed as an INSTANCE", async () => {
    await createAgentDirective(ctx, { kind: "end", channel: "general", agentId: AGENT });
    // `task_id` places a launch; an agent is addressed by its instance id alone.
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].task_id).toBeNull();
  });
});

describe("createAgentDirective — the channel gate", () => {
  it("refuses a non-member of a channel it can otherwise READ, not-found-shaped", async () => {
    // `loadVisibleChannel` admits a non-member to a public channel; the refusal must look like an invisible room.
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
    // 403, not 404: membership is proven, so nothing is disclosed, and a 404 would read as "your agent vanished".
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
      // An absent projection row means nobody reported, not that no agent exists; the claiming machine answers `no-session`.
      vi.mocked(agentIsAnotherMembers).mockResolvedValue(false);
      const res = await createAgentDirective(ctx, {
        kind: "end", channel: "general", agentId: AGENT,
      });
      expect(res.offline).toBe(false);
      expect(launchRepo.insertLaunchDirective).toHaveBeenCalledOnce();
    });

  it("checks ownership BEFORE presence — a foreign id is answerable with every machine asleep",
    async () => {
      // Ownership before presence: "your machine is asleep" for a peer's agent sends the caller to fix the wrong thing.
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
    // One TTL per table, or two rows written a second apart disagree about when they died.
    // The clock is frozen and the expiry asserted exactly: widening a bound would hide a longer TTL (F-454).
    const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    // Presence reads the frozen clock too, so it is re-stamped under it.
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
    // `agentId` is the output (what the row produced) and stays null; `targetAgentId` is what it aimed at.
    expect(res.directive.agentId).toBeNull();
  });

  it("survives a stale cached payload that predates the new columns", async () => {
    // Stale-cache rule (INVARIANTS): `kind` falls back to `launch`, both targets to `null`.
    const stale = endRow() as Record<string, unknown>;
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
