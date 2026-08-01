/**
 * MULTI-ADDRESS — "@quartz @onyx work together" — driven through `postMessage`.
 *
 * Addressing used to be scalar, so a message could name exactly one agent and a
 * request that needed two was two messages (or one that quietly reached one).
 * `toAgents` makes the address a LIST. What this file pins:
 *
 *  - **The array is the address; the scalar is a MIRROR.** `metadata.to_agent_ids`
 *    carries every resolved agent in the caller's order, and
 *    `metadata.to_agent_id` + the owner bridge's `metadata.to_user_id` restate
 *    its HEAD. That mirror is load-bearing, not redundant: installed desktop
 *    1.7.17 reads only the two scalars, so without them a multi-address routes
 *    to nobody on every machine in the field today.
 *  - **`toAgent` (singular) is exactly a one-element `toAgents`** — asserted by
 *    comparing the two stamped metadata objects, not by inspection.
 *  - **ALL OR NOTHING.** A ref that names no agent of this channel, or one whose
 *    owner has left the room, fails the WHOLE post naming that ref. A partial
 *    address is the invisible-delivery failure the addressing contract exists to
 *    prevent: the caller believes three machines are working and two are.
 *  - **The membership check covers EVERY addressed owner, not just the head.**
 *    `channel_agents` has no FK to `channel_members`, so an agent outlives its
 *    owner's membership; a check on the head alone would let a departed member
 *    ride along inside `to_agent_ids`, where a listener that reads the array
 *    routes to a machine that can no longer see the room.
 *  - **Dedupe runs twice** — on the raw refs (case-folded, so `@Quartz @quartz`
 *    is one lookup) and on the RESOLVED ids (so an id and a handle naming one
 *    agent are one address).
 *  - `to_agent_ids` is RESERVED like every other stamped key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import { MAX_ADDRESSED_AGENTS } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentNotInChannelError,
  ChannelTooManyAgentsError,
} from "./errors";
import { postMessage } from "./service-writes";
import type { ChannelAgentRow } from "./agents-dto";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const QUARTZ = "44444444-e29b-41d4-a716-446655440000";
const ONYX = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

/** A GROUP channel: no DM auto-address in the way, so every stamp is the bridge. */
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

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: QUARTZ,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: PEER,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** `quartz` (owned by PEER) and `onyx` (owned by THIRD), both in this room. */
const AGENTS: Record<string, ChannelAgentRow> = {
  quartz: agentRow(),
  onyx: agentRow({ id: ONYX, name: "onyx", owner_user_id: THIRD }),
};

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 77,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
  };
}

function capturedMetadata(nth = 0): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[nth][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER || userId === THIRD
      ? memberRow(userId)
      : null
  );
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoAgents.markAgentsEngaged).mockResolvedValue(undefined);
  vi.mocked(repoAgents.findAgentByName).mockImplementation(
    async (_channelId, name) => AGENTS[name.toLowerCase()] ?? null
  );
  vi.mocked(repoAgents.findAgentById).mockImplementation(
    async (id) =>
      Object.values(AGENTS).find((agent) => agent.id === id) ?? null
  );
});

describe("postMessage — toAgents stamps the whole set", () => {
  it("stamps to_agent_ids in the caller's order", async () => {
    await postMessage(ctx, "room", {
      body: "@quartz @onyx work together",
      toAgents: ["quartz", "onyx"],
    });

    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ, ONYX]);
  });

  /**
   * THE COMPAT MIRROR. Installed desktop 1.7.17 reads `metadata.to_agent_id`
   * and `metadata.to_user_id` and nothing else, so a multi-address has to keep
   * saying something those builds can route. Both mirror the HEAD of the list.
   */
  it("mirrors the HEAD into to_agent_id and the owner bridge", async () => {
    await postMessage(ctx, "room", {
      body: "work together",
      toAgents: ["quartz", "onyx"],
    });

    const meta = capturedMetadata();
    expect(meta.to_agent_id).toBe(QUARTZ);
    expect(meta.to_user_id).toBe(PEER);
  });

  it("mirrors the head the caller chose, not a sorted one", async () => {
    await postMessage(ctx, "room", {
      body: "work together",
      toAgents: ["onyx", "quartz"],
    });

    const meta = capturedMetadata();
    expect(meta.to_agent_ids).toEqual([ONYX, QUARTZ]);
    expect(meta.to_agent_id).toBe(ONYX);
    expect(meta.to_user_id).toBe(THIRD);
  });

  it("resolves ids and handles interchangeably", async () => {
    await postMessage(ctx, "room", {
      body: "go",
      toAgents: [QUARTZ, "onyx"],
    });

    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ, ONYX]);
  });

  it("stamps NOTHING when no agent is addressed", async () => {
    await postMessage(ctx, "room", { body: "just talking" });

    const meta = capturedMetadata();
    expect(has(meta, "to_agent_ids")).toBe(false);
    expect(has(meta, "to_agent_id")).toBe(false);
  });

  it("treats an empty array as no address at all", async () => {
    await postMessage(ctx, "room", { body: "just talking", toAgents: [] });

    expect(has(capturedMetadata(), "to_agent_ids")).toBe(false);
  });
});

