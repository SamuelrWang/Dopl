import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStateRow } from "./collab-dto";
import type { ChannelRow } from "./dto";
import { ChannelRecipientUnresolvedError } from "./errors";
import { resolveToRecipient } from "./service-writes-metadata-recipient";
import type { ChannelContext } from "./service-shared";

vi.mock("./repository");
vi.mock("./repository-sessions");

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";

/**
 * **`to=` IS ONE RECIPIENT AND TWO NAMESPACES** (2026-09-02, v2 wave B slice B4
 * — Samuel's ruling B1).
 *
 * ⚠ **THE CASE THIS FILE EXISTS FOR IS THE REFUSAL.** With the fan-out narrowed,
 * a `to` that resolves to nobody reaches nobody, and answering `ok` about it is
 * the invisible-delivery failure in its purest form. Every happy-path case below
 * is here to prove the refusal is not firing by accident.
 */

const CHANNEL = { id: "chan-1", workspace_id: "ws-1" } as ChannelRow;
const HUMAN: ChannelContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  source: "user",
} as ChannelContext;
const AGENT_CALLER: ChannelContext = { ...HUMAN, source: "agent" } as ChannelContext;
const UUID = "11111111-2222-4333-8444-555555555555";

function sessionRow(over: Partial<SessionStateRow>): SessionStateRow {
  return {
    id: "s-1",
    channel_id: "chan-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    name: "k3v7d2mq",
    display_name: null,
    updated_at: new Date().toISOString(),
    ...over,
  } as SessionStateRow;
}

function roster(
  ...users: Array<{ id: string; email: string | null; name?: string | null }>
): void {
  vi.mocked(repo.listMembers).mockResolvedValue(
    users.map((u) => ({ user_id: u.id })) as never
  );
  vi.mocked(repo.fetchProfiles).mockResolvedValue(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.name ?? null,
      avatar_url: null,
    }))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  roster();
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
});

describe("the member namespace", () => {
  it("a uuid resolves to a member WITHOUT any read — the membership fence is the caller's", async () => {
    // ⚠ It does not check membership: `service-writes.ts` asks `findMembership`
    // AND `isActiveWorkspaceMember` about the resolved id exactly as it does for
    // a caller-supplied uuid. Two copies of that fence is how one of them rots.
    expect(await resolveToRecipient(HUMAN, CHANNEL, UUID)).toEqual({
      kind: "member",
      userId: UUID,
    });
    expect(vi.mocked(repo.listMembers)).not.toHaveBeenCalled();
  });

  it("an email resolves case-insensitively against THIS CHANNEL'S roster", async () => {
    roster({ id: "user-2", email: "Ada@Example.com" });
    expect(await resolveToRecipient(HUMAN, CHANNEL, "ada@example.com")).toEqual({
      kind: "member",
      userId: "user-2",
    });
  });

  it("an email nobody in the room holds is REFUSED, not resolved workspace-wide", async () => {
    // 🔒 ROSTER-SCOPED SO THIS CANNOT BECOME A PROBE for whether an arbitrary
    // address has an account here: a stranger and a non-member get one sentence.
    roster({ id: "user-2", email: "ada@example.com" });
    await expect(
      resolveToRecipient(HUMAN, CHANNEL, "stranger@example.com")
    ).rejects.toBeInstanceOf(ChannelRecipientUnresolvedError);
  });
});

describe("the agent namespace", () => {
  it("resolves `@agent-<id>` against the room's live sessions", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@agent-k3v7d2mq")).toEqual({
      kind: "agent",
      agentId: "k3v7d2mq",
    });
  });

  it("accepts the bare handle, with no `@` — a pasted `channel_sessions.name` names a real thing", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "agent-k3v7d2mq")).toMatchObject({
      kind: "agent",
    });
  });

  it("resolves a renamed agent by its SLUG, through the one shared index", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq", display_name: "Research Bot" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@research-bot")).toEqual({
      kind: "agent",
      agentId: "k3v7d2mq",
    });
  });

  it("an AMBIGUOUS slug fails closed — two agents, one name, neither resolves", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" }),
    ]);
    await expect(resolveToRecipient(HUMAN, CHANNEL, "@bot")).rejects.toBeInstanceOf(
      ChannelRecipientUnresolvedError
    );
  });
});

