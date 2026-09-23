/**
 * Where a create lands — the four arms of `resolveCreateDestination`, and the
 * two it must not ask.
 *
 * The function issues no query of its own, so the assertions cover which fence
 * it asked, with what, and which one it did not ask:
 *   - order is the query budget: a `homeScoped` caller must never pay for the
 *     audience ceiling (four reads), an `unrestricted` one never for the
 *     personal fence.
 *   - the fence is asked, never re-implemented, and asked ABOUT THE CALLER —
 *     keyed on a caller-supplied container it becomes a door into any shelf.
 *
 * The two refusals are deliberately different errors: a caller that asked for
 * the shelf gets `PersonalContainerMissingError`, one that asked for nothing
 * gets `AgentWriteDisabledError`. Collapsing them would tell an agent that never
 * mentioned a shelf that its operator has one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(),
  personalShelfContainerIds: vi.fn(),
}));

vi.mock("./service-audience", () => ({
  resolveAgentAudience: vi.fn(),
}));

import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import { PersonalContainerMissingError } from "@/shared/tenancy/personal-container";
import { resolveAgentAudience } from "./service-audience";
import { resolveCreateDestination } from "./service-base-gates";
import { AgentWriteDisabledError } from "./errors";

const mockReach = vi.mocked(resolvePersonalReach);
const mockAudience = vi.mocked(resolveAgentAudience);

const ME = "u-operator";
/** The room — a link container with a peer in it. */
const ROOM = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
/** The caller's own personal container. Never equal to the room. */
const CONTAINER = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";

function ctx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: ROOM,
    userId: ME,
    role: "owner",
    source: "agent",
    apiKeyWorkspaceId: ROOM,
    credentialSubjectUserId: ME,
    sessionId: null,
    ...over,
  };
}

/** The ceiling is armed — an agent in a room with somebody else in it. */
function restricted() {
  mockAudience.mockResolvedValue({
    kind: "granted",
    baseIds: new Set<string>(),
    channelIds: [CHANNEL],
  });
}

/** A human, a standard workspace, or a solo container. */
function unrestricted() {
  mockAudience.mockResolvedValue({ kind: "unrestricted" });
}

function open() {
  mockReach.mockResolvedValue({ kind: "open", containerId: CONTAINER });
}

