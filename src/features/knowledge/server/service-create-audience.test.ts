/**
 * A create must not write a row its own creator cannot read back — the AUTHORING
 * half of F-323, closed here.
 *
 * `resolveAgentAudience` answers `granted` for an agent in a `kind='link'`
 * container holding a peer (reachable = bases carrying a channel grant), and
 * every read composes that filter while `createBase` composed none — so a fresh
 * base was unreachable to its creator from the very next call.
 *
 * The premise is asserted directly (`the premise` below), not just the refusal:
 * if the ceiling ever stops filtering a fresh base, this guard goes red here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

// The changelog capture is a real awaited write (`./service-revisions.ts`,
// 2026-09-09), so an unstubbed service test reaches `supabaseAdmin()` and fails
// on a missing service-role key. That the row is recorded once per path is
// `service-revisions.test.ts`'s subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

// ⚠ **`findWorkspaceById` MOCKED SINCE 2026-09-18**: a private create now asks
// `workspaces/server/home-channel-destination.ts › assertHomeChannelRowIsShared`
// where the row is LANDING, and that reads the workspace row. Answered as a
// STANDARD workspace, the kind the rule leaves alone, so this file keeps
// measuring its own subject — every direction of the rule itself is
// `workspaces/server/home-channel-destination.test.ts`.
vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(async () => ({ id: "ws-1", kind: "standard" })),
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

// A2: `createBase` no longer refuses a restricted audience outright — it asks
// `home-space-reach.ts` whether the caller's own shelf is reachable from this room
// and follows the owner when it is (gap 2 of #1077). Defaulted CLOSED here: an
// unarmed room, the world every case below was written in.
vi.mock("@/shared/tenancy/home-space-reach", () => ({
  resolveHomeSpaceReach: vi.fn(),
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";
import * as repo from "./repository";
import { resolveHomeSpaceReach } from "@/shared/tenancy/home-space-reach";
import { assertCreateBaseAllowed, createBase } from "./service-base-writes";
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

const mockReach = vi.mocked(resolveHomeSpaceReach);
/** The operator's OWN home space. Never the room. */
const PERSONAL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listBaseSlugsForWorkspace.mockResolvedValue([]);
  // unarmed is the default world of this file, and the fail-closed one: every
  // refusal below is measured under the conditions it was written for.
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

    // two calls used to leave two invisible rows, each holding a slug the next
    // attempt then collided with.
    expect(mockRepo.insertBase).not.toHaveBeenCalled();
    // refused before the slug read: never hands back a collision against a row
    // the caller cannot see.
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

    // the message says why (no grant → invisible), who can fix it, and what else
    // to do.
    expect(message).toContain("shared home channel");
    expect(message).toContain("grant");
    expect(message).toContain("human-only");
    expect(message).toContain("Ask your operator");
  });

  it("create-and-share is refused the same way, and equally writes nothing", async () => {
    // already a refusal via `setChannelKnowledgeGrant`, but only after inserting
    // the row and hard-deleting it. Now it never gets that far.
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
  /** The owner has armed this room for their home shelf (#1077 gap 2). */
  function armed() {
    mockReach.mockResolvedValue({ kind: "open", containerId: PERSONAL });
  }

  it("writes the base into the caller's OWN container, not the room", async () => {
    // the read-back guarantee moves to the destination: the premise at the top of
    // this file is about the ROOM's ceiling and a personal row does not land
    // there. A one-member container is `unrestricted` by construction.
    sharedContainer([]);
    armed();

    const created = await createBase(agentCtx(), { name: "Notes" } as never);

    expect(created.workspaceId).toBe(PERSONAL);
    expect(mockRepo.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: PERSONAL, homeScoped: true })
    );
  });

  it("🔒 and the slug is read in the DESTINATION, never in the room", async () => {
    // mutation check: a slug read against the room would report a conflict with a
    // base the caller cannot see.
    sharedContainer([]);
    armed();

    await createBase(agentCtx(), { name: "Notes" } as never);

    expect(mockRepo.listBaseSlugsForWorkspace).toHaveBeenCalledWith(PERSONAL);
  });

  it("🔒 an ARMED room still refuses create-AND-SHARE — the room is named", async () => {
    // a grant cannot follow a row out of its container: `shareToChannelId` names
    // a channel of THIS room. Arming widens where a row may land; it does not
    // make a channel grant portable.
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

// ── the dry run answers what the confirmed call answers ────────────────
//
// A preview must never promise a create the confirm would refuse (observed
// 2026-09-06): the token is minted in the MCP process, which cannot see a grant
// row or an arming row. Parity is asserted through both doors on ONE world —
// `assertCreateBaseAllowed` is tested for saying the same thing `createBase`
// says, not against its own expectations.
describe("🔒 the dry run runs the SAME gate, and writes nothing", () => {
  /** The owner has armed this room for their home shelf (#1077 gap 2). */
  function armed() {
    mockReach.mockResolvedValue({ kind: "open", containerId: PERSONAL });
  }

  it("REFUSES where the create refuses — the unarmed shared room", async () => {
    sharedContainer([]);

    await expect(
      assertCreateBaseAllowed(agentCtx(), { name: "Notes" } as never)
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
    await expect(
      createBase(agentCtx(), { name: "Notes" } as never)
    ).rejects.toBeInstanceOf(AgentWriteDisabledError);
  });

  it("...with the SAME SENTENCE, so a preview cannot soften the refusal", async () => {
    // one message, two doors: a gentler preview refusal reads as "not yet".
    sharedContainer([]);
    const fail = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

    expect(
      await fail(assertCreateBaseAllowed(agentCtx(), { name: "Notes" } as never))
    ).toBe(await fail(createBase(agentCtx(), { name: "Notes" } as never)));
  });

  it("ALLOWS where the create lands, and names the same destination", async () => {
    sharedContainer([]);
    armed();

    const preconditions = await assertCreateBaseAllowed(agentCtx(), {
      name: "Notes",
    } as never);
    const created = await createBase(agentCtx(), { name: "Notes" } as never);

    // the same container, asked twice: the preview claims WHERE as well as WHETHER.
    expect(preconditions.destination.workspaceId).toBe(PERSONAL);
    expect(created.workspaceId).toBe(PERSONAL);
  });

  it("is a GATE, not a create: no row, no slug read, nothing rolled back", async () => {
    // if the dry run wrote anything, every previewed create would leave a row
    // behind for an act the operator has not confirmed.
    sharedContainer([]);
    armed();

    await assertCreateBaseAllowed(agentCtx(), { name: "Notes" } as never);

    expect(mockRepo.insertBase).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteBase).not.toHaveBeenCalled();
    // and no slug read — a dry run must not become a way to probe a container's
    // names one create body at a time.
    expect(mockRepo.listBaseSlugsForWorkspace).not.toHaveBeenCalled();
  });

  it("answers the RESOLVED visibility, which is what the preview describes", async () => {
    // the visibility the row LANDS at, not the one the caller typed: an absent
    // `visibility` resolves to private for a session caller.
    soloContainer();

    const preconditions = await assertCreateBaseAllowed(agentCtx(), {
      name: "Notes",
    } as never);

    expect(preconditions.visibility).toBe("private");
    expect(preconditions.destination.workspaceId).toBe(CONTAINER);
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
    // budget: a human costs zero ceiling reads, an agent in a standard workspace
    // exactly one.
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("a HUMAN in the very same shared container is unaffected", async () => {
    sharedContainer([]);

    const { listed } = await createThenRead(agentCtx({ source: "user" }));

    expect(listed).toHaveLength(1);
    // `ctx.source !== "agent"` short-circuits before any ceiling read.
    expect(mockKind).not.toHaveBeenCalled();
  });
});
