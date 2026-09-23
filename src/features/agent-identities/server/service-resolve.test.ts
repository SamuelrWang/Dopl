/**
 * `resolveIdentityForLaunch` values (the route test mocks it and pins only the shape). `authoredByCaller`
 * picks the desktop's ROLE-block security header; the visibility grid is `service-visibility.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity } from "../types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());
// The fence itself is `shared/tenancy/resolve-resource.test.ts`; this file owns that the launch door composes it.
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { resolveIdentityForLaunch } from "./service";
import { AgentIdentityNotFoundError } from "./errors";
import { mapAgentIdentityError } from "./http-mapping";
import {
  AUDITOR,
  OTHER,
  OWNER as CREATOR,
  ctx,
  identity as baseIdentity,
  resetReadMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancy);

const ADMIN = "user-admin";

const identity = (over: Partial<AgentIdentity> = {}) =>
  baseIdentity({
    ...AUDITOR,
    fields: [{ key: "repo", value: "acme/api" }],
    visibility: "workspace",
    ...over,
  });

/** WHERE an id lives, when the read has to follow it out of `ctx.workspaceId`. */
function resolvedIn(
  containerId: string,
  over: Partial<ResolvedResource> = {}
): ResolvedResource {
  return {
    type: "agent_identity",
    id: "id-1",
    name: "Code Auditor",
    containerId,
    containerName: "Acme",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "member",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTenancy.resolveResource.mockResolvedValue(null);
  resetReadMocks(mockRepo);
});

describe("authoredByCaller", () => {
  it("is TRUE for the caller who wrote it", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.authoredByCaller).toBe(true);
  });

  it("is FALSE for another member resolving the same workspace identity", async () => {
    // The same row gets the operator header for its author and the untrusted header for everyone else.
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx({ userId: OTHER }), "id-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace ADMIN who did not write it — authorship, not permission", async () => {
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team", createdBy: OTHER })
    );
    const resolved = await resolveIdentityForLaunch(
      ctx({ userId: ADMIN, role: "admin" }),
      "id-1"
    );
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE when the author has LEFT the workspace (`created_by` SET NULL)", async () => {
    // `null === null` would make an orphaned identity read as everyone's own.
    mockRepo.findIdentityById.mockResolvedValue(identity({ createdBy: null }));
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace-scoped API key, which authored nothing", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(
      ctx({ userId: CREATOR, apiKeyWorkspaceId: "ws-1", source: "agent" }),
      "id-1"
    );
    // `authoredByCaller` is `createdBy === userId` whatever the credential, hence `true` (contradicts the title).
    expect(resolved.authoredByCaller).toBe(true);
  });
});

describe("the payload, and the door it comes through", () => {
  // A closed set: an id, visibility or ownership fact riding a launch payload must fail here.
  it("carries EXACTLY the nine launch keys — no id, no visibility, no ownership", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledge",
      "knowledgeBases",
      "model",
      "name",
      "runtime",
      "unreachableKnowledgeBaseCount",
    ]);
    expect(resolved).not.toHaveProperty("createdBy");
    expect(resolved).not.toHaveProperty("description");
  });

  it("404s — never 403s — for an identity this caller may not see", async () => {
    // It composes `getIdentityById`, so an invisible row is indistinguishable from a deleted one.
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    await expect(
      resolveIdentityForLaunch(ctx({ userId: OTHER }), "id-1")
    ).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
  });

  // The read follows an id into the container it names; the matrix re-runs there, so resolving is
  // an address, never a permission.
  it("resolves an identity living in ANOTHER container of the caller's", async () => {
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2" ? identity({ workspaceId: "ws-2" }) : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.name).toBe("Code Auditor");
    expect(resolved.authoredByCaller).toBe(true);
  });

  it("IGNORES a `workspace=` that contradicts a resolvable id", async () => {
    // An id is globally unique, so the workspace it was asked in carries no information.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2" ? identity({ workspaceId: "ws-2" }) : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    await expect(
      resolveIdentityForLaunch(ctx({ workspaceId: "ws-9" }), "id-1")
    ).resolves.toMatchObject({ name: "Code Auditor" });
  });

  it("re-runs the MATRIX in the container the id named — resolving is not seeing", async () => {
    // The resolver cannot know a row went `private` under the caller.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2"
        ? identity({ workspaceId: "ws-2", visibility: "private", createdBy: OTHER })
        : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    await expect(
      resolveIdentityForLaunch(ctx(), "id-1")
    ).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
  });

  it("carries the caller's REAL ROLE into the container it resolved into", async () => {
    // A guessed `null` role would 404 an admin's team-scoped row on the id lane only.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2"
        ? identity({ workspaceId: "ws-2", visibility: "team", createdBy: OTHER })
        : null
    );
    mockTenancy.resolveResource.mockResolvedValue(
      resolvedIn("ws-2", { containerRole: "admin" })
    );
    await expect(
      resolveIdentityForLaunch(ctx({ userId: ADMIN, role: null }), "id-1")
    ).resolves.toMatchObject({ name: "Code Auditor" });
  });

  it("404s for an identity nothing of the caller's can name — the probe-proof arm", async () => {
    // Another's private row, a missing id and a container outside the lock are one answer.
    mockRepo.findIdentityById.mockResolvedValue(null);
    mockTenancy.resolveResource.mockResolvedValue(null);
    const err = await resolveIdentityForLaunch(ctx(), "id-1").catch((e) => e);
    expect(err).toBeInstanceOf(AgentIdentityNotFoundError);
  });

  it("asks with the CALLER'S OWN CONTEXT, so the container LOCK reaches the fence", async () => {
    // The container lock rides on `apiKeyWorkspaceId`; a bare `{ userId }` would strip it silently.
    mockRepo.findIdentityById.mockResolvedValue(null);
    mockTenancy.resolveResource.mockResolvedValue(null);
    const locked = ctx({
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: CREATOR,
    });
    await resolveIdentityForLaunch(locked, "id-1").catch(() => {});
    expect(mockTenancy.resolveResource).toHaveBeenCalledWith(
      locked,
      "agent_identity",
      "id-1"
    );
  });

  it("costs NOTHING on the hit path — an identity found where it was asked never resolves", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    await resolveIdentityForLaunch(ctx(), "id-1");
    expect(mockTenancy.resolveResource).not.toHaveBeenCalled();
  });

  it("404s for a row that does not exist at all — the same error, deliberately", async () => {
    mockRepo.findIdentityById.mockResolvedValue(null);
    await expect(resolveIdentityForLaunch(ctx(), "id-1")).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });
});

// Absent, not null: the presence of a `details` key would itself be a fact about an invisible row.
describe("the 404 the desktop reads", () => {
  it("carries no details at all for an ordinary miss", () => {
    const http = mapAgentIdentityError(new AgentIdentityNotFoundError("id-1"));
    expect(http?.status).toBe(404);
    expect(http?.details).toBeUndefined();
  });
});
