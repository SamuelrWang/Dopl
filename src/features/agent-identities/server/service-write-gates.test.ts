/**
 * `resolveIdentityCreateDestination`: a `homeScoped` create asks the personal fence, about the caller,
 * before writing to the shelf (twin of `knowledge/server/service-base-gates.test.ts`; the differences
 * are the gates', see `service-write-gates.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentityContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(),
  personalShelfContainerIds: vi.fn(),
}));

import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import { PersonalContainerMissingError } from "@/shared/tenancy/personal-container";
import { resolveIdentityCreateDestination } from "./service-write-gates";
import { IdentityTeamNotGrantableError } from "./errors";

const mockReach = vi.mocked(resolvePersonalReach);

const ME = "u-operator";
/** A shared room — a container with a peer in it. */
const ROOM = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
/** The caller's own personal container; never equal to the room. */
const CONTAINER = "33333333-3333-4333-8333-333333333333";

function ctx(over: Partial<AgentIdentityContext> = {}): AgentIdentityContext {
  return {
    workspaceId: ROOM,
    userId: ME,
    source: "agent",
    role: "owner",
    apiKeyWorkspaceId: ROOM,
    credentialSubjectUserId: ME,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a create nobody re-routed lands in the calling container", () => {
  it.each([
    ["absent", undefined],
    ["false", false],
  ])("answers the room for a %s flag, without asking the fence", async (_l, flag) => {
    // No fence read on an ordinary create: nobody asked for a shelf.
    expect(
      await resolveIdentityCreateDestination(ctx(), {
        homeScoped: flag,
        visibility: "private",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("…including an AGENT in a shared room, which has no twin of the KB re-route", async () => {
    // Deliberately unlike knowledge's re-route (F-323): `canSeeIdentity` answers for the creator (F-333).
    expect(
      await resolveIdentityCreateDestination(ctx({ source: "agent" }), {
        visibility: "private",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(mockReach).not.toHaveBeenCalled();
  });
});

describe("homeScoped — the fence decides, and it is finally asked", () => {
  it("lands on the caller's OWN container when the fence is open", async () => {
    mockReach.mockResolvedValue({ kind: "open", containerId: CONTAINER });

    expect(
      await resolveIdentityCreateDestination(ctx(), {
        homeScoped: true,
        visibility: "private",
      })
    ).toEqual({ homeScoped: true, workspaceId: CONTAINER });
  });

  it("REFUSES an agent in an UNARMED shared room — the hole this gate closes", async () => {
    // `personalWriteWorkspaceId` routes by author and asks nobody, so the gate must refuse first.
    mockReach.mockResolvedValue({ kind: "closed", refusal: "unarmed_room" });

    const err = await resolveIdentityCreateDestination(ctx(), {
      homeScoped: true,
      visibility: "private",
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(PersonalContainerMissingError);
    expect(err!.message).toContain("not armed for your personal shelf");
    expect(err!.message).toContain("human-only");
  });

  it.each([
    ["shared_credential" as const, "a shared credential has no personal shelf"],
    ["no_container" as const, "your personal container has not been created yet"],
  ])("refuses %s with the shared sentence, verbatim", async (refusal, sentence) => {
    // One sentence per reason, from `personal-container.ts › personalShelfRefusal`, shared by three doors.
    mockReach.mockResolvedValue({ kind: "closed", refusal });

    const err = await resolveIdentityCreateDestination(ctx(), {
      homeScoped: true,
      visibility: "private",
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(PersonalContainerMissingError);
    expect(err!.message).toContain(sentence);
  });

  it("REFUSES, NEVER DOWNGRADES to the workspace shelf", async () => {
    // The workspace shelf is a different audience: a peer is standing in it.
    mockReach.mockResolvedValue({ kind: "closed", refusal: "unarmed_room" });

    await expect(
      resolveIdentityCreateDestination(ctx(), {
        homeScoped: true,
        visibility: "private",
      })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
  });

  it("asks the fence about THE CALLER, exactly once", async () => {
    // Passed whole (it satisfies `PersonalReachCaller`), never a container the input named.
    mockReach.mockResolvedValue({ kind: "open", containerId: CONTAINER });
    const caller = ctx();

    await resolveIdentityCreateDestination(caller, {
      homeScoped: true,
      visibility: "private",
    });

    expect(mockReach).toHaveBeenCalledTimes(1);
    expect(mockReach).toHaveBeenCalledWith(caller);
  });
});

describe("a TEAM identity is never personal — the grant cannot follow the row", () => {
  it("refuses homeScoped + team, and does not ask the fence at all", async () => {
    // Team grants are filed under the calling container, so a row that left for the shelf would have none.
    await expect(
      resolveIdentityCreateDestination(ctx({ source: "user" }), {
        homeScoped: true,
        visibility: "team",
      })
    ).rejects.toBeInstanceOf(IdentityTeamNotGrantableError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("leaves a team identity in the workspace untouched", async () => {
    expect(
      await resolveIdentityCreateDestination(ctx({ source: "user" }), {
        visibility: "team",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
  });
});
