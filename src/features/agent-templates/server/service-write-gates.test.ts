/**
 * 🔒 **THE TEMPLATE CREATE'S ASKING SEAM — the write half of task 11's fence,
 * which this feature was missing.** Twin of
 * `knowledge/server/service-base-gates.test.ts`, and the differences between the
 * two suites are the differences between the two gates rather than drift; read
 * `service-write-gates.ts`'s header for why one is not the other.
 *
 * 🔒 **THE HOLE IT PINS SHUT.** `createTemplate` handed `input.homeScoped`
 * straight to the repository, and `personalWriteWorkspaceId` routes on it by
 * AUTHOR. So an agent standing in a shared room could put a row on its
 * operator's personal shelf by naming a flag — the same shelf `personal-reach.ts`
 * will not let it so much as ENUMERATE until the owner arms the room. A fence
 * that closes the read and leaves the write open is not a fence, and A4
 * (artifacts) is briefed to inherit this shape.
 *
 * ⚠ **IT ASSERTS WHAT THE GATE ASKED, NOT ONLY WHAT IT ANSWERED** — the same
 * thing `shared/tenancy/personal-reach.test.ts` means by asserting its filters.
 * The fence must be ASKED (never re-implemented, or there are two opinions about
 * one owner's reach) and asked ABOUT THE CALLER (never about anything the input
 * supplied, or the gate is a door into any shelf).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTemplateContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(),
  personalShelfContainerIds: vi.fn(),
}));

import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import { PersonalContainerMissingError } from "@/shared/tenancy/personal-container";
import { resolveTemplateCreateDestination } from "./service-write-gates";
import { TemplateTeamNotGrantableError } from "./errors";

const mockReach = vi.mocked(resolvePersonalReach);

const ME = "u-operator";
/** A shared room — a container with a peer in it. */
const ROOM = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
/** The caller's OWN personal container. ⚠ Never equal to the room. */
const CONTAINER = "33333333-3333-4333-8333-333333333333";

