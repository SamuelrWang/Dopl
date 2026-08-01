/**
 * Schema tests for the multiplayer request bodies.
 *
 * The one that matters is the HANDLE. `AGENT_HANDLE_RE` is the single
 * definition of the addressing charset and is character-for-character the
 * `channel_agents.name` column CHECK, so anything this schema accepts the
 * database must accept too — a looser client rule turns a typo into a 500, and
 * a stricter one rejects handles the pool itself produces.
 */

import { describe, it, expect } from "vitest";

import { AGENT_NAME_POOL, pickAgentName } from "./server/agent-names";
import { ChannelMessageCreateSchema, TaskCreateSchema } from "./schema";
import {
  AGENT_HANDLE_RE,
  ChannelAgentCreateSchema,
  ChannelAgentUpdateSchema,
  ThreadParticipantMutateSchema,
  ThreadParticipantSeedSchema,
} from "./schema-agents";

const AGENT_ID = "11111111-e29b-41d4-a716-446655440000";

describe("AGENT_HANDLE_RE", () => {
  it("accepts every handle the curated pool can produce", () => {
    for (const name of AGENT_NAME_POOL) {
      expect(AGENT_HANDLE_RE.test(name)).toBe(true);
    }
    // Including the suffixed forms the picker falls back to once it is spent.
    const taken = new Set(AGENT_NAME_POOL);
    expect(AGENT_HANDLE_RE.test(pickAgentName(taken))).toBe(true);
  });

  it("rejects what the column CHECK rejects", () => {
    for (const bad of [
      "a", // one character — the CHECK needs 2..31
      "1quartz", // must start with a letter
      "-quartz",
      "Quartz", // stored handles are lowercase
      "quartz!",
      "quartz agent",
      "quartz_agent",
      "q".repeat(32),
      "",
    ]) {
      expect(AGENT_HANDLE_RE.test(bad)).toBe(false);
    }
  });
});

describe("ChannelAgentCreateSchema", () => {
  it("accepts an empty body — the server picks from the pool", () => {
    const parsed = ChannelAgentCreateSchema.parse({});
    expect(parsed.name).toBeUndefined();
  });

  it("trims and CASE-FOLDS an explicit handle (the unique index folds too)", () => {
    expect(ChannelAgentCreateSchema.parse({ name: "  Quartz " }).name).toBe(
      "quartz"
    );
  });

  it("rejects a handle outside the charset", () => {
    expect(ChannelAgentCreateSchema.safeParse({ name: "1bad" }).success).toBe(
      false
    );
  });
});

describe("ChannelAgentUpdateSchema", () => {
  it("parses a rename, folding the new handle", () => {
    expect(
      ChannelAgentUpdateSchema.parse({ op: "rename", name: "COBALT" })
    ).toEqual({ op: "rename", name: "cobalt" });
  });

  it("parses each lifecycle status", () => {
    for (const status of ["summoned", "active", "parked", "dismissed"]) {
      expect(
        ChannelAgentUpdateSchema.parse({ op: "set_status", status }).op
      ).toBe("set_status");
    }
  });

  it("rejects a status outside the closed set (the column CHECK backs it)", () => {
    expect(
      ChannelAgentUpdateSchema.safeParse({ op: "set_status", status: "busy" })
        .success
    ).toBe(false);
  });

  it("rejects an unknown op, and fields bleeding between ops", () => {
    expect(
      ChannelAgentUpdateSchema.safeParse({ op: "delete", name: "quartz" })
        .success
    ).toBe(false);
    expect(
      ChannelAgentUpdateSchema.safeParse({ op: "rename", status: "parked" })
        .success
    ).toBe(false);
  });
});

describe("ThreadParticipantMutateSchema / ThreadParticipantSeedSchema", () => {
  it("accepts both identity kinds with a uuid", () => {
    expect(
      ThreadParticipantMutateSchema.parse({ kind: "agent", id: AGENT_ID })
    ).toEqual({ kind: "agent", id: AGENT_ID });
    expect(
      ThreadParticipantMutateSchema.parse({ kind: "user", id: AGENT_ID }).kind
    ).toBe("user");
  });

  it("rejects a non-uuid id and an unknown kind", () => {
    expect(
      ThreadParticipantMutateSchema.safeParse({ kind: "user", id: "nope" })
        .success
    ).toBe(false);
    expect(
      ThreadParticipantMutateSchema.safeParse({ kind: "team", id: AGENT_ID })
        .success
    ).toBe(false);
  });

  it("bounds the seed list — a participant set is not a mailing list", () => {
    const many = Array.from({ length: 21 }, () => ({
      kind: "user" as const,
      id: AGENT_ID,
    }));
    expect(ThreadParticipantSeedSchema.safeParse(many).success).toBe(false);
    expect(ThreadParticipantSeedSchema.parse([])).toEqual([]);
  });
});

/** The additive fields the multiplayer wave puts on two existing bodies. */
describe("the additive fields on the existing bodies", () => {
  it("post accepts toAgent as a HANDLE — deliberately not a uuid", () => {
    const parsed = ChannelMessageCreateSchema.parse({
      body: "hi",
      toAgent: "  quartz  ",
    });
    // Trimmed, but NOT folded here: the repository folds the needle, so a
    // handle and an id can travel through the same field.
    expect(parsed.toAgent).toBe("quartz");
  });

  it("post accepts toAgent as an agent id too", () => {
    expect(
      ChannelMessageCreateSchema.parse({ body: "hi", toAgent: AGENT_ID })
        .toAgent
    ).toBe(AGENT_ID);
  });

  it("post requires authorAgentId to be a uuid (an agent id is never a handle)", () => {
    expect(
      ChannelMessageCreateSchema.safeParse({ body: "hi", authorAgentId: "quartz" })
        .success
    ).toBe(false);
    expect(
      ChannelMessageCreateSchema.parse({ body: "hi", authorAgentId: AGENT_ID })
        .authorAgentId
    ).toBe(AGENT_ID);
  });

  it("create_thread takes an optional bounded participants list", () => {
    const base = { title: "T", body: "B", toUserId: AGENT_ID };
    expect(TaskCreateSchema.parse(base).participants).toBeUndefined();
    expect(
      TaskCreateSchema.parse({
        ...base,
        participants: [{ kind: "agent", id: AGENT_ID }],
      }).participants
    ).toHaveLength(1);
    expect(
      TaskCreateSchema.safeParse({
        ...base,
        participants: [{ kind: "agent", id: "not-a-uuid" }],
      }).success
    ).toBe(false);
  });
});
