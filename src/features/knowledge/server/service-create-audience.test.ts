/**
 * 🔒 **A CREATE MUST NOT WRITE A ROW ITS OWN CREATOR CANNOT READ BACK** — the
 * AUTHORING half of F-323, closed here, and the bug Samuel reported against
 * `dopl_kb(op="create_base")` in a shared home channel.
 *
 * WHAT WAS OBSERVED: two identical successes ("Created knowledge base … Private
 * to you"), a `list_bases` that never showed it, a slug that would not resolve,
 * and nothing in the caller's default workspace either.
 *
 * WHAT WAS HAPPENING: every one of those is one fact. The row WAS written, into
 * the right workspace. `resolveAgentAudience` answers `granted` for an agent in
 * a `kind='link'` container holding a PEER — reachable = the bases carrying a
 * channel GRANT — and every READ composes that filter while `createBase`
 * composed nothing. A new base has no grant by construction, so it was
 * unreachable to its creator from the very next call. An agent that cannot see
 * a failure retries, which is why there were two.
 *
 * ⚠ THE SUITE PINS THE PREMISE TOO, not just the refusal. "The base would have
 * been invisible" is the entire justification, so it is asserted directly
 * (`the premise` below) rather than left as a claim in a comment — if the
 * ceiling ever stops filtering a fresh base, this guard should be reconsidered,
 * and that should go red here rather than being noticed years later.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository-audience", () => ({
  findWorkspaceKind: vi.fn(),
  countActiveWorkspaceMembers: vi.fn(),
  listChannelIdsForWorkspace: vi.fn(),
  listGrantedBaseIdsForChannels: vi.fn(),
}));

vi.mock("./repository", () => ({
  insertBase: vi.fn(),
  listBaseSlugsForWorkspace: vi.fn(),
  listBasesForWorkspace: vi.fn(),
  findBaseById: vi.fn(),
  findBaseBySlug: vi.fn(),
  hardDeleteBase: vi.fn(),
}));

// ⚠ **THE A2 SLICE PUT A SECOND FENCE UNDER THIS SUITE'S SUBJECT.** `createBase`
// no longer refuses a restricted audience outright — it asks
// `personal-reach.ts` whether the caller's own shelf is reachable from this
// room, and follows the OWNER when it is (gap 2 of #1077). Defaulted CLOSED
// here, which is an UNARMED room and therefore the exact world every case below
// was written in: the refusals are unchanged facts, not survivals.
vi.mock("@/shared/tenancy/personal-reach", () => ({
  resolvePersonalReach: vi.fn(),
  personalShelfContainerIds: vi.fn(async () => []),
}));

import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";
import * as repo from "./repository";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import { createBase } from "./service-base-writes";
import { getBaseBySlug, listBases } from "./service-bases";
import { AgentWriteDisabledError } from "./errors";

const mockKind = vi.mocked(findWorkspaceKind);
const mockCount = vi.mocked(countActiveWorkspaceMembers);
const mockChannels = vi.mocked(listChannelIdsForWorkspace);
const mockGrants = vi.mocked(listGrantedBaseIdsForChannels);
const mockRepo = vi.mocked(repo);

const CHANNEL_A = "aaaaaaaa-0000-4000-8000-000000000001";
/** The container from the report — a home channel with TWO members in it. */
const CONTAINER = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
const STANDARD = "ws-standard";

function agentCtx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: CONTAINER,
    userId: "u-operator",
    role: "owner",
    source: "agent",
    apiKeyWorkspaceId: CONTAINER,
    credentialSubjectUserId: "u-operator",
    sessionId: null,
    ...over,
  };
}

function base(id: string, slug: string, workspaceId = CONTAINER): KnowledgeBase {
  return {
    id,
    workspaceId,
    name: "Notes",
    slug,
    visibility: "private",
    accessMode: "workspace",
    createdBy: "u-operator",
    agentWriteEnabled: true,
  } as KnowledgeBase;
}

