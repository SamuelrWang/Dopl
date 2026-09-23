/**
 * `service-resolve-ref.ts`, the launch-directive CREATE fence: a name never picks (names are not unique,
 * on purpose), and "invisible" and "no such row" are the same answer. The matrix itself is
 * `service-visibility.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());
// The fence itself is `shared/tenancy/resolve-resource.test.ts`; this file owns that the classifier composes it.
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { resolveIdentityRef } from "./service-resolve-ref";
import type { AgentIdentity, AgentIdentityContext } from "../types";
import {
  AUDITOR,
  ctx as baseCtx,
  identity as baseIdentity,
  resetReadMocks,
} from "./service-writes-fixtures";

const WS = "11111111-1111-1111-1111-111111111111";
const ME = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const T1 = "44444444-4444-4444-4444-444444444444";
const T2 = "55555555-5555-5555-5555-555555555555";
const TEAM = "66666666-6666-6666-6666-666666666666";

const ctx: AgentIdentityContext = baseCtx({
  workspaceId: WS,
  userId: ME,
  credentialSubjectUserId: ME,
  source: "agent",
});

const identity = (over: Partial<AgentIdentity> = {}) =>
  baseIdentity({ ...AUDITOR, id: T1, workspaceId: WS, createdBy: ME, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  resetReadMocks(vi.mocked(repo));
  // `clearAllMocks` keeps implementations; re-install what a case below overrides, or case order decides.
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([]);
});

describe("the ID path", () => {
  it("resolves a visible identity by id, and reads it BY ID rather than scanning", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(identity());
    const out = await resolveIdentityRef(ctx, T1);
    expect(out).toEqual({ kind: "found", id: T1, name: "Code Auditor" });
    expect(repo.findIdentityById).toHaveBeenCalledWith(WS, T1);
    expect(repo.listIdentitiesForWorkspace).not.toHaveBeenCalled();
  });

  it("answers NOT-FOUND for an invisible identity — the same object as a missing one", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(
      identity({ createdBy: OTHER, visibility: "private" })
    );
    const invisible = await resolveIdentityRef(ctx, T1);
    vi.mocked(repo.findIdentityById).mockResolvedValue(null);
    const missing = await resolveIdentityRef(ctx, T1);
    expect(invisible).toEqual({ kind: "not-found" });
    expect(invisible).toEqual(missing);
  });

  it("an invisible identity is not found even for a workspace ADMIN", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(
      identity({ createdBy: OTHER, visibility: "private" })
    );
    expect(
      await resolveIdentityRef({ ...ctx, role: "admin" }, T1)
    ).toEqual({ kind: "not-found" });
  });

  it("a UUID that matches nothing does NOT fall back to a name lookup", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(null);
    await resolveIdentityRef(ctx, T1);
    expect(repo.listIdentitiesForWorkspace).not.toHaveBeenCalled();
  });
});

describe("the NAME path", () => {
  it("resolves a unique visible name, case-insensitively", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([identity()]);
    expect(await resolveIdentityRef(ctx, "code auditor")).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });

  it("is EXACT after casefold — never a prefix and never fuzzy", async () => {
    // A substring rule would let every new identity re-point an existing call.
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([identity()]);
    for (const near of ["Auditor", "Code", "Code Auditor ", "Code  Auditor"]) {
      const out = await resolveIdentityRef(ctx, near);
      // "Code Auditor " trims to an exact match; the others must miss.
      expect(out.kind).toBe(near.trim() === "Code Auditor" ? "found" : "not-found");
    }
  });

  it("does not match an identity the caller cannot see", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([
      identity({ createdBy: OTHER, visibility: "private" }),
    ]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("an empty workspace, and a blank ref, are both not-found without a throw", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([]);
    expect(await resolveIdentityRef(ctx, "Anything")).toEqual({ kind: "not-found" });
    expect(await resolveIdentityRef(ctx, "   ")).toEqual({ kind: "not-found" });
  });
});

describe("AMBIGUITY — it refuses, and it lists", () => {
  const twoVisible = [
    identity({ id: T1, name: "Researcher", visibility: "private", createdBy: ME }),
    identity({ id: T2, name: "Researcher", visibility: "workspace", createdBy: OTHER }),
  ];

  it("REFUSES rather than picking, and never picks the caller's own", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue(twoVisible);
    const out = await resolveIdentityRef(ctx, "Researcher");
    expect(out.kind).toBe("ambiguous");
    expect(JSON.stringify(out)).not.toContain('"found"');
  });

  it("lists every match with its id AND its visibility", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue(twoVisible);
    const out = await resolveIdentityRef(ctx, "researcher");
    expect(out).toEqual({
      kind: "ambiguous",
      matches: [
        { id: T1, name: "Researcher", visibility: "private" },
        { id: T2, name: "Researcher", visibility: "workspace" },
      ],
    });
  });

  it("the list is NOT AN ORACLE — an invisible same-name row is absent from it", async () => {
    // Listing another's private row here would make the refusal a probe.
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([
      ...twoVisible,
      identity({
        id: "77777777-7777-7777-7777-777777777777",
        name: "Researcher",
        visibility: "private",
        createdBy: OTHER,
      }),
    ]);
    const out = await resolveIdentityRef(ctx, "Researcher");
    expect(out.kind).toBe("ambiguous");
    expect(JSON.stringify(out)).not.toContain("77777777");
  });

  it("two rows sharing a name where only ONE is visible is a plain FOUND", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([
      identity({ id: T1, name: "Researcher", createdBy: ME, visibility: "private" }),
      identity({ id: T2, name: "Researcher", createdBy: OTHER, visibility: "private" }),
    ]);
    expect(await resolveIdentityRef(ctx, "Researcher")).toEqual({
      kind: "found",
      id: T1,
      name: "Researcher",
    });
  });
});

describe("a workspace-scoped API key inherits nobody's reach", () => {
  // Arm 2: a key may be shared between humans, so the launch lane must carry `apiKeyWorkspaceId`.
  const keyCtx: AgentIdentityContext = {
    ...ctx,
    apiKeyWorkspaceId: WS,
    credentialSubjectUserId: null,
  };

  it("cannot resolve the key owner's own private identity, by id or by name", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(identity());
    expect(await resolveIdentityRef(keyCtx, T1)).toEqual({ kind: "not-found" });
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([identity()]);
    expect(await resolveIdentityRef(keyCtx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("…and the SAME context resolves a workspace-visible one, so this is arm 2 and not a blanket refusal", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(
      identity({ visibility: "workspace" })
    );
    expect(await resolveIdentityRef(keyCtx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });

  it("cannot reach a TEAM identity even when the key's user is in the team", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(
      identity({ visibility: "team", createdBy: OTHER })
    );
    vi.mocked(repo.listTeamIdsForUser).mockResolvedValue([TEAM]);
    vi.mocked(repo.listTeamLinksForIdentities).mockResolvedValue([
      { identityId: T1, teamId: TEAM },
    ] as never);
    expect(await resolveIdentityRef(keyCtx, T1)).toEqual({ kind: "not-found" });
    expect(await resolveIdentityRef(ctx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
  });
});

// A name miss that matches in another of the caller's tenancies becomes one label, without reopening
// the existence oracle: asked with the caller's own context, about one ref, never this tenancy.
describe("the miss that is not a mystery", () => {
  const OTHER_WS = "77777777-7777-7777-7777-777777777777";
  const LINK_WS = "88888888-8888-8888-8888-888888888888";

  function elsewhere(
    over: Partial<ResolvedResource> = {}
  ): ResolvedResource {
    return {
      type: "agent_identity",
      id: T2,
      name: "Code Auditor",
      containerId: OTHER_WS,
      containerName: "Acme",
      containerKind: "standard",
      ownedByCaller: true,
      containerRole: "member",
      ...over,
    };
  }

  beforeEach(() => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(null);
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([]);
  });

  it("names the workspace an identity of the caller's own lives in", async () => {
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([elsewhere()]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "the workspace “Acme”" },
    });
  });

  it("calls the PERSONAL CONTAINER the personal container, never a home channel", async () => {
    // The label keys on container kind; personal is not standard, so arm order matters (F-564).
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      elsewhere({ containerKind: "personal" }),
    ]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "your personal container" },
    });
  });

  it("names a home-channel container BY ITS ID, which is the actionable half", async () => {
    // A container is never advertised as a workspace; `workspace=<container id>` is the actionable part.
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      elsewhere({
        containerId: LINK_WS,
        containerKind: "link",
        containerName: "Sam & Dana",
      }),
    ]);
    const out = await resolveIdentityRef(ctx, "Code Auditor");
    expect(out).toEqual({
      kind: "elsewhere",
      identity: {
        name: "Code Auditor",
        label: `a home channel of yours, container ${LINK_WS}`,
      },
    });
    expect(JSON.stringify(out)).not.toContain("Sam & Dana");
  });

  it("answers ONE tenancy and never a roster, however many matched", async () => {
    // Never a roster, and sorted so the same refusal reads the same on every call.
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      elsewhere({ containerName: "Zephyr" }),
      elsewhere({ containerKind: "personal" }),
    ]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "elsewhere",
      identity: { name: "Code Auditor", label: "the workspace “Zephyr”" },
    });
  });

  it("stays NOT-FOUND when nothing of the caller's matches — the probe-proof arm", async () => {
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("DROPS a match in the tenancy it was already asked in — 'elsewhere' means elsewhere", async () => {
    // The resolver answers the whole reach; without this filter a row refused here is named elsewhere.
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([
      elsewhere({ containerId: WS }),
    ]);
    expect(await resolveIdentityRef(ctx, "Code Auditor")).toEqual({
      kind: "not-found",
    });
  });

  it("asks with the CALLER'S OWN CONTEXT, and only about this ref", async () => {
    // The fence reads `apiKeyWorkspaceId` and `credentialSubjectUserId`; a bare `{ userId }` strips both.
    vi.mocked(tenancy.resolveResourcesByName).mockResolvedValue([]);
    await resolveIdentityRef(ctx, "Code Auditor");
    expect(tenancy.resolveResourcesByName).toHaveBeenCalledWith(
      ctx,
      "agent_identity",
      "Code Auditor"
    );
    // A UUID ref asks by id, never by name.
    await resolveIdentityRef(ctx, T1);
    expect(tenancy.resolveResource).toHaveBeenCalledWith(ctx, "agent_identity", T1);
    expect(tenancy.resolveResourcesByName).toHaveBeenCalledTimes(1);
  });

  it("costs NOTHING on the hit path — a resolved ref never reaches the classifier", async () => {
    vi.mocked(repo.findIdentityById).mockResolvedValue(identity());
    expect(await resolveIdentityRef(ctx, T1)).toEqual({
      kind: "found",
      id: T1,
      name: "Code Auditor",
    });
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
    expect(tenancy.resolveResourcesByName).not.toHaveBeenCalled();
  });

  it("an AMBIGUOUS name is answered here, not sent looking elsewhere", async () => {
    vi.mocked(repo.listIdentitiesForWorkspace).mockResolvedValue([
      identity(),
      identity({ id: T2, visibility: "workspace", createdBy: OTHER }),
    ]);
    expect(
      (await resolveIdentityRef(ctx, "Code Auditor")).kind
    ).toBe("ambiguous");
    expect(tenancy.resolveResourcesByName).not.toHaveBeenCalled();
  });
});
