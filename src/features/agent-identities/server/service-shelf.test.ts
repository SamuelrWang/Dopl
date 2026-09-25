/**
 * The identity shelves (twin of `knowledge/server/service-shelf.test.ts`): the home shelf is the
 * caller's own `kind='home'` container, the shelf reaches the query, absent means both, and the shelf
 * is never a second visibility gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity, AgentIdentityContext } from "../types";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

// The create's destination asks the personal fence; open here (its arms are `service-write-gates.test.ts`).
vi.mock("@/shared/tenancy/home-space-reach", () => ({
  resolveHomeSpaceReach: vi.fn(async () => ({
    kind: "open",
    containerId: "ws-personal",
  })),
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

// A create that left the calling container is re-read through the resolving read.
vi.mock("@/shared/tenancy/read-resource", () => ({
  readResourceById: vi.fn(),
}));

// `assertHomeChannelRowIsShared` reads the landing workspace; `home` is the one it never refuses.
vi.mock("@/features/workspaces/server/repository", () => ({
  findWorkspaceById: vi.fn(async () => ({ id: "ws-personal", kind: "home" })),
}));

import * as repo from "./repository";
import { readResourceById } from "@/shared/tenancy/read-resource";
import { listIdentities } from "./service-reads";
import { createIdentity } from "./service-writes";
import { OWNER as USER, ctx, identity, resetReadMocks } from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockFollow = vi.mocked(readResourceById);

const HOME_WS = "ws-home";
const HOME_SPACE_WS = "ws-personal";

/** A signed-in person in their own default standard workspace. */
const personCtx = (over: Partial<AgentIdentityContext> = {}) =>
  ctx({ workspaceId: HOME_WS, role: "owner", ...over });
const homeIdentity = (over: Partial<AgentIdentity> = {}) =>
  identity({ workspaceId: HOME_WS, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listIdentitiesForWorkspace.mockResolvedValue([]);
  resetReadMocks(mockRepo);
  // `createIdentity` returns through `getIdentityById`, so the inserted row must be findable.
  mockRepo.findIdentityById.mockImplementation((_ws, id) =>
    Promise.resolve(homeIdentity({ id })) as never
  );
  mockRepo.insertIdentity.mockImplementation(
    (args) => Promise.resolve(homeIdentity({ name: args.name, visibility: args.visibility })) as never
  );
  mockFollow.mockImplementation(
    async () => ({ value: homeIdentity({ workspaceId: HOME_SPACE_WS }) }) as never
  );
});

describe("listing one shelf", () => {
  it("pushes the shelf DOWN to the query instead of filtering the answer", async () => {
    // The second argument, not the result: a JS post-filter would put the other shelf on the wire.
    await listIdentities(personCtx(), { shelf: "home" });
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(HOME_WS, "home");

    await listIdentities(personCtx(), { shelf: "workspace" });
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenLastCalledWith(
      HOME_WS,
      "workspace"
    );
  });

  it("asks for BOTH shelves when no shelf is named", async () => {
    // The launch picker, `resolveIdentityRef` and MCP ride this path; a `workspace` default hides the home shelf.
    await listIdentities(personCtx());
    expect(mockRepo.listIdentitiesForWorkspace).toHaveBeenCalledWith(
      HOME_WS,
      undefined
    );
  });

  it("does NOT become a visibility gate — the credential arms answer the same either way", async () => {
    // A shared credential gets the same answer narrowed or not: the shelf can only subset.
    const rows = [homeIdentity({ id: "mine", visibility: "private" }), homeIdentity({ id: "pub", visibility: "workspace" })];
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue(rows);
    const shared = personCtx({
      source: "agent",
      apiKeyWorkspaceId: HOME_WS,
      credentialSubjectUserId: null,
    });

    const narrowed = await listIdentities(shared, { shelf: "home" });
    const unfiltered = await listIdentities(shared);

    expect(narrowed.map((t) => t.id)).toEqual(["pub"]);
    expect(unfiltered.map((t) => t.id)).toEqual(["pub"]);
  });
});

describe("decorating a list that spans containers", () => {
  const KB_HOME_SPACE = "kb-personal";

  it("reads each row's knowledge in ITS OWN container, so a personal row keeps its set", async () => {
    mockRepo.listIdentitiesForWorkspace.mockResolvedValue([
      homeIdentity({ id: "here", workspaceId: HOME_WS }),
      homeIdentity({ id: "home", workspaceId: HOME_SPACE_WS }),
    ]);
    // Links are filed under the row's container; asked under the calling one they are not there.
    mockRepo.listKnowledgeLinksForIdentities.mockImplementation(async (ws) =>
      ws === HOME_SPACE_WS
        ? [{ identityId: "home", knowledgeBaseId: KB_HOME_SPACE, scopeKind: "base", folderId: null, entryId: null }]
        : []
    );
    mockRepo.listKnowledgeBaseAccessRows.mockImplementation(async (ws) =>
      ws === HOME_SPACE_WS
        ? ([{ id: KB_HOME_SPACE, name: "Notes", visibility: "private", accessMode: "workspace", createdBy: USER }] as never)
        : []
    );

    const rows = await listIdentities(personCtx());
    const personal = rows.find((t) => t.id === "home");

    expect(mockRepo.listKnowledgeLinksForIdentities).toHaveBeenCalledWith(HOME_SPACE_WS, ["home"]);
    expect(personal?.knowledgeBases).toEqual([{ id: KB_HOME_SPACE, name: "Notes" }]);
    expect(personal?.unreachableKnowledgeBaseCount).toBe(0);
    expect(rows.map((t) => t.id)).toEqual(["here", "home"]);
  });
});

describe("creating onto the home shelf", () => {
  it("resolves the asked-for shelf to a container, and the two AGREE", async () => {
    // Flag and id together, so the insert lands where the junctions and the re-read look.
    await createIdentity(personCtx(), { name: "Shelf agent", homeScoped: true });
    expect(mockRepo.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScoped: true,
        workspaceId: HOME_SPACE_WS,
        visibility: "private",
      })
    );
  });

  it("re-reads a row that LEFT the room through the resolving read", async () => {
    // A re-read keyed to `ctx.workspaceId` would 404 a create that landed in the home space.
    await createIdentity(personCtx(), { name: "Shelf agent", homeScoped: true });

    expect(mockFollow).toHaveBeenCalledTimes(1);
    expect(mockRepo.findIdentityById).not.toHaveBeenCalled();
  });

  it("invents NO shelf when nobody asked — the calling container, still", async () => {
    // The router tests `homeScoped !== true`, so absent and `false` are one instruction.
    await createIdentity(personCtx(), { name: "Ordinary" });
    const args = mockRepo.insertIdentity.mock.calls[0][0];
    expect(args.homeScoped).toBe(false);
    expect(args.workspaceId).toBe(HOME_WS);
    expect(mockFollow).not.toHaveBeenCalled();
  });
});