/** A link container with a PEER in it — the ceiling is ARMED. */
function sharedContainer(grantedBaseIds: string[] = []) {
  mockKind.mockResolvedValue("link");
  mockCount.mockResolvedValue(2);
  mockChannels.mockResolvedValue([CHANNEL_A]);
  mockGrants.mockResolvedValue(grantedBaseIds);
}

/** The same container with nobody else in it — `unrestricted`, untouched. */
function soloContainer() {
  mockKind.mockResolvedValue("link");
  mockCount.mockResolvedValue(1);
}

const mockReach = vi.mocked(resolvePersonalReach);
/** The operator's OWN personal container. ⚠ Never the room. */
const PERSONAL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listBaseSlugsForWorkspace.mockResolvedValue([]);
  // ⚠ UNARMED IS THE DEFAULT WORLD OF THIS FILE, and it is the fail-closed one:
  // an agent in a room its operator has not armed reaches no shelf, so every
  // refusal below is measured under exactly the conditions it was written for.
  mockReach.mockResolvedValue({ kind: "closed", refusal: "unarmed_room" });
  mockRepo.insertBase.mockImplementation(
    async (args: { workspaceId: string; slug: string }) =>
      base("kb-new", args.slug, args.workspaceId)
  );
});

// ── The premise: why a refusal, and not a warning ────────────────────

