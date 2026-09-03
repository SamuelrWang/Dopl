/**
 * KIND-AWARENESS SUITE — `kind='link'` home-channel containers must be
 * invisible to every IMPLICIT pick, and untouched for every EXPLICIT one.
 *
 * Pins, in the three places a wrong answer is a cross-tenant or a
 * boot-into-nowhere bug:
 *   1. `isStandardWorkspace` — POSITIVE form (`=== "standard"`), and absent kind
 *      still reads as standard. The column (20260823150000) applied 2026-08-24
 *      and is NOT NULL DEFAULT 'standard', so live rows carry it; the default
 *      is what a narrowed projection or a fixture omits, and that must not
 *      change behaviour.
 *   2. `resolveActiveWorkspace` no-header path — a user with ONE standard and N
 *      link memberships still auto-targets their standard one; a link-ONLY user
 *      gets WORKSPACE_REQUIRED, exactly as a membership-less user does. The
 *      fail-closed shape of INVARIANTS §4 is unchanged, only the candidate set.
 *   3. `findDefaultWorkspaceForUser` — "oldest OWNED" now means "oldest owned
 *      STANDARD", so a link container claimed before the user ever made a
 *      workspace cannot become their default.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Role,
  Workspace,
  WorkspaceKind,
  WorkspaceMembership,
  WorkspaceWithRole,
} from "../types";
import { isStandardWorkspace } from "../types";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("./seed-workspace", () => ({ seedNewWorkspace: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  countWorkspacesOwnedBy,
  findDefaultWorkspaceForUser,
} from "./repository";

const USER = "user-1";

function wsWithRole(
  id: string,
  slug: string,
  kind?: WorkspaceKind,
  role: Role = "member"
): WorkspaceWithRole {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    iconUrl: null,
    ...(kind ? { kind } : {}),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role,
  };
}

/**
 * Isolated module graph per case: `service.ts` reads the repository through a
 * module-level import, so the mock has to be installed before it loads.
 *
 * ⚠ Module scope, not inside one `describe`: the SOLO-container block below
 * exercises the same two seams (resolution AND default pick) from the other
 * direction, and a helper copied into a second describe is a helper that drifts.
 */
async function withMemberships(memberships: WorkspaceWithRole[]) {
  vi.resetModules();
  const findWorkspaceById = vi.fn(
    async (id: string): Promise<Workspace | null> => {
      // `WorkspaceWithRole extends Workspace` — the extra `role` is inert here.
      return memberships.find((m) => m.id === id) ?? null;
    }
  );
  const findMembership = vi.fn(
    async (workspaceId: string): Promise<WorkspaceMembership | null> => ({
      workspaceId,
      userId: USER,
      role: memberships.find((m) => m.id === workspaceId)?.role ?? "member",
      status: "active",
      joinedAt: "2026-01-01T00:00:00Z",
      invitedBy: null,
      invitedAt: null,
      lastSeenAt: null,
    })
  );
  vi.doMock("./repository", () => ({
    listWorkspacesWithRoleForUser: vi.fn(async () => memberships),
    findWorkspaceById,
    findMembership,
    findDefaultWorkspaceForUser: vi.fn(),
  }));
  const service = await import("./service");
  return { service, findMembership };
}

/**
 * Chainable Supabase stub for the owned-rows reads. `maybeSingle()` answers the
 * legacy `slug='default'` probe; awaiting the builder answers the owned-rows
 * read.
 */
function primeOwnedWorkspaces(
  owned: Array<Partial<Workspace> & { kind?: WorkspaceKind }>
) {
  const rows = owned.map((w) => ({
    id: w.id,
    owner_id: USER,
    name: w.name ?? w.id,
    slug: w.slug ?? w.id,
    public_id: `pub-${w.id}`,
    description: null,
    icon_url: null,
    ...(w.kind ? { kind: w.kind } : {}),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }));
  const builder: Record<string, unknown> = {};
  const rec = () => builder;
  Object.assign(builder, {
    from: rec,
    select: rec,
    eq: rec,
    order: rec,
    limit: rec,
    // Legacy `slug='default'` probe — no such workspace in these fixtures.
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (r: unknown) => void) => resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(
    builder as unknown as ReturnType<typeof supabaseAdmin>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isStandardWorkspace", () => {
  it("absent kind is standard — a narrowed projection or an older row must not change behavior", () => {
    expect(isStandardWorkspace({})).toBe(true);
    expect(isStandardWorkspace({ kind: undefined })).toBe(true);
  });

  it("standard is standard, link is not", () => {
    expect(isStandardWorkspace({ kind: "standard" })).toBe(true);
    expect(isStandardWorkspace({ kind: "link" })).toBe(false);
  });

  it("is POSITIVE — a kind nobody has heard of is NOT standard", () => {
    // ⚠ THE SPELLING IS THE TEST. `!== "link"` would answer TRUE here, and the
    // next kind added to the union would be silently standard in the rail, the
    // switcher and every listing that renders a kind, with no error
    // anywhere. A listing predicate must let a value IN, not fail to keep it
    // out. The cast is the whole point: it is a future union member, arriving
    // over the wire from a newer server.
    const future = { kind: "vault" as unknown as WorkspaceKind };
    expect(isStandardWorkspace(future)).toBe(false);
  });
});

describe("a SOLO (one-member) link container is a link container", () => {
  /**
   * ⚠ MEMBER COUNT IS NOT PART OF THE PREDICATE, and this pins that on purpose:
   * the 2026-08-24 inversion made a container start with ONE member, and every
   * kind-aware site must treat it exactly as it treats a two-member one. The
   * risk it guards is the plausible-looking "a container with one member is
   * really just my workspace" special case.
   */
  it("fails isStandardWorkspace regardless of how many people are in it", () => {
    expect(isStandardWorkspace({ kind: "link" })).toBe(false);
  });

  it("never auto-targets, even as the caller's ONLY membership", async () => {
    const { service, findMembership } = await withMemberships([
      wsWithRole("ws-solo", "solo", "link", "owner"),
    ]);

    const err = await service
      .resolveActiveWorkspace(USER, null)
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as InstanceType<typeof service.WorkspaceResolutionError>).code).toBe(
      "WORKSPACE_REQUIRED"
    );
    expect(findMembership).not.toHaveBeenCalled();
  });

  it("never becomes the default workspace, even when it is the only owned row", async () => {
    primeOwnedWorkspaces([{ id: "ws-solo", kind: "link" }]);
    expect(await findDefaultWorkspaceForUser(USER)).toBeNull();
  });
});

