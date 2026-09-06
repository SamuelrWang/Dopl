/**
 * 🔒 **WHERE A CREATE LANDS — THE FOUR ARMS OF `resolveCreateDestination`, AND
 * THE TWO IT MUST NOT ASK.** Gap 2 of #1077 (design), approved #1080; the seam
 * itself shipped with the A2 final slice and shipped with no test, which is the
 * hole this file closes.
 *
 * ⚠ **IT ASSERTS THE COLLABORATOR CALLS AS WELL AS THE ANSWERS, which is what
 * `shared/tenancy/personal-reach.test.ts` means by asserting the filters.** This
 * function issues no query of its own — it composes two fences — so the
 * equivalent of a filter here is WHICH fence it asked, WITH WHAT, and WHICH ONE
 * IT DID NOT ASK. Both halves are load bearing and for the same two reasons that
 * suite gives:
 *
 *   - **THE ORDER IS THE QUERY BUDGET.** A caller naming `homeScoped` must never
 *     pay for the audience ceiling (four reads inside a shared container), and an
 *     `unrestricted` caller must never pay for the personal fence. Every create
 *     in the product goes through here.
 *   - **THE FENCE IS ASKED, NEVER RE-IMPLEMENTED.** A4 (artifacts) is briefed to
 *     adopt this function, so it inherits one answer rather than a second
 *     opinion. A version that decided reach for itself would satisfy every
 *     answer-shaped assertion below while quietly half-opening the authz — and
 *     the argument it must be asked ABOUT THE CALLER, never about a
 *     caller-supplied container, is the same one that makes `personal-reach.ts`
 *     safe.
 *
 * ⚠ **THE REFUSALS ARE TWO DIFFERENT ERRORS AND THAT IS DELIBERATE.** A caller
 * that ASKED for the shelf gets `PersonalContainerMissingError` (403,
 * `PERSONAL_CONTAINER_MISSING`) naming why the shelf is out of reach; a caller
 * that asked for nothing and simply cannot create in the room gets the
 * unchanged `AgentWriteDisabledError`. Collapsing them would tell an agent that
 * never mentioned a shelf that its operator has one.
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
/** The ROOM — a link container with a peer in it, from the original report. */
const ROOM = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
/** The caller's OWN personal container. ⚠ Never equal to the room. */
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

/** The ceiling is ARMED — an agent in a room with somebody else in it. */
function restricted() {
  mockAudience.mockResolvedValue({
    kind: "granted",
    baseIds: new Set<string>(),
    channelIds: [CHANNEL],
  });
}

/** Today's behaviour: a human, a standard workspace, or a solo container. */
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

// ── ARM 1: THE CALLER ASKED FOR THE SHELF BY NAME ─────────────────────────

