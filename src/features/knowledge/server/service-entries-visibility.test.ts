/**
 * Entry reads are gated on their base. `service-entries.ts › getEntry` checked
 * only `assertSameWorkspace` while its route runs at the viewer default, so
 * three fences were bypassable by id: the M-10 visibility gate (any viewer could
 * pull the body of an entry in a private base), the container-locked credential
 * tightening, and the audience ceiling. Ids are cheap — ontology attributes of
 * `kind:"knowledge"` ship raw entry-id arrays — so "you need the id" was never
 * the fence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

// The grant arm is a DB read, so it is declared here (F-604, 2026-09-02). Every
// case in this file is about the other arms, so the grant set is empty; grant
// cases live in `service-shared-grant-arm.test.ts` and the redteam suites.
vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

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
  findEntryById: vi.fn(),
  findBaseById: vi.fn(),
  listEntriesByIds: vi.fn(),
  listBasesByIds: vi.fn(),
  listBasesForWorkspace: vi.fn(),
  findBaseBySlug: vi.fn(),
}));

// Embeddings are fire-and-forget and irrelevant here; the real module reaches a
// background client the moment it is imported.
vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));

import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";
import * as repo from "./repository";
import { getEntry, resolveEntryRefs } from "./service-entries";
import { EntryNotFoundError, KnowledgeBaseNotFoundError } from "./errors";

const mockKind = vi.mocked(findWorkspaceKind);
const mockCount = vi.mocked(countActiveWorkspaceMembers);
const mockChannels = vi.mocked(listChannelIdsForWorkspace);
const mockGrants = vi.mocked(listGrantedBaseIdsForChannels);
const mockRepo = vi.mocked(repo);

const WS = "ws-1";
const OWNER = "u-owner";
const OTHER = "u-other";
const CHANNEL_A = "aaaaaaaa-0000-4000-8000-000000000001";

function ctx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: WS,
    userId: OTHER,
    role: "viewer",
    source: "user",
    apiKeyWorkspaceId: null,
    sessionId: null,
    credentialSubjectUserId: OTHER,
    ...over,
  };
}

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    name: "Base",
    workspaceId: WS,
    visibility: "public",
    accessMode: "workspace",
    createdBy: OWNER,
    agentWriteEnabled: true,
    deletedAt: null,
    ...over,
  } as KnowledgeBase;
}

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "e-1",
    workspaceId: WS,
    knowledgeBaseId: "kb-1",
    title: "Q3 numbers",
    body: "the body nobody outside the base may read",
    folderId: null,
    ...over,
  } as KnowledgeEntry;
}

/** Link container, two members, one channel, the named bases granted. */
function sharedContainer(grantedBaseIds: string[]) {
  mockKind.mockResolvedValue("link");
  mockCount.mockResolvedValue(2);
  mockChannels.mockResolvedValue([CHANNEL_A]);
  mockGrants.mockResolvedValue(grantedBaseIds);
}

/** Standard workspace — the ceiling answers `unrestricted`, so an assertion
 *  sees the visibility gate alone. */
function standardWorkspace() {
  mockKind.mockResolvedValue("standard");
}

beforeEach(() => {
  vi.clearAllMocks();
  standardWorkspace();
});

