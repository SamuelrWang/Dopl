/** Which container an identity write lands in (INVARIANTS §T35; argued in `shared/tenancy/read-resource.ts`). */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
// The fence is `shared/tenancy/resolve-resource.test.ts`; this file owns what a write does with the address.
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);
vi.mock("@/features/workspaces/server/repository", async () =>
  (await import("./service-writes-fixtures")).workspaceRepoMock()
);
vi.mock("@/features/workspaces/server/repository-overview", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(1),
}));
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());

import * as repo from "./repository";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { resolveResource } from "@/shared/tenancy/resolve-resource";
import { createIdentity, deleteIdentity, updateIdentity } from "./service";
import {
  AgentIdentityNotFoundError,
  IdentityTeamNotGrantableError,
} from "./errors";
import {
  OTHER,
  OWNER,
  ctx,
  resetRepoMocks,
  identity,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockResolve = vi.mocked(resolveResource);
const mockWorkspace = vi.mocked(findWorkspaceById);

/** What `findWorkspaceById` answers for "ws-1" in one case. */
function containerKind(kind: string | null) {
  mockWorkspace.mockResolvedValue(
    (kind === null ? null : { id: "ws-1", kind }) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
  // `clearAllMocks` keeps a case's `mockResolvedValue`; re-install, or case order decides the container kind.
  containerKind("standard");
  mockResolve.mockResolvedValue(null);
});

/**
 * The write doors follow the id. The container argument each repository call receives is the
 * assertion: gating in one container and writing through the original context would mutate another.
 */
describe("update and delete name the id's own container", () => {
  const SHELF = "ws-personal";

  /** A row on the caller's personal shelf, read from a channel they are standing in. */
  function livesOnTheShelf(over: Partial<ReturnType<typeof identity>> = {}) {
    mockRepo.findIdentityById.mockImplementation(
      (async (workspaceId: string) =>
        workspaceId === SHELF
          ? identity({ workspaceId: SHELF, ...over })
          : null) as never
    );
    mockResolve.mockResolvedValue({
      type: "agent_identity",
      id: "id-1",
      name: "Researcher",
      containerId: SHELF,
      containerName: "Samuel's Workspace",
      containerKind: "personal",
      ownedByCaller: true,
      containerRole: "owner",
    } as never);
  }

  it("PATCHes an identity on the caller's shelf, and updates it THERE", async () => {
    livesOnTheShelf();
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ workspaceId: SHELF }));
    await expect(
      updateIdentity(ctx(), "id-1", { name: "Renamed" })
    ).resolves.toMatchObject({ id: "id-1" });
    // `ctx.workspaceId` is `ws-1`; writing there would be an UPDATE on zero rows.
    expect(mockRepo.updateIdentityRow).toHaveBeenCalledWith(
      SHELF,
      "id-1",
      expect.objectContaining({ name: "Renamed" })
    );
  });

  it("replaces BOTH junctions in that container too", async () => {
    livesOnTheShelf();
    mockRepo.updateIdentityRow.mockResolvedValue(identity({ workspaceId: SHELF }));
    await updateIdentity(ctx(), "id-1", { knowledgeBaseIds: [] });
    // A junction row filed under the calling room is never read back by the row's own container.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      SHELF,
      "id-1",
      [],
      OWNER
    );
  });

  it("DELETEs it there as well", async () => {
    livesOnTheShelf();
    await expect(deleteIdentity(ctx(), "id-1")).resolves.toBeUndefined();
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith(SHELF, "id-1");
  });

  it("and the matrix still runs in the container the id named", async () => {
    // Following an id authorises nothing.
    livesOnTheShelf({ createdBy: OTHER, visibility: "private" });
    const err = await updateIdentity(ctx(), "id-1", { name: "Hijacked" }).catch(
      (e) => e
    );
    expect(err.code).toBe("AGENT_IDENTITY_NOT_FOUND");
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
  });

  it("an id that resolves NOWHERE is still a 404, and costs one resolve", async () => {
    mockRepo.findIdentityById.mockResolvedValue(null);
    mockResolve.mockResolvedValue(null);
    await expect(deleteIdentity(ctx(), "id-1")).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
    expect(mockRepo.hardDeleteIdentity).not.toHaveBeenCalled();
  });

  it("costs NOTHING on the hit path — a row found where it was asked never resolves", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    await deleteIdentity(ctx(), "id-1");
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteIdentity).toHaveBeenCalledWith("ws-1", "id-1");
  });
});