describe("resolveActiveWorkspace — link containers are not candidates", () => {
  it("sole STANDARD membership among N links still auto-targets", async () => {
    const { service } = await withMemberships([
      wsWithRole("ws-link-a", "link-a", "link"),
      wsWithRole("ws-real", "real", "standard", "owner"),
      wsWithRole("ws-link-b", "link-b", "link"),
    ]);

    const res = await service.resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-real");
    expect(res.membership.role).toBe("owner");
  });

  it("ZERO standard + N links → 400 WORKSPACE_REQUIRED with an empty list, never a link", async () => {
    const { service, findMembership } = await withMemberships([
      wsWithRole("ws-link-a", "link-a", "link"),
      wsWithRole("ws-link-b", "link-b", "link"),
    ]);

    const err = await service
      .resolveActiveWorkspace(USER, null)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(service.WorkspaceResolutionError);
    expect((err as InstanceType<typeof service.WorkspaceResolutionError>).code).toBe(
      "WORKSPACE_REQUIRED"
    );
    expect(
      (err as InstanceType<typeof service.WorkspaceResolutionError>).workspaces
    ).toEqual([]);
    // Never proves membership on a container it refused to consider.
    expect(findMembership).not.toHaveBeenCalled();
  });

  it("the WORKSPACE_REQUIRED choice list omits link containers", async () => {
    const { service } = await withMemberships([
      wsWithRole("ws-1", "alpha", "standard", "owner"),
      wsWithRole("ws-link", "link-a", "link"),
      wsWithRole("ws-2", "beta", undefined, "member"),
    ]);

    const err = await service
      .resolveActiveWorkspace(USER, null)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(
      (err as InstanceType<typeof service.WorkspaceResolutionError>).workspaces
    ).toEqual([
      { name: "alpha workspace", slug: "alpha", role: "owner" },
      { name: "beta workspace", slug: "beta", role: "member" },
    ]);
  });

  it("an EXPLICIT header targeting a link container still resolves", async () => {
    const LINK_UUID = "11111111-1111-1111-1111-111111111111";
    const { service } = await withMemberships([
      { ...wsWithRole("x", "link-a", "link"), id: LINK_UUID },
    ]);

    const res = await service.resolveActiveWorkspace(USER, LINK_UUID);
    expect(res.workspace.id).toBe(LINK_UUID);
    expect(res.workspace.kind).toBe("link");
  });
});

describe("findDefaultWorkspaceForUser / countWorkspacesOwnedBy — standard only", () => {
  const primeSupabase = primeOwnedWorkspaces;

  it("skips a link container that is older than the user's real workspace", async () => {
    primeSupabase([
      { id: "ws-link", kind: "link" },
      { id: "ws-real", kind: "standard" },
    ]);
    const found = await findDefaultWorkspaceForUser(USER);
    expect(found?.id).toBe("ws-real");
  });

  it("owning only link containers resolves to NO default", async () => {
    primeSupabase([{ id: "ws-link", kind: "link" }]);
    expect(await findDefaultWorkspaceForUser(USER)).toBeNull();
  });

  it("kind-less rows (migration unapplied) behave exactly as today", async () => {
    primeSupabase([{ id: "ws-oldest" }, { id: "ws-newer" }]);
    const found = await findDefaultWorkspaceForUser(USER);
    expect(found?.id).toBe("ws-oldest");
    expect(found?.kind).toBeUndefined();
  });

  it("countWorkspacesOwnedBy excludes link containers", async () => {
    primeSupabase([
      { id: "ws-real", kind: "standard" },
      { id: "ws-link-a", kind: "link" },
      { id: "ws-link-b", kind: "link" },
    ]);
    expect(await countWorkspacesOwnedBy(USER)).toBe(1);
  });
});
