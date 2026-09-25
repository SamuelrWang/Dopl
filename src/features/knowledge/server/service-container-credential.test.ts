/**
 * The container-session credential against the audience ceiling — F-336, ruled
 * by Samuel 2026-08-27 ("option B"). Four refusals, four different fences, one
 * 404:
 *
 *   1. a PRIVATE base GRANTED `agent_only` into one of the container's channels
 *      → the operator's own agent READS it (the case that did not work).
 *   2. the SAME base UNGRANTED → refused by LAYER A (`resolveAgentAudience`).
 *   3. a base in ANOTHER workspace → refused by the WORKSPACE fence.
 *   4. a credential with NO subject — the shared workspace key M-10 was written
 *      for — still reads no private row at all, granted or not.
 */

import { NO_GRANTS } from "@/shared/tenancy/resource-grant-reach";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

// The grant arm is a DB read, so it is declared here (F-604). Every case in this
// file is about the OTHER arms, so the grant set is empty; the cases that
// exercise a GRANT live in `service-shared-grant-arm.test.ts` and the redteam
// suites.
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
  listBasesForWorkspace: vi.fn(),
  findBaseById: vi.fn(),
  findBaseBySlug: vi.fn(),
}));

import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listGrantedBaseIdsForChannels,
} from "./repository-audience";
import * as repo from "./repository";
import { getBaseById, listBases } from "./service-bases";
import { canSeeBase } from "./service-shared";
import {
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
} from "./errors";

const mockKind = vi.mocked(findWorkspaceKind);
const mockCount = vi.mocked(countActiveWorkspaceMembers);
const mockChannels = vi.mocked(listChannelIdsForWorkspace);
const mockGrants = vi.mocked(listGrantedBaseIdsForChannels);
const mockRepo = vi.mocked(repo);

const CHANNEL_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTAINER = "ws-container";
const HOME = "ws-home";

/** The operator's own agent, running on a CONTAINER-LOCKED child credential —
 *  layer B1's mint, which is what a desktop session in a shared container gets. */
function containerSession(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
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

/** The credential M-10 was written for: fenced to the same container, but with
 *  NO subject — it inherits nobody's home reach. Identical to
 *  `containerSession` on the container axis; they differ on the subject axis
 *  and nowhere else. */
function sharedKey(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return containerSession({ credentialSubjectUserId: null, ...over });
}

function privateBase(id: string, workspaceId = CONTAINER): KnowledgeBase {
  return {
    id,
    workspaceId,
    visibility: "private",
    accessMode: "workspace",
    createdBy: "u-operator",
    agentWriteEnabled: true,
  } as KnowledgeBase;
}

/** Link container, TWO active members (so the ceiling is armed), one channel. */
function sharedContainer(grantedBaseIds: string[]) {
  mockKind.mockResolvedValue("link");
  mockCount.mockResolvedValue(2);
  mockChannels.mockResolvedValue([CHANNEL_A]);
  mockGrants.mockResolvedValue(grantedBaseIds);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canSeeBase — the SUBJECT axis, not the container axis", () => {
  it("a container session sees its OPERATOR's private base", () => {
    expect(canSeeBase(containerSession(), privateBase("kb"), NO_GRANTS)).toBe(true);
  });

  it("a container session does NOT see a PEER's private base", () => {
    const peers = { ...privateBase("kb"), createdBy: "u-peer" };
    expect(canSeeBase(containerSession(), peers, NO_GRANTS)).toBe(false);
  });

  it("a SHARED credential sees no private base at all — M-10 unchanged", () => {
    expect(canSeeBase(sharedKey(), privateBase("kb"), NO_GRANTS)).toBe(false);
  });

  it("the container axis alone decides NOTHING here — only the subject moves it", () => {
    // The F-336 mutation, pinned: these two contexts differ in exactly one
    // field, so a predicate that reads the container axis as an audience again
    // flips the first to false.
    expect(canSeeBase(containerSession(), privateBase("kb"), NO_GRANTS)).toBe(true);
    expect(
      canSeeBase(
        containerSession({ credentialSubjectUserId: null }),
        privateBase("kb"),
        NO_GRANTS,
      ),
    ).toBe(false);
  });

  it("an UNFENCED credential with no subject is still SHARED — fail-closed", () => {
    // The other half of the same independence: dropping the container fence
    // must not buy an anonymous credential a private row.
    const ctx = sharedKey({ apiKeyWorkspaceId: null });
    expect(canSeeBase(ctx, privateBase("kb"), NO_GRANTS)).toBe(false);
  });

  it("public is public for every credential", () => {
    const pub = { ...privateBase("kb"), visibility: "public" as const };
    expect(canSeeBase(sharedKey(), pub, NO_GRANTS)).toBe(true);
  });
});

describe("the three-way grant, end to end through getBaseById", () => {
  it("1. GRANTED agent_only: the operator's agent READS its own private base", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findBaseById.mockResolvedValue(privateBase("kb-granted"));

    const base = await getBaseById(containerSession(), "kb-granted");

    expect(base.id).toBe("kb-granted");
  });

  it("2. UNGRANTED: the same private base is 404 — refused by LAYER A", async () => {
    sharedContainer([]);
    mockRepo.findBaseById.mockResolvedValue(privateBase("kb-granted"));

    await expect(
      getBaseById(containerSession(), "kb-granted")
    ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
    // The grant read HAPPENED — the refusal came from the grant fence and not
    // from a visibility gate that answered before it. Without this the test
    // passes for the WRONG reason and stays green through F-336.
    expect(mockGrants).toHaveBeenCalled();
  });

  it("3. ANOTHER WORKSPACE: refused by the workspace fence, before anything else", async () => {
    sharedContainer(["kb-elsewhere"]);
    mockRepo.findBaseById.mockResolvedValue(privateBase("kb-elsewhere", HOME));

    await expect(
      getBaseById(containerSession(), "kb-elsewhere")
    ).rejects.toBeInstanceOf(KnowledgeBaseMismatchError);
    expect(mockGrants).not.toHaveBeenCalled();
  });

  it("4. a SHARED credential is refused its own granted private base", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.findBaseById.mockResolvedValue(privateBase("kb-granted"));

    await expect(getBaseById(sharedKey(), "kb-granted")).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });
});

describe("listBases from a container session", () => {
  it("lists the GRANTED private base and drops the ungranted one", async () => {
    sharedContainer(["kb-granted"]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      privateBase("kb-granted"),
      privateBase("kb-ungranted"),
    ]);

    const bases = await listBases(containerSession());

    expect(bases.map((b) => b.id)).toEqual(["kb-granted"]);
  });

  it("a PEER's granted private base is still invisible — the grant is not a bypass", async () => {
    sharedContainer(["kb-peer"]);
    mockRepo.listBasesForWorkspace.mockResolvedValue([
      { ...privateBase("kb-peer"), createdBy: "u-peer" },
    ]);

    expect(await listBases(containerSession())).toEqual([]);
  });
});
