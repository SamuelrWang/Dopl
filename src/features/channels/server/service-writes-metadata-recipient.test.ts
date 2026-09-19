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

  // ⚠ **THIS CASE HAS ANSWERED FOUR WAYS, AND THE FOURTH MOVED THE RULE OFF THIS LAYER.** It
  // pinned fail-closed ambiguity to 2026-09-07, the suffix mint to 2026-09-15, fail-closed again
  // for part of that day — and then Samuel ruled the collision out of existence: *"no two agents
  // that are addressable can have the same name … it will automatically auto-resolve to coder-1
  // … coder-2 and so on and so forth."* The second "Bot" is STORED as `Bot-1`
  // (`main/agent-name-unique.js`), so `to="@bot"` and `to="@bot-1"` are two ordinary names.
  it("resolves a name SUFFIXED AT LAUNCH like any other name", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot-1" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@bot")).toEqual({
      kind: "agent",
      agentId: "k3v7d2mq",
    });
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@bot-1")).toEqual({
      kind: "agent",
      agentId: "m8q1zzzz",
    });
  });

  it("names the FIRST claimant on a cross-machine duplicate, and refuses no spelling it minted", async () => {
    // ⚠ **THE ONE CASE THE COMMIT RULE CANNOT COVER** — names are minted on the machine that owns
    // the id, so two MEMBERS can each run a "Bot" in one room. ⚠ AND NOTHING IS MINTED HERE: the
    // refusal for `@bot-1` proves the 2026-09-07 resolve-time suffix stayed withdrawn.
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@bot")).toEqual({
      kind: "agent",
      agentId: "k3v7d2mq",
    });
    // ⚠ AND THE REFUSAL LISTS ID FORMS, never slugs — `liveAgentHandles`'s own rule, so a refusal
    // can never name a handle that resolves to nobody.
    await expect(resolveToRecipient(HUMAN, CHANNEL, "@bot-1")).rejects.toMatchObject({
      liveHandles: ["agent-k3v7d2mq", "agent-m8q1zzzz"],
    });
    // ⚠ THE LOSER IS STILL REACHABLE BY THE HANDLE THAT IS NEVER WITHDRAWN.
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@agent-m8q1zzzz")).toEqual({
      kind: "agent",
      agentId: "m8q1zzzz",
    });
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

  // ⚠ **THE HANDLE THAT DRIVES THIS CHANGED ON 2026-09-07, THE ASSERTION DID NOT.** It used to
  // ask `@bot` over two agents both named "Bot", because a contested slug REFUSED; it now mints
  // (`@bot` / `@bot-1`, pinned above), so a contested name no longer produces a refusal to
  // inspect. The invariant this case exists for is untouched and still worth its own test —
  // **a refusal lists the ID FORM, never a slug** — so it is driven by a handle that genuinely
  // reaches nobody, with the same two agents live. ⚠ The id form is the only spelling safe to
  // suggest: it is permanent, whereas a `-1` suffix is positional over the live set.
  it("lists the ID form, never a slug — a refusal must not teach a second refusal", async () => {
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" }),
    ]);
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@nobody").catch((e) => e);
    expect(err).toBeInstanceOf(ChannelRecipientUnresolvedError);
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

/**
 * **`@desktop` — THE BUILT-IN GROUP HANDLE** (2026-09-18, Samuel's ruling on the
 * external-session group tag).
 *
 * ⚠ **THE TWO PROPERTIES WORTH PINNING ARE "COSTS NO READ" AND "CANNOT BE
 * SHADOWED".** The first is what makes the address always-resolvable and never
 * stale; the second is what stops an operator (or a peer) from quietly taking
 * the token by naming an agent "Desktop".
 */
describe("the desktop group handle", () => {
  it("resolves to the CALLER'S OWN operator, with no read at all", async () => {
    expect(await resolveToRecipient(AGENT_CALLER, CHANNEL, "@desktop")).toEqual({
      kind: "desktop",
      operatorUserId: AGENT_CALLER.userId,
    });
    // ⚠ NO ROSTER READ AND NO SESSION READ. It is a built-in, not a row: that is
    // what makes it resolvable in every channel, with no setup and no staleness.
    expect(vi.mocked(repo.listMembers)).not.toHaveBeenCalled();
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("is the caller's own even when a DIFFERENT member is the one asking", async () => {
    // ⚠ TWO MEMBERS IN ONE ROOM HOLD TWO `@desktop`s AND THEY NEVER CONTEST,
    // because the resolution never reads the room. Diana's agent writing
    // `to=@desktop` means DIANA's outside sessions.
    const diana = { ...HUMAN, userId: "user-diana" } as ChannelContext;
    expect(await resolveToRecipient(diana, CHANNEL, "@desktop")).toEqual({
      kind: "desktop",
      operatorUserId: "user-diana",
    });
  });

  it("accepts the bare spelling, like every other handle on this door", async () => {
    expect(await resolveToRecipient(HUMAN, CHANNEL, "desktop")).toEqual({
      kind: "desktop",
      operatorUserId: HUMAN.userId,
    });
  });

  it("is RESERVED — an agent named \"Desktop\" cannot take the token", async () => {
    // 🔒 THE CASE THE SERVER-SIDE RESERVATION EXISTS FOR. `main/agent-name-unique.js`
    // would suffix a NEW launch to `desktop-1`, but that rule runs on ONE machine
    // and cannot see a row written before it, or a PEER's agent whose name was
    // minted elsewhere. This row is exactly such a row.
    vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([
      sessionRow({ name: "k3v7d2mq", display_name: "Desktop" }),
    ]);
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@desktop")).toEqual({
      kind: "desktop",
      operatorUserId: HUMAN.userId,
    });
    // ⚠ AND THE AGENT IS NOT WITHDRAWN FROM ADDRESSING — it keeps the id form,
    // the handle that never stops working.
    expect(await resolveToRecipient(HUMAN, CHANNEL, "@agent-k3v7d2mq")).toEqual({
      kind: "agent",
      agentId: "k3v7d2mq",
    });
  });

  it("is listed in the refusal, so a mistyped `to` teaches the built-in", async () => {
    // ⚠ A REFUSAL IS THE ONE PLACE A CALLER RELIABLY READS A HANDLE LIST, and a
    // built-in absent from it is a built-in nobody discovers.
    await expect(
      resolveToRecipient(HUMAN, CHANNEL, "@nobody-at-all")
    ).rejects.toBeInstanceOf(ChannelRecipientUnresolvedError);
    const err = await resolveToRecipient(HUMAN, CHANNEL, "@nobody-at-all").then(
      () => {
        throw new Error("expected a refusal");
      },
      (e: unknown) => e as ChannelRecipientUnresolvedError
    );
    // ⚠ NOT in `liveHandles` — that list is published as "Live agents:" and the
    // built-in is neither an agent nor live. It rides the MESSAGE instead.
    expect(err.liveHandles).not.toContain("desktop");
    expect(err.message).toContain("@desktop always resolves");
  });
});