/**
 * A team scope needs a container with teams (`service-write-gates.ts › assertTeamScopeGrantable`). The
 * client's `visibilityOptions` pill is a courtesy; an agent credential reaches the REST route directly.
 */
describe("team visibility outside a standard workspace", () => {
  it.each(["personal", "link"] as const)(
    "REFUSES a create landing at `team` in a %s container",
    async (kind) => {
      containerKind(kind);
      await expect(
        createIdentity(ctx(), { name: "Scout", visibility: "team" })
      ).rejects.toBeInstanceOf(IdentityTeamNotGrantableError);
      expect(mockRepo.insertIdentity).not.toHaveBeenCalled();
    }
  );

  it("…including the EMPTY team set, which used to pass silently", async () => {
    // `assertGrantableTeams` answers `[]` for an empty set without asking the repository.
    containerKind("link");
    await expect(
      createIdentity(ctx(), { name: "Scout", visibility: "team", teamIds: [] })
    ).rejects.toBeInstanceOf(IdentityTeamNotGrantableError);
  });

  it("REFUSES the PATCH too — a create fence with no update twin is defeated in two calls", async () => {
    containerKind("personal");
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    await expect(
      updateIdentity(ctx(), "id-1", { visibility: "team" })
    ).rejects.toBeInstanceOf(IdentityTeamNotGrantableError);
    expect(mockRepo.updateIdentityRow).not.toHaveBeenCalled();
    expect(mockRepo.replaceTeamLinks).not.toHaveBeenCalled();
  });

  it("lets a STANDARD workspace through, on both doors", async () => {
    containerKind("standard");
    await expect(
      createIdentity(ctx(), { name: "Scout", visibility: "team" })
    ).resolves.toBeTruthy();
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    await expect(
      updateIdentity(ctx(), "id-1", { visibility: "team" })
    ).resolves.toBeTruthy();
  });

  it("PASSES on a workspace row that is gone, and says nothing about it", async () => {
    // Fails open only here: membership was proven, so `null` is a row that vanished mid-request.
    containerKind(null);
    await expect(
      createIdentity(ctx(), { name: "Scout", visibility: "team" })
    ).resolves.toBeTruthy();
  });

  it("asks ONCE on a private lane — the DESTINATION fence, never the team one", async () => {
    // The team lane and `assertHomeChannelRowIsShared`'s private lane are disjoint: one read, never two.
    // `private`, because `shared-publish.ts` also reads the row on the shared lane.
    containerKind("standard");
    await createIdentity(ctx(), { name: "Scout", visibility: "private" });
    expect(mockWorkspace).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a private identity landing in a home channel — the destination fence", async () => {
    // Wiring only; the rule is `workspaces/server/home-channel-destination.test.ts`.
    containerKind("link");
    await expect(
      createIdentity(ctx(), { name: "Scout", visibility: "private" })
    ).rejects.toMatchObject({ code: "HOME_CHANNEL_ROW_NOT_SHARED" });
  });

  it("…AND ON THE UPDATE PATH TOO — a fence with no update twin is defeated in two calls", async () => {
    containerKind("link");
    await expect(
      updateIdentity(ctx(), "id-1", { visibility: "private" })
    ).rejects.toMatchObject({ code: "HOME_CHANNEL_ROW_NOT_SHARED" });
  });
});