function ctx(over: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
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

// ── NOBODY ASKED FOR A SHELF ──────────────────────────────────────────────

describe("⚠ a create nobody re-routed lands in the calling container", () => {
  it.each([
    ["absent", undefined],
    ["false", false],
  ])("answers the room for a %s flag, without asking the fence", async (_l, flag) => {
    // 🔒 "IT CHANGES NOTHING THAT WORKS TODAY", asserted rather than claimed.
    // ⚠ AND THE BUDGET: a fence read on every template create would price the
    // Agents page and the launch picker for a question neither one asked.
    expect(
      await resolveTemplateCreateDestination(ctx(), {
        homeScoped: flag,
        visibility: "private",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("🔒 …including an AGENT in a shared room, which has no twin of the KB re-route", async () => {
    // 🔒 THE DELIBERATE ASYMMETRY WITH `resolveCreateDestination`, pinned so a
    // later reader does not "restore" the missing arm. Knowledge re-routes a
    // RESTRICTED audience because F-323 is real there: a base created in a
    // shared container is filtered out of its own creator's next read. A
    // template has no such ceiling — `canSeeTemplate` arm 3 answers for the
    // CREATOR, and since F-333 a container session IS the operator — so there
    // is nothing to rescue, and re-routing here would move rows on a path that
    // works today.
    expect(
      await resolveTemplateCreateDestination(ctx({ source: "agent" }), {
        visibility: "private",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(mockReach).not.toHaveBeenCalled();
  });
});

// ── THE CALLER ASKED FOR THE SHELF ────────────────────────────────────────

describe("🔒 homeScoped — the fence decides, and it is finally asked", () => {
  it("lands on the caller's OWN container when the fence is open", async () => {
    mockReach.mockResolvedValue({ kind: "open", containerId: CONTAINER });

    expect(
      await resolveTemplateCreateDestination(ctx(), {
        homeScoped: true,
        visibility: "private",
      })
    ).toEqual({ homeScoped: true, workspaceId: CONTAINER });
  });

  it("🔒 REFUSES an agent in an UNARMED shared room — the hole this gate closes", async () => {
    // 🔒 THE REGRESSION CASE. Before this gate the same call wrote the row: the
    // flag reached `personalWriteWorkspaceId`, which resolves the container by
    // AUTHOR and asks nobody whether this caller may reach it from here. The
    // fence's own suite proves the READ was already closed for this caller;
    // this is the WRITE finally agreeing with it.
    mockReach.mockResolvedValue({ kind: "closed", refusal: "unarmed_room" });

    const err = await resolveTemplateCreateDestination(ctx(), {
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
    // ⚠ ONE SENTENCE PER REASON, WRITTEN ONCE in `personal-container.ts ›
    // personalShelfRefusal` and thrown by three doors — this gate, the
    // knowledge gate and the router. A hand-mirrored copy is how two refusals
    // stop agreeing about the remedy, which is the same failure the shelf fence
    // itself had before B15 collapsed its two copies.
    mockReach.mockResolvedValue({ kind: "closed", refusal });

    const err = await resolveTemplateCreateDestination(ctx(), {
      homeScoped: true,
      visibility: "private",
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(PersonalContainerMissingError);
    expect(err!.message).toContain(sentence);
  });

  it("🔒 REFUSES, NEVER DOWNGRADES to the workspace shelf", async () => {
    // 🔒 `personal-container.ts`'s own rule. The workspace shelf is a DIFFERENT
    // audience, not a lesser one: silently landing there would put a row the
    // caller meant to keep personal into a container a peer is standing in.
    mockReach.mockResolvedValue({ kind: "closed", refusal: "unarmed_room" });

    await expect(
      resolveTemplateCreateDestination(ctx(), {
        homeScoped: true,
        visibility: "private",
      })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
  });

  it("🔒 asks the fence about THE CALLER, exactly once", async () => {
    // ⚠ MUTATION CHECK, and the reason the composition is safe. The fence is
    // asked about the context this request already proved — never about a
    // container the input named. `AgentTemplateContext` satisfies
    // `PersonalReachCaller` structurally, which is why it is passed whole
    // rather than re-shaped into fields that could be re-shaped wrongly.
    mockReach.mockResolvedValue({ kind: "open", containerId: CONTAINER });
    const caller = ctx();

    await resolveTemplateCreateDestination(caller, {
      homeScoped: true,
      visibility: "private",
    });

    expect(mockReach).toHaveBeenCalledTimes(1);
    expect(mockReach).toHaveBeenCalledWith(caller);
  });
});

// ── A `team` ROW NAMES THE ROOM ───────────────────────────────────────────

describe("🔒 a TEAM template is never personal — the grant cannot follow the row", () => {
  it("refuses homeScoped + team, and does not ask the fence at all", async () => {
    // 🔒 THE SAME RULE `resolveCreateDestination` APPLIES TO `shareToChannelId`
    // AND TO A TEAMS CREATE: a team belongs to the calling container and its
    // grant row is filed under that container's `workspace_id`, so a row that
    // left for the personal shelf takes its grants nowhere.
    //
    // ⚠ IT REPLACES AN INCOHERENCE, NOT A WORKING PATH. That combination
    // already wrote the row into the container while `replaceTeamLinks` wrote
    // its grants to the room, and `listTeamLinksForTemplates` filters by the
    // ROW's container — so the template came back `team`-visible with no teams,
    // to nobody.
    await expect(
      resolveTemplateCreateDestination(ctx({ source: "user" }), {
        homeScoped: true,
        visibility: "team",
      })
    ).rejects.toBeInstanceOf(TemplateTeamNotGrantableError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("leaves a team template in the workspace untouched", async () => {
    // The ordinary team create names no shelf and is not this gate's business.
    expect(
      await resolveTemplateCreateDestination(ctx({ source: "user" }), {
        visibility: "team",
      })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
  });
});