describe("postMessage — toAgent is a one-element toAgents", () => {
  it("produces byte-identical metadata either way", async () => {
    await postMessage(ctx, "room", { body: "go", toAgent: "quartz" });
    await postMessage(ctx, "room", { body: "go", toAgents: ["quartz"] });

    expect(capturedMetadata(0)).toEqual(capturedMetadata(1));
    expect(capturedMetadata(0)).toEqual({
      to_agent_ids: [QUARTZ],
      to_agent_id: QUARTZ,
      to_user_id: PEER,
    });
  });

  it("merges the singular in FRONT of the list", async () => {
    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "onyx",
      toAgents: ["quartz"],
    });

    expect(capturedMetadata().to_agent_ids).toEqual([ONYX, QUARTZ]);
  });
});

describe("postMessage — dedupe", () => {
  it("collapses a repeated handle, case-folded, into ONE lookup", async () => {
    await postMessage(ctx, "room", {
      body: "go",
      toAgents: ["quartz", "Quartz", "QUARTZ"],
    });

    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ]);
    expect(repoAgents.findAgentByName).toHaveBeenCalledTimes(1);
  });

  it("collapses an id and a handle that name the SAME agent", async () => {
    await postMessage(ctx, "room", {
      body: "go",
      toAgents: [QUARTZ, "quartz"],
    });

    // Both refs resolve — they are different strings — but they are one address.
    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ]);
  });

  it("keeps the singular from double-counting its own entry", async () => {
    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "quartz",
      toAgents: ["quartz", "onyx"],
    });

    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ, ONYX]);
  });
});

