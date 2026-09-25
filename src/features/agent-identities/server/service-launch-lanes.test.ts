/**
 * The two lanes of one launch agree about an id: CREATE (`resolveIdentityRef`, orchestrator's credential)
 * and SPAWN (`resolveIdentityForLaunch`, operator's desktop). Each fence has its own suite; only the
 * agreement lives here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity, AgentIdentityContext } from "../types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { resolveIdentityForLaunch, resolveIdentityRef } from "./service";
import { AgentIdentityNotFoundError } from "./errors";
import {
  AUDITOR,
  OTHER,
  ctx as baseCtx,
  identity as baseIdentity,
  resetReadMocks,
} from "./service-writes-fixtures";

/** Where the caller was authorised — a channel's container, say. */
const HERE = "11111111-1111-1111-1111-111111111111";
/** Where the identity actually lives — the caller's home shelf. */
const SHELF = "22222222-2222-2222-2222-222222222222";
const ID = "44444444-4444-4444-4444-444444444444";

const ctx = (over: Partial<AgentIdentityContext> = {}) => baseCtx({ workspaceId: HERE, ...over });
const identity = (over: Partial<AgentIdentity> = {}) =>
  baseIdentity({ ...AUDITOR, id: ID, workspaceId: SHELF, ...over });

/** Only on the caller's shelf: the workspace-keyed read in `HERE` must miss, or there is nothing to follow. */
function livesOnTheShelf(over: Partial<AgentIdentity> = {}) {
  vi.mocked(repo.findIdentityById).mockImplementation(async (workspaceId) =>
    workspaceId === SHELF ? identity(over) : null
  );
  vi.mocked(tenancy.resolveResource).mockResolvedValue({
    type: "agent_identity",
    id: ID,
    name: "Code Auditor",
    containerId: SHELF,
    containerName: "",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "admin",
  } satisfies ResolvedResource);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([]);
  vi.mocked(repo.findIdentityById).mockResolvedValue(null);
  vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([]);
  resetReadMocks(vi.mocked(repo));
});

describe("a personal identity launches anywhere its owner is", () => {
  it("BOTH lanes resolve an id living in another container of the caller's", async () => {
    livesOnTheShelf();
    // The CREATE lane (orchestrator).
    await expect(resolveIdentityRef(ctx(), ID)).resolves.toEqual({
      kind: "found",
      id: ID,
      name: "Code Auditor",
    });
    // The SPAWN lane (operator's desktop).
    await expect(resolveIdentityForLaunch(ctx(), ID)).resolves.toMatchObject({
      name: "Code Auditor",
      instructions: "Audit the diff.",
      authoredByCaller: true,
    });
  });

  it("BOTH lanes miss an id that is nameable nowhere", async () => {
    await expect(resolveIdentityRef(ctx(), ID)).resolves.toEqual({
      kind: "not-found",
    });
    await expect(resolveIdentityForLaunch(ctx(), ID)).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });

  it("BOTH lanes still refuse what the MATRIX refuses in the container it named", async () => {
    // Resolving is not authorising: handed the address, both lanes re-run the matrix.
    livesOnTheShelf({ createdBy: OTHER });
    await expect(resolveIdentityRef(ctx(), ID)).resolves.toEqual({
      kind: "not-found",
    });
    await expect(resolveIdentityForLaunch(ctx(), ID)).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });

  it("neither lane pays for the follow when the identity is where it was asked for", async () => {
    vi.mocked(repo.findIdentityById).mockImplementation(async (workspaceId) =>
      workspaceId === HERE ? identity({ workspaceId: HERE }) : null
    );
    await resolveIdentityRef(ctx(), ID);
    await resolveIdentityForLaunch(ctx(), ID);
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});

describe("a NAME does not follow, on either lane, and that is deliberate", () => {
  it("labels the tenancy instead of picking one", async () => {
    // Names are not unique, so any tie-break is arbitrary; SPAWN never sees a name (the directive stores the id).
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      {
        type: "agent_identity",
        id: ID,
        name: "Code Auditor",
        containerId: SHELF,
        containerName: "",
        containerKind: "home",
        ownedByCaller: true,
        containerRole: "admin",
      },
    ]);
    await expect(resolveIdentityRef(ctx(), "Code Auditor")).resolves.toEqual({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "your home space" },
    });
  });
});