describe("🔒 homeScoped — asked for by name, so the fence alone decides", () => {
  it("lands on the caller's OWN container when the fence is open", async () => {
    open();

    expect(await resolveCreateDestination(ctx(), { homeScoped: true })).toEqual({
      homeScoped: true,
      workspaceId: CONTAINER,
    });
    // 🔒 THE FLAG AND THE ID TOGETHER. `insertBase` routes on the flag through
    // `personalWriteWorkspaceId` while the slug read and the rollback use the
    // id; answering with only one of them is how the two disagree about where
    // the row went.
  });

  it("⚠ NEVER PAYS FOR THE AUDIENCE CEILING — the budget, not a tidiness point", async () => {
    // ⚠ MUTATION CHECK. Asking `resolveAgentAudience` here would put up to four
    // reads (workspace kind, member count, channel ids, grant rows) on every
    // personal create, and it cannot change the answer: the destination is a
    // container with one member, whose ceiling is `unrestricted` by
    // construction. Order IS the query budget, exactly as the fence's own suite
    // argues for its reads.
    open();

    await resolveCreateDestination(ctx(), { homeScoped: true });

    expect(mockAudience).not.toHaveBeenCalled();
  });

  it("🔒 REFUSES, NEVER DOWNGRADES, when the fence is closed", async () => {
    // 🔒 THE DIRECTION THAT MATTERS. The workspace shelf is a DIFFERENT
    // audience, not a lesser one — falling back to the room would silently
    // publish a row the caller meant to keep on their own shelf into a
    // container a peer is standing in. `personal-container.ts`'s "refuse, never
    // downgrade" rule, on the gate.
    closed("unarmed_room");

    await expect(
      resolveCreateDestination(ctx(), { homeScoped: true })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
  });

  it("names the REMEDY on an unarmed room, and arming is human-only", async () => {
    // ⚠ A refusal with no cause is what sends an agent to grep the repo. This
    // is also the one place `unarmed_room` may be spoken: a WRITE has no silent
    // form, and the only person who learns anything is the OWNER, about their
    // OWN shelf in their OWN room. ⚠ It must never reach a READ path, where an
    // unarmed room has to answer what an empty one answers.
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
    // ⚠ ONE SENTENCE PER REASON, WRITTEN ONCE (`personal-container.ts ›
    // personalShelfRefusal`) and shared with the ROUTER and the agent-templates
    // twin. A hand-mirrored copy is two refusals that stop agreeing about the
    // remedy.
    closed(refusal);

    const err = await resolveCreateDestination(ctx(), { homeScoped: true }).then(
      () => null,
      (e: Error) => e
    );

    expect(err!.message).toContain(sentence);
  });

  it("🔒 asks the fence about THE CALLER, standing in THE ROOM", async () => {
    // ⚠ MUTATION CHECK, and the reason the composition is safe: the fence is
    // asked, never re-implemented, and it is asked about the context this
    // request already proved — never about a container named in the input. Key
    // it on anything the caller supplies and the gate becomes a door into any
    // shelf.
    open();
    const caller = ctx();

    await resolveCreateDestination(caller, { homeScoped: true });

    expect(mockReach).toHaveBeenCalledTimes(1);
    expect(mockReach).toHaveBeenCalledWith(caller);
  });
});

// ── ARM 2: THE CEILING IS OPEN — EVERY PATH THAT WORKS TODAY ──────────────

describe("⚠ an UNRESTRICTED audience lands in the calling container, as it always did", () => {
  it("answers the room, and does not ask the personal fence at all", async () => {
    // 🔒 "IT CHANGES NOTHING THAT WORKS TODAY" IS AN ASSERTION, not a claim in
    // a docblock. A human, a standard workspace and a solo container are the
    // three `unrestricted` branches; every one of them must land exactly where
    // it landed before the seam existed.
    unrestricted();

    expect(await resolveCreateDestination(ctx({ source: "user" }), {})).toEqual({
      homeScoped: false,
      workspaceId: ROOM,
    });
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("⚠ answers `homeScoped: false`, not absent — the router reads `!== true`", async () => {
    // The two are the same instruction to `personalWriteWorkspaceId`, and the
    // explicit `false` is what lets the destination be ONE shape with both
    // fields always present. A caller reading the flag can never find it
    // missing and guess.
    unrestricted();

    const destination = await resolveCreateDestination(ctx(), {});

    expect(destination.homeScoped).toBe(false);
  });

  it("does not re-route a create that names a CHANNEL or a TEAM either", async () => {
    // Both name the calling container in as many words, so neither is a
    // personal row — and this arm reaches them before any fence runs.
    unrestricted();

    expect(
      await resolveCreateDestination(ctx(), { shareToChannelId: CHANNEL })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
    expect(
      await resolveCreateDestination(ctx(), { wantsTeams: true })
    ).toEqual({ homeScoped: false, workspaceId: ROOM });
  });
});

// ── ARM 3: RESTRICTED, BUT THE SHELF IS REACHABLE ─────────────────────────

describe("🔒 a RESTRICTED audience follows its OWNER when the room is armed", () => {
  it("re-routes to the personal container instead of refusing", async () => {
    // 🔒 GAP 2 ITSELF (#1077): *"a create with no valid container in a shared
    // room should go to the caller's own personal container, not refuse —
    // personal-visibility creates resolve their container by OWNER, never by
    // call site."* ⚠ The only creates this moves are the ones the read-back
    // gate was already refusing outright, so no working path changes.
    restricted();
    open();

    expect(await resolveCreateDestination(ctx(), {})).toEqual({
      homeScoped: true,
      workspaceId: CONTAINER,
    });
  });

  it("🔒 the READ-BACK GUARANTEE is the OPEN fence, and it is asked every time", async () => {
    // ⚠ MUTATION CHECK for the half-open shortcut A4 would inherit. The reason
    // this is not a way around F-323's gate is that the row lands in a
    // container with ONE member, where the audience is `unrestricted` by
    // construction — and that is true only because the fence said OPEN. A
    // version that re-routed without asking would write rows into a shelf the
    // caller has no reach to.
    restricted();
    open();

    await resolveCreateDestination(ctx(), {});

    expect(mockReach).toHaveBeenCalledTimes(1);
  });
});

// ── ARM 4: RESTRICTED AND CLOSED — F-323's REFUSAL, UNCHANGED ─────────────

describe("🔒 RESTRICTED and out of reach keeps F-323's refusal", () => {
  it("refuses an unarmed shared room with the ROOM error, not the shelf one", async () => {
    // ⚠ THE TWO ERRORS ARE NOT INTERCHANGEABLE. This caller never mentioned a
    // shelf, so it is told what it was always told: an agent cannot create a
    // base here. Answering `PERSONAL_CONTAINER_MISSING` would disclose that its
    // operator has a personal container and that this room is not armed for it,
    // to a caller that asked about neither.
    restricted();
    closed("unarmed_room");

    const err = await resolveCreateDestination(ctx(), {}).then(
      () => null,
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(AgentWriteDisabledError);
    expect(err).not.toBeInstanceOf(PersonalContainerMissingError);
    // The unchanged sentence: WHY (no grant → invisible), WHO can fix it, and
    // WHAT ELSE to do — now including arming as a third remedy.
    expect(err!.message).toContain("shared home channel");
    expect(err!.message).toContain("Ask your operator");
  });

  it("🔒 a create naming a CHANNEL is refused WITHOUT asking the fence", async () => {
    // 🔒 `shareToChannelId` NAMES THE ROOM, and a grant cannot follow a row out
    // of it. ⚠ MUTATION CHECK: re-routing this would land the base on the
    // personal shelf and then try to grant it into a channel of a container it
    // no longer lives in. Refused before the fence is even asked.
    restricted();

    await expect(
      resolveCreateDestination(ctx(), { shareToChannelId: CHANNEL })
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("🔒 a TEAMS create is refused WITHOUT asking the fence, for the same reason", async () => {
    // A team lives in the calling container too, so a personal row could never
    // carry the grant the caller asked for.
    restricted();

    await expect(
      resolveCreateDestination(ctx(), { wantsTeams: true })
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockReach).not.toHaveBeenCalled();
  });

  it("⚠ `homeScoped` BEATS both, because the caller named the shelf", async () => {
    // Order check: the shelf arm runs FIRST, so a caller that explicitly asked
    // for its own shelf is answered by the fence rather than by the room's
    // ceiling — and gets the shelf's own refusal when it is closed.
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