describe("postMessage — a multi-address is ALL OR NOTHING", () => {
  it("400s naming the bad ref when one of N resolves to nothing", async () => {
    await expect(
      postMessage(ctx, "room", {
        body: "go",
        toAgents: ["quartz", "nobody"],
      })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
    // Not "two of three delivered" — nothing is written at all.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("names the ref that failed, not the first one", async () => {
    await expect(
      postMessage(ctx, "room", { body: "go", toAgents: ["quartz", "nobody"] })
    ).rejects.toThrow(/nobody/);
  });

  it("400s an agent of ANOTHER channel anywhere in the list", async () => {
    vi.mocked(repoAgents.findAgentByName).mockImplementation(
      async (_channelId, name) =>
        name === "onyx"
          ? agentRow({ id: ONYX, name: "onyx", channel_id: "chan-other" })
          : AGENTS[name.toLowerCase()]
    );

    await expect(
      postMessage(ctx, "room", { body: "go", toAgents: ["quartz", "onyx"] })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  /**
   * S2 at N. The owner-membership check is what keeps the owner bridge from
   * putting a non-member in the addressee slot. Here the departed owner is the
   * SECOND agent — whose owner never reaches `to_user_id` — so a check that only
   * covered the head would pass this post and ship a `to_agent_ids` entry
   * pointing at a machine whose owner cannot read the room.
   */
  it("400s when a NON-HEAD agent's owner has left the channel", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === THIRD ? null : memberRow(userId)
    );

    await expect(
      postMessage(ctx, "room", { body: "go", toAgents: ["quartz", "onyx"] })
    ).rejects.toThrow(ChannelAddresseeNotMemberError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});

describe("postMessage — to_agent_ids is RESERVED", () => {
  it("SECURITY: strips a caller copy when no agent is addressed", async () => {
    await postMessage(ctx, "room", {
      body: "hi",
      metadata: { to_agent_ids: [QUARTZ, ONYX], keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "to_agent_ids")).toBe(false);
    expect(meta.keep).toBe(1);
    // No claim, no lookup — and no engagement either.
    expect(repoAgents.findAgentByName).not.toHaveBeenCalled();
    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("SECURITY: a spoofed copy never survives beside the validated field", async () => {
    await postMessage(ctx, "room", {
      body: "hi",
      toAgents: ["quartz"],
      metadata: { to_agent_ids: [ONYX] },
    });

    expect(capturedMetadata().to_agent_ids).toEqual([QUARTZ]);
  });
});

/**
 * S2 — THE CAP IS ON THE MERGED ADDRESS.
 *
 * `MAX_ADDRESSED_AGENTS` is 8 and the post schema put that bound on `toAgents`
 * ALONE, so `toAgent` + a full eight-entry `toAgents` passed validation and
 * addressed NINE. Nothing else in the system agreed: `MAX_DERIVED_AGENTS`
 * (`service-thread-handshake.ts`) truncated the ninth out of the derived
 * participant set, so that agent was engaged, woken, converged on the handshake
 * thread, and then 403'd out of it by `mayWriteThread` — the exact "told to join
 * a room, locked out of it" failure that module exists to prevent.
 *
 * ONE bound, on the deduped merge, with ONE error naming the real limit.
 */
describe("postMessage — the address cap counts toAgent and toAgents together", () => {
  /** Everything in the pool resolves, so only the CAP can refuse a post. */
  function rosterOfEverything(): void {
    vi.mocked(repoAgents.findAgentByName).mockImplementation(
      async (_channelId, name) =>
        agentRow({ id: `id-${name.toLowerCase()}`, name: name.toLowerCase() })
    );
  }

  const eight = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];

  it("refuses the NINTH, naming the real limit", async () => {
    rosterOfEverything();

    await expect(
      postMessage(ctx, "room", { body: "go", toAgent: "quartz", toAgents: eight })
    ).rejects.toThrow(ChannelTooManyAgentsError);
  });

  it("the error is ACTIONABLE: it names both the limit and the merged count", async () => {
    rosterOfEverything();

    let err: Error | undefined;
    try {
      await postMessage(ctx, "room", {
        body: "go",
        toAgent: "quartz",
        toAgents: eight,
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(ChannelTooManyAgentsError);

    // The caller's mistake is invisible from the array alone — it passed its own
    // `.max()` — so the message has to say that the singular counts too.
    expect(err?.message).toContain("at most 8");
    expect(err?.message).toContain("9");
    expect(err?.message).toContain("toAgent");
  });

  it("refuses BEFORE resolving anything (a refusal is not nine round-trips)", async () => {
    rosterOfEverything();

    await expect(
      postMessage(ctx, "room", { body: "go", toAgent: "quartz", toAgents: eight })
    ).rejects.toThrow(ChannelTooManyAgentsError);

    expect(repoAgents.findAgentByName).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });

  it("ACCEPTS exactly eight merged", async () => {
    rosterOfEverything();

    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "a1",
      toAgents: ["a2", "a3", "a4", "a5", "a6", "a7", "a8"],
    });

    expect(capturedMetadata().to_agent_ids).toHaveLength(8);
  });

  it("counts a REPEATED ref once — the bound is on the deduped merge", async () => {
    rosterOfEverything();

    // The MCP lane sends exactly this shape: the head as `toAgent` AND the whole
    // list as `toAgents`. Nine strings, eight addresses, and it must not 400.
    await postMessage(ctx, "room", {
      body: "go",
      toAgent: "a1",
      toAgents: eight,
    });

    expect(capturedMetadata().to_agent_ids).toHaveLength(8);
  });

  it("the handshake derivation reads the SAME constant", () => {
    // The literal `8` that used to sit in `service-thread-handshake.ts` held only
    // while the two numbers happened to agree, and they did not.
    expect(MAX_ADDRESSED_AGENTS).toBe(8);
  });
});