describe("the premise — a fresh base in a shared container is unreachable", () => {
  it("an ungranted base is filtered out of the creator's OWN list", async () => {
    sharedContainer([]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([base("kb-new", "notes")]);

    expect(await listBases(agentCtx())).toEqual([]);
  });

  it("...and its slug does not resolve either — both halves of the report", async () => {
    sharedContainer([]);
    mockRepo.findBaseBySlug.mockResolvedValue(base("kb-new", "notes"));

    await expect(getBaseBySlug(agentCtx(), "notes")).rejects.toThrow();
  });

  it("a GRANTED base in the same container is reachable, so the filter is real", async () => {
    sharedContainer(["kb-new"]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([base("kb-new", "notes")]);

    expect(await listBases(agentCtx())).toHaveLength(1);
  });
});

// ── The fix: refuse, and write nothing ───────────────────────────────

describe("createBase refuses where the creator could not read it back", () => {
  it("REGRESSION: an agent creating in a 2-member home channel is REFUSED", async () => {
    sharedContainer([]);

    await expect(
      createBase(agentCtx(), { name: "Notes" } as never)
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
  });

  it("and NO row is written — the orphan never exists to be retried onto", async () => {
    sharedContainer([]);

    await expect(createBase(agentCtx(), { name: "Notes" } as never)).rejects.toThrow();

    // ⚠ The whole point. Two calls used to leave two invisible rows, each
    // holding a slug the next attempt then collided with.
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
    // ⚠ Refused BEFORE the slug read too: a caller that may not create here is
    // told so without spending a round trip, and is never handed a slug
    // collision against a row it cannot see.
    expect(mockRepo.listBaseSlugsForWorkspace).not.toHaveBeenCalled();
  });

  it("names the room and the remedy, not just a refusal", async () => {
    sharedContainer([]);

    const err = await createBase(agentCtx(), { name: "Notes" } as never).then(
      () => null,
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(AgentWriteDisabledError);
    const message = err!.message;

    // ⚠ A refusal an agent cannot explain sends it to grep the repo. This one
    // says WHY (no grant → invisible), WHO can fix it, and WHAT ELSE to do.
    expect(message).toContain("shared home channel");
    expect(message).toContain("grant");
    expect(message).toContain("human-only");
    expect(message).toContain("Ask your operator");
  });

  it("create-and-share is refused the same way, and equally writes nothing", async () => {
    // ⚠ It was ALREADY a refusal — `setChannelKnowledgeGrant` rejects an agent
    // — but only AFTER inserting the row and then hard-deleting it. Now it
    // never gets that far.
    sharedContainer([]);

    await expect(
      createBase(agentCtx(), {
        name: "Notes",
        shareToChannelId: CHANNEL_A,
      } as never)
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteBase).not.toHaveBeenCalled();
  });
});

// ── ARMED: the refusal becomes a RE-ROUTE, and only then ─────────────

describe("🔒 an ARMED room sends the create to its OWNER instead of refusing", () => {
  /** The owner has armed this room for their personal shelf (#1077 gap 2). */
  function armed() {
    mockReach.mockResolvedValue({ kind: "open", containerId: PERSONAL });
  }

  it("writes the base into the caller's OWN container, not the room", async () => {
    // 🔒 THE READ-BACK GUARANTEE MOVED TO THE DESTINATION, which is the whole
    // repair: the premise at the top of this file is about the ROOM's ceiling,
    // and a personal row does not land there. In a container with one member
    // the audience is `unrestricted` by construction, so an OPEN fence IS the
    // guarantee rather than a way around the gate.
    sharedContainer([]);
    armed();

    const created = await createBase(agentCtx(), { name: "Notes" } as never);

    expect(created.workspaceId).toBe(PERSONAL);
    expect(mockRepo.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: PERSONAL, homeScoped: true })
    );
  });

  it("🔒 and the slug is read in the DESTINATION, never in the room", async () => {
    // ⚠ MUTATION CHECK. A slug read against the room would collide the new row
    // against names it will never share a container with, and — worse — report
    // a conflict with a base the caller cannot see.
    sharedContainer([]);
    armed();

    await createBase(agentCtx(), { name: "Notes" } as never);

    expect(mockRepo.listBaseSlugsForWorkspace).toHaveBeenCalledWith(PERSONAL);
  });

  it("🔒 an ARMED room still refuses create-AND-SHARE — the room is named", async () => {
    // 🔒 A GRANT CANNOT FOLLOW A ROW OUT OF ITS CONTAINER. `shareToChannelId`
    // names a channel of THIS room, so a personal destination would leave the
    // grant pointing at a container the base does not live in. Arming widens
    // where a row may LAND; it does not make a channel grant portable.
    sharedContainer([]);
    armed();

    await expect(
      createBase(agentCtx(), {
        name: "Notes",
        shareToChannelId: CHANNEL_A,
      } as never)
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
  });
});

// ── …and narrows nothing else. The ceiling only ever closes. ─────────

describe("create → list → resolve still works wherever the ceiling is open", () => {
  /** The acceptance criterion: create, then LIST it, then RESOLVE its slug. */
  async function createThenRead(ctx: KnowledgeContext) {
    const created = await createBase(ctx, { name: "Notes" } as never);
    mockRepo.listBasesForWorkspace.mockResolvedValue([created]);
    mockRepo.findBaseBySlug.mockResolvedValue(created);
    return {
      created,
      listed: await listBases(ctx),
      resolved: await getBaseBySlug(ctx, created.slug),
    };
  }

  it("SOLO container — the operator's own primary agent surface", async () => {
    soloContainer();

    const { created, listed, resolved } = await createThenRead(agentCtx());

    expect(created.id).toBe("kb-new");
    expect(listed).toHaveLength(1);
    expect(resolved.id).toBe("kb-new");
  });

  it("standard workspace — an agent creating where it always could", async () => {
    mockKind.mockResolvedValue("standard");

    const { listed, resolved } = await createThenRead(
      agentCtx({ workspaceId: STANDARD, apiKeyWorkspaceId: STANDARD })
    );

    expect(listed).toHaveLength(1);
    expect(resolved.id).toBe("kb-new");
    // ⚠ A human caller costs ZERO ceiling reads and an agent in a standard
    // workspace exactly ONE — the guard must not have changed that budget.
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("a HUMAN in the very same shared container is unaffected", async () => {
    sharedContainer([]);

    const { listed } = await createThenRead(agentCtx({ source: "user" }));

    expect(listed).toHaveLength(1);
    // ⚠ `ctx.source !== "agent"` short-circuits before any ceiling read.
    expect(mockKind).not.toHaveBeenCalled();
  });
});