function closed(refusal: "shared_credential" | "no_container" | "unarmed_room") {
  mockReach.mockResolvedValue({ kind: "closed", refusal });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Arm 1: the caller asked for the shelf by name ─────────────────────────

describe("🔒 homeScoped — asked for by name, so the fence alone decides", () => {
  it("lands on the caller's OWN container when the fence is open", async () => {
    open();

    expect(await resolveCreateDestination(ctx(), { homeScoped: true })).toEqual({
      homeScoped: true,
      workspaceId: CONTAINER,
    });
    // The flag and the id together: `insertBase` routes on the flag through
    // `personalWriteWorkspaceId` while the slug read and the rollback use the
    // id.
  });

  it("⚠ NEVER PAYS FOR THE AUDIENCE CEILING — the budget, not a tidiness point", async () => {
    // Asking `resolveAgentAudience` here would put up to four reads on every
    // personal create and cannot change the answer: the destination is a
    // one-member container, whose ceiling is `unrestricted` by construction.
    open();

    await resolveCreateDestination(ctx(), { homeScoped: true });

    expect(mockAudience).not.toHaveBeenCalled();
  });

  it("🔒 REFUSES, NEVER DOWNGRADES, when the fence is closed", async () => {
    // The workspace shelf is a different audience, not a lesser one: falling
    // back to the room would publish a row the caller meant to keep on their own
    // shelf into a container a peer is standing in.
    closed("unarmed_room");

    await expect(
      resolveCreateDestination(ctx(), { homeScoped: true })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
  });

  it("names the REMEDY on an unarmed room, and arming is human-only", async () => {
    // The one place `unarmed_room` may be spoken: a write has no silent form,
    // and the only person who learns anything is the owner, about their own
    // shelf in their own room. It must never reach a read path, where an unarmed
    // room has to answer what an empty one answers.
    closed("unarmed_room");

    const err = await resolveCreateDestination(ctx(), { homeScoped: true }).then(
      () => null,
      (e: Error) => e
    );

    expect(err!.message).toContain("not armed for your personal shelf");
    expect(err!.message).toContain("human-only");
  });

  it.each([
    ["shared_credential" as const, "a shared credential has no personal shelf"],
    ["no_container" as const, "your personal container has not been created yet"],
  ])("carries the %s reason through verbatim", async (refusal, sentence) => {
    // One sentence per reason, written once (`personal-container.ts ›
    // personalShelfRefusal`) and shared with the router and the agent-identities
    // twin.
    closed(refusal);

    const err = await resolveCreateDestination(ctx(), { homeScoped: true }).then(
      () => null,
      (e: Error) => e
    );

    expect(err!.message).toContain(sentence);
  });

  it("🔒 asks the fence about THE CALLER, standing in THE ROOM", async () => {
    // The fence is asked about the context this request already proved, never
    // about a container named in the input.
    open();
    const caller = ctx();

    await resolveCreateDestination(caller, { homeScoped: true });

    expect(mockReach).toHaveBeenCalledTimes(1);
    expect(mockReach).toHaveBeenCalledWith(caller);
  });
});

// ── Arm 2: the ceiling is open — every path that works today ──────────────

describe("⚠ an UNRESTRICTED audience lands in the calling container, as it always did", () => {
  it("answers the room, and does not ask the personal fence at all", async () => {
    // A human, a standard workspace and a solo container are the three
    // `unrestricted` branches; each must land where it landed before the seam.
    unrestricted();

    expect(await resolveCreateDestination(ctx({ source: "user" }), {})).toEqual({
      homeScoped: false,
      workspaceId: ROOM,
    });
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("⚠ answers `homeScoped: false`, not absent — the router reads `!== true`", async () => {
    // The explicit `false` keeps the destination one shape with both fields
    // always present, so a caller reading the flag never finds it missing.
    unrestricted();

    const destination = await resolveCreateDestination(ctx(), {});

    expect(destination.homeScoped).toBe(false);
  });

  it("does not re-route a create that names a CHANNEL or a TEAM either", async () => {
    // Both name the calling container, so neither is a personal row.
    unrestricted();

    expect(
      await resolveCreateDestination(ctx(), { shareToChannelId: CHANNEL })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(
      await resolveCreateDestination(ctx(), { wantsTeams: true })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
  });
});

// ── Arm 3: restricted, but the shelf is reachable ─────────────────────────

describe("🔒 a RESTRICTED audience follows its OWNER when the room is armed", () => {
  it("re-routes to the personal container instead of refusing", async () => {
    // Personal-visibility creates resolve their container by owner, never by
    // call site. The only creates this moves are ones the read-back gate was
    // already refusing outright.
    restricted();
    open();

    expect(await resolveCreateDestination(ctx(), {})).toEqual({
      homeScoped: true,
      workspaceId: CONTAINER,
    });
  });

  it("🔒 the READ-BACK GUARANTEE is the OPEN fence, and it is asked every time", async () => {
    // This is not a way around F-323's gate because the row lands in a
    // one-member container, and that holds only because the fence said open.
    // Re-routing without asking would write into a shelf out of reach.
    restricted();
    open();

    await resolveCreateDestination(ctx(), {});

    expect(mockReach).toHaveBeenCalledTimes(1);
  });
});

// ── Arm 4: restricted and closed — F-323's refusal, unchanged ─────────────

describe("🔒 RESTRICTED and out of reach keeps F-323's refusal", () => {
  it("refuses an unarmed shared room with the ROOM error, not the shelf one", async () => {
    // This caller never mentioned a shelf. Answering
    // `PERSONAL_CONTAINER_MISSING` would disclose that its operator has a
    // personal container and that this room is not armed for it.
    restricted();
    closed("unarmed_room");

    const err = await resolveCreateDestination(ctx(), {}).then(
      () => null,
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(AgentWriteDisabledError);
    expect(err).not.toBeInstanceOf(PersonalContainerMissingError);
    // The sentence carries why, who can fix it, and what else to do.
    expect(err!.message).toContain("shared home channel");
    expect(err!.message).toContain("Ask your operator");
  });

  it("🔒 a create naming a CHANNEL is refused WITHOUT asking the fence", async () => {
    // `shareToChannelId` names the room and a grant cannot follow a row out of
    // it: re-routing would land the base on the personal shelf and then grant it
    // into a channel of a container it no longer lives in.
    restricted();

    await expect(
      resolveCreateDestination(ctx(), { shareToChannelId: CHANNEL })
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("🔒 a TEAMS create is refused WITHOUT asking the fence, for the same reason", async () => {
    // A team lives in the calling container, so a personal row could never carry
    // the grant the caller asked for.
    restricted();

    await expect(
      resolveCreateDestination(ctx(), { wantsTeams: true })
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("⚠ `homeScoped` BEATS both, because the caller named the shelf", async () => {
    // The shelf arm runs first, so a caller that named its own shelf is answered
    // by the fence rather than the room's ceiling.
    closed("unarmed_room");

    await expect(
      resolveCreateDestination(ctx(), {
        homeScoped: true,
        shareToChannelId: CHANNEL,
      })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
    expect(mockAudience).not.toHaveBeenCalled();
  });
});