describe("getEntry — the base's visibility answers for its entries", () => {
  it("a workspace VIEWER cannot read an entry in someone else's PRIVATE base", async () => {
    // The widest case: no agent, no container, no API key — a plain teammate
    // with the entry id.
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(
      base({ visibility: "private", createdBy: OWNER })
    );

    await expect(getEntry(ctx(), "e-1")).rejects.toBeInstanceOf(
      EntryNotFoundError
    );
  });

  it("the refusal is ENTRY-shaped, never the base's error — existence is not an oracle", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(
      base({ visibility: "private", createdBy: OWNER })
    );

    // Same class an id that resolves to nothing gets, so the two are one answer.
    await expect(getEntry(ctx(), "e-1")).rejects.not.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("the base's CREATOR still reads their own private base's entry", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(
      base({ visibility: "private", createdBy: OWNER })
    );

    expect((await getEntry(ctx({ userId: OWNER }), "e-1")).id).toBe("e-1");
  });

  it("a PUBLIC base's entry is unaffected — the gate only ever CLOSES", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(base({ visibility: "public" }));

    expect((await getEntry(ctx(), "e-1")).id).toBe("e-1");
  });

  it("M-10: a WORKSPACE-SCOPED key is refused a private base's entry even as its creator", async () => {
    // `canSeeBase` answers false for any non-public base under an
    // `apiKeyWorkspaceId`: such a credential may be shared between humans.
    mockRepo.findEntryById.mockResolvedValue(entry());
    mockRepo.findBaseById.mockResolvedValue(
      base({ visibility: "private", createdBy: OWNER })
    );

    await expect(
      getEntry(
        ctx({ userId: OWNER, apiKeyWorkspaceId: WS, credentialSubjectUserId: null }),
        "e-1"
      )
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("THE CEILING: an agent in a shared container is refused an UNGRANTED base's entry", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findEntryById.mockResolvedValue(entry({ knowledgeBaseId: "kb-2" }));
    mockRepo.findBaseById.mockResolvedValue(base({ id: "kb-2" }));

    await expect(
      getEntry(ctx({ userId: OWNER, source: "agent" }), "e-1")
    ).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("…and still reads a GRANTED base's entry", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findEntryById.mockResolvedValue(
      entry({ knowledgeBaseId: "kb-granted" })
    );
    mockRepo.findBaseById.mockResolvedValue(base({ id: "kb-granted" }));

    expect(
      (await getEntry(ctx({ userId: OWNER, source: "agent" }), "e-1")).id
    ).toBe("e-1");
  });

  it("a cross-workspace entry id still fails FIRST, on the workspace check", async () => {
    mockRepo.findEntryById.mockResolvedValue(entry({ workspaceId: "ws-other" }));

    await expect(getEntry(ctx(), "e-1")).rejects.toThrow();
    // The base is never fetched: the workspace filter refuses first.
    expect(mockRepo.findBaseById).not.toHaveBeenCalled();
  });
});

describe("resolveEntryRefs — the ?ids= lane carries the SAME two gates", () => {
  it("drops refs whose base is private to someone else", async () => {
    mockRepo.listEntriesByIds.mockResolvedValue([
      entry({ id: "e-1", knowledgeBaseId: "kb-public" }),
      entry({ id: "e-2", knowledgeBaseId: "kb-private" }),
    ]);
    mockRepo.listBasesByIds.mockResolvedValue([
      base({ id: "kb-public", visibility: "public" }),
      base({ id: "kb-private", visibility: "private", createdBy: OWNER }),
    ]);

    const refs = await resolveEntryRefs(ctx(), ["e-1", "e-2"]);

    expect(refs.map((r) => r.id)).toEqual(["e-1"]);
  });

  it("THE CEILING: an agent in a shared container only resolves GRANTED bases' entries", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.listEntriesByIds.mockResolvedValue([
      entry({ id: "e-1", knowledgeBaseId: "kb-granted" }),
      entry({ id: "e-2", knowledgeBaseId: "kb-ungranted" }),
    ]);
    mockRepo.listBasesByIds.mockResolvedValue([
      base({ id: "kb-granted" }),
      base({ id: "kb-ungranted" }),
    ]);

    const refs = await resolveEntryRefs(
      ctx({ userId: OWNER, source: "agent" }),
      ["e-1", "e-2"]
    );

    expect(refs.map((r) => r.id)).toEqual(["e-1"]);
  });

  it("the HUMAN on the same workspace is unaffected by the ceiling", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.listEntriesByIds.mockResolvedValue([
      entry({ id: "e-1", knowledgeBaseId: "kb-granted" }),
      entry({ id: "e-2", knowledgeBaseId: "kb-ungranted" }),
    ]);
    mockRepo.listBasesByIds.mockResolvedValue([
      base({ id: "kb-granted" }),
      base({ id: "kb-ungranted" }),
    ]);

    const refs = await resolveEntryRefs(ctx({ userId: OWNER }), ["e-1", "e-2"]);

    expect(refs.map((r) => r.id)).toEqual(["e-1", "e-2"]);
  });
});
