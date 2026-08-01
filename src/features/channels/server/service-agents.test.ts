/**
 * Unit tests for the channel-agents service: summon, list, rename, set status.
 *
 * The two rules this file exists to hold:
 *  1. **A handle is unique per channel, case-folded, and the DB is the arbiter.**
 *     The pool pick avoids taken handles, an explicit duplicate is a 409, and a
 *     pick that LOSES the unique-index race re-picks instead of failing — the
 *     read and the insert are not atomic and never will be.
 *  2. **Writing an agent is the OWNER's right, not the room's.** An agent is a
 *     member's process on a member's machine; a teammate renaming or parking it
 *     would be reaching into that machine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import { AGENT_NAME_POOL } from "./agent-names";
import {
  ChannelAgentForbiddenError,
  ChannelAgentNameConflictError,
  ChannelAgentNotFoundError,
  ChannelForbiddenError,
  ChannelNotFoundError,
} from "./errors";
import {
  createAgent,
  listAgents,
  renameAgent,
  setAgentStatus,
} from "./service-agents";
import type { ChannelAgentRow } from "./agents-dto";
import type { ChannelMemberRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const AGENT_ID = "33333333-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key value" };

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: USER,
    name: "quartz",
    status: "summoned",
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** The `name` handed to the Nth `insertAgent` call. */
function insertedName(nth = 0): string {
  return vi.mocked(repoAgents.insertAgent).mock.calls[nth][0].name;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
  vi.mocked(repo.pgErrorCode).mockImplementation(
    (err) => (err as { code?: string })?.code ?? null
  );
  vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([]);
  vi.mocked(repoAgents.insertAgent).mockImplementation(async (row) =>
    agentRow({ name: row.name, owner_user_id: row.owner_user_id })
  );
});

describe("createAgent — naming", () => {
  it("picks the first pool handle in an empty room and owns it to the caller", async () => {
    const agent = await createAgent(ctx, "room", {});

    expect(agent.name).toBe(AGENT_NAME_POOL[0]);
    expect(agent.ownerUserId).toBe(USER);
    const row = vi.mocked(repoAgents.insertAgent).mock.calls[0][0];
    expect(row.workspace_id).toBe(WS);
    expect(row.owner_user_id).toBe(USER);
  });

  it("skips handles already taken in the room — case-folded", async () => {
    // A SHOUTED stored handle cannot happen (the column CHECK is lowercase),
    // but the fold is what the unique index does, so the pick must do it too.
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ name: AGENT_NAME_POOL[0].toUpperCase() }),
      agentRow({ name: AGENT_NAME_POOL[1] }),
    ]);

    const agent = await createAgent(ctx, "room", {});

    expect(agent.name).toBe(AGENT_NAME_POOL[2]);
  });

  it("counts a DISMISSED agent's handle as taken (its messages keep their attribution)", async () => {
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ name: AGENT_NAME_POOL[0], status: "dismissed" }),
    ]);

    const agent = await createAgent(ctx, "room", {});

    expect(agent.name).toBe(AGENT_NAME_POOL[1]);
  });

  it("RE-PICKS when a pool handle loses the unique-index race", async () => {
    vi.mocked(repoAgents.insertAgent)
      .mockRejectedValueOnce(UNIQUE_VIOLATION)
      .mockImplementationOnce(async (row) => agentRow({ name: row.name }));

    const agent = await createAgent(ctx, "room", {});

    expect(insertedName(0)).toBe(AGENT_NAME_POOL[0]);
    // The winner took our candidate, so it is genuinely taken now.
    expect(insertedName(1)).toBe(AGENT_NAME_POOL[1]);
    expect(agent.name).toBe(AGENT_NAME_POOL[1]);
  });

  it("gives up (rethrowing the conflict) rather than spinning forever", async () => {
    vi.mocked(repoAgents.insertAgent).mockRejectedValue(UNIQUE_VIOLATION);

    await expect(createAgent(ctx, "room", {})).rejects.toBe(UNIQUE_VIOLATION);
    expect(repoAgents.insertAgent).toHaveBeenCalledTimes(3);
  });

  it("never swallows a non-conflict error from the insert", async () => {
    const boom = { code: "23514", message: "check constraint" };
    vi.mocked(repoAgents.insertAgent).mockRejectedValue(boom);

    await expect(createAgent(ctx, "room", {})).rejects.toBe(boom);
    expect(repoAgents.insertAgent).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit name as given", async () => {
    const agent = await createAgent(ctx, "room", { name: "atlas" });

    expect(insertedName()).toBe("atlas");
    expect(agent.name).toBe("atlas");
  });

  it("409s on an explicit name already held in the room", async () => {
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ name: "atlas" }),
    ]);

    await expect(createAgent(ctx, "room", { name: "atlas" })).rejects.toThrow(
      ChannelAgentNameConflictError
    );
    // Refused before the write — a caller who asked for `atlas` must never be
    // handed a different handle and go on to @-address the wrong agent.
    expect(repoAgents.insertAgent).not.toHaveBeenCalled();
  });

  it("409s when the INDEX rejects an explicit name the roster read missed", async () => {
    vi.mocked(repoAgents.insertAgent).mockRejectedValue(UNIQUE_VIOLATION);

    await expect(createAgent(ctx, "room", { name: "atlas" })).rejects.toThrow(
      ChannelAgentNameConflictError
    );
    // One attempt: an explicit name is never silently substituted.
    expect(repoAgents.insertAgent).toHaveBeenCalledTimes(1);
  });
});