describe("🔒 the same-account carve — an agent may not address a PEER's agent", () => {
  it("a PERSON may name any agent live in the room", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ user_id: "user-9", name: "peer1234" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@agent-peer1234")).toEqual({
      kind: "agent",
      agentId: "peer1234",
    });
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
  });

  it("an AGENT reads only its OWN operator's sessions, so a peer's handle is unreachable", async () => {
    // 🔒 STRUCTURAL, NOT A BRANCH ON THE WAY OUT. The peer's agent is not in the
    // index, so it cannot be resolved, so no stored verdict can name it. ⚠ The
    // channel-wide read is asserted UNCALLED: a resolver that read it and then
    // filtered would pass a shape test and fail this one.
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ user_id: "user-9", name: "peer1234" }),
    ]);
    await expect(
      resolveToRecipient(AGENT_CALLER, CHANNEL, "@agent-peer1234")
    ).rejects.toBeInstanceOf(ChannelRecipientUnresolvedError);
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
    expect(vi.mocked(repoSessions.listSessionStates).mock.calls).toEqual([
      ["user-1", "ws-1", "chan-1"],
      ["user-1", "ws-1", "chan-1"],
    ]);
  });

  it("an AGENT still reaches its OWN operator's agent", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq" }),
    ]);
    expect(
      await resolveToRecipient(AGENT_CALLER, CHANNEL, "@agent-k3v7d2mq")
    ).toEqual({ kind: "agent", agentId: "k3v7d2mq" });
  });
});

describe("🔒 the refusal lists what the caller can actually reach", () => {
  it("names the live handles and the roster", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" }),
    ]);
    roster({ id: "user-2", email: "ada@example.com", name: "Ada" });
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@nobody").catch((e) => e);
    expect(err).toBeInstanceOf(ChannelRecipientUnresolvedError);
    expect(err.liveHandles).toEqual(["agent-k3v7d2mq", "agent-m8q1zzzz"]);
    expect(err.members).toEqual(["Ada"]);
    // ⚠ THE SENTENCE ITSELF, because the MCP side renders `err.message` and a
    // refusal that names nothing is a second guess for the caller.
    expect(err.message).toContain("@agent-k3v7d2mq");
    expect(err.message).toContain("Ada");
    expect(err.message).toContain("@nobody");
  });

  it("🔒 does NOT enumerate other members' EMAILS to a plain member (F-588)", async () => {
    // ⚠ THE CHEAPEST ROSTER DUMP ON THE SURFACE: one mistyped `to=` returned
    // every member's email, to any caller, agent tokens included — the same
    // enumeration `channel-render.ts › formatMemberLine` refuses by name. A
    // REFUSAL IS A READ.
    roster({ id: "user-2", email: "ada@example.com" });
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@nobody").catch((e) => e);
    // Nameless member → the id, never the address.
    expect(err.members).toEqual(["user-2"]);
    expect(err.message).not.toContain("ada@example.com");
  });

  it("🔒 an AGENT TOKEN gets the same narrow list (F-588)", async () => {
    roster({ id: "user-2", email: "ada@example.com" });
    const err = await resolveToRecipient(AGENT_CALLER, CHANNEL, "@nobody").catch((e) => e);
    expect(err.message).not.toContain("ada@example.com");
  });

  it("shows the CALLER'S OWN email, and every email to a workspace ADMIN", async () => {
    // The entitlement rule, both arms — `formatMemberLine`'s, applied at the one
    // place that can see who is asking.
    roster(
      { id: "user-1", email: "me@example.com" },
      { id: "user-2", email: "ada@example.com" }
    );
    const own = await resolveToRecipient(HUMAN, CHANNEL, "@nobody").catch((e) => e);
    expect(own.members).toEqual(["me@example.com", "user-2"]);

    const admin = { ...HUMAN, role: "admin" } as ChannelContext;
    const all = await resolveToRecipient(admin, CHANNEL, "@nobody").catch((e) => e);
    expect(all.members).toEqual(["ada@example.com", "me@example.com"]);
  });

  it("lists the ID form, never a contested slug — a refusal must not teach a second refusal", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" }),
    ]);
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@bot").catch((e) => e);
    expect(err.liveHandles).toEqual(["agent-k3v7d2mq", "agent-m8q1zzzz"]);
  });

  it("says `none` rather than nothing when the room is empty", async () => {
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@nobody").catch((e) => e);
    expect(err.message).toContain("Live agents: none");
    expect(err.message).toContain("Members: none");
  });

  it("an AGENT is shown ITS OWN reachable set, not the room's", async () => {
    vi.mocked(repoSessions.listSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq" }),
    ]);
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ user_id: "user-9", name: "peer1234" }),
    ]);
    const err = await resolveToRecipient(AGENT_CALLER, CHANNEL, "@agent-peer1234").catch(
      (e) => e
    );
    // Showing the peer's handle here would list the name it was just refused.
    expect(err.liveHandles).toEqual(["agent-k3v7d2mq"]);
  });
});