describe("createAgent — authorization", () => {
  it("refuses a non-member of a public channel (readable is not summonable)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(createAgent(ctx, "room", {})).rejects.toThrow(
      ChannelForbiddenError
    );
  });

  it("reads a PRIVATE channel the caller is not in as not-found (no existence leak)", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(createAgent(ctx, "room", {})).rejects.toThrow(
      ChannelNotFoundError
    );
  });
});

describe("listAgents", () => {
  it("returns the whole roster, mapped, for anyone who can read the room", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ name: "quartz" }),
      agentRow({ name: "onyx", owner_user_id: PEER, status: "active" }),
    ]);

    const agents = await listAgents(ctx, "room");

    // A peer has to SEE a handle before they can @-address it, so the roster is
    // channel-wide and includes other members' agents.
    expect(agents.map((a) => a.name)).toEqual(["quartz", "onyx"]);
    expect(agents[1].ownerUserId).toBe(PEER);
  });

  it("leaks nothing about a private channel the caller cannot read", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(listAgents(ctx, "room")).rejects.toThrow(ChannelNotFoundError);
    expect(repoAgents.listAgentsByChannel).not.toHaveBeenCalled();
  });
});

describe("renameAgent / setAgentStatus — owner only", () => {
  beforeEach(() => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
    vi.mocked(repoAgents.updateAgentName).mockResolvedValue(
      agentRow({ name: "cobalt" })
    );
    vi.mocked(repoAgents.updateAgentStatus).mockResolvedValue(
      agentRow({ status: "parked" })
    );
  });

  it("renames the caller's own agent", async () => {
    const agent = await renameAgent(ctx, "room", AGENT_ID, "cobalt");

    expect(repoAgents.updateAgentName).toHaveBeenCalledWith(AGENT_ID, "cobalt");
    expect(agent.name).toBe("cobalt");
  });

  it("409s when the new handle is taken (the repo's null verdict)", async () => {
    vi.mocked(repoAgents.updateAgentName).mockResolvedValue(null);

    await expect(
      renameAgent(ctx, "room", AGENT_ID, "cobalt")
    ).rejects.toThrow(ChannelAgentNameConflictError);
  });

  it("403s a member renaming ANOTHER member's agent", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: PEER })
    );

    await expect(
      renameAgent(ctx, "room", AGENT_ID, "cobalt")
    ).rejects.toThrow(ChannelAgentForbiddenError);
    expect(repoAgents.updateAgentName).not.toHaveBeenCalled();
  });

  it("parks the caller's own agent", async () => {
    const agent = await setAgentStatus(ctx, "room", AGENT_ID, "parked");

    expect(repoAgents.updateAgentStatus).toHaveBeenCalledWith(
      AGENT_ID,
      "parked"
    );
    expect(agent.status).toBe("parked");
  });

  it("403s a member parking ANOTHER member's agent", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: PEER })
    );

    await expect(
      setAgentStatus(ctx, "room", AGENT_ID, "parked")
    ).rejects.toThrow(ChannelAgentForbiddenError);
    expect(repoAgents.updateAgentStatus).not.toHaveBeenCalled();
  });

  it("DISMISS is a status, never a delete — the row survives for attribution", async () => {
    vi.mocked(repoAgents.updateAgentStatus).mockResolvedValue(
      agentRow({ status: "dismissed" })
    );

    const agent = await setAgentStatus(ctx, "room", AGENT_ID, "dismissed");

    expect(agent.status).toBe("dismissed");
    expect(agent.id).toBe(AGENT_ID);
  });

  it("404s an agent id that names no row", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(null);

    await expect(
      renameAgent(ctx, "room", AGENT_ID, "cobalt")
    ).rejects.toThrow(ChannelAgentNotFoundError);
  });

  it("404s an agent of ANOTHER channel (an id can't be probed across rooms)", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ channel_id: "chan-other" })
    );

    await expect(
      setAgentStatus(ctx, "room", AGENT_ID, "parked")
    ).rejects.toThrow(ChannelAgentNotFoundError);
  });
});
