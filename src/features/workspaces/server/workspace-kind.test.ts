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
 *   2. `resolveActiveWorkspace` no-header path — it answers the caller's own
 *      PERSONAL CONTAINER (ruling B10), so no membership of any kind is an
 *      implicit candidate any more and an EXPLICIT header still reaches a link
 *      container.
 *   3. `findSoleOwnedStandardWorkspace` — billing's question, and `link` /
 *      `personal` containers are excluded from it: neither carries a plan, and
 *      neither may make an unambiguous owner look ambiguous.
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
import { findSoleOwnedStandardWorkspace } from "./repository";

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
  const container: Workspace = {
    id: "ws-home",
    ownerId: USER,
    name: "Personal",
    slug: "personal",
    publicId: "pub-ws-home",
    description: null,
    iconUrl: null,
    kind: "personal",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  vi.doMock("./repository", () => ({
    listWorkspacesWithRoleForUser: vi.fn(async () => memberships),
    findWorkspaceById: vi.fn(async (id: string) =>
      id === container.id ? container : findWorkspaceById(id)
    ),
    findMembership,
    ensurePersonalContainerRow: vi.fn(async () => ({
      workspace: container,
      created: false,
    })),
  }));
  const service = await import("./service");
  return { service, findMembership };
}

/** Chainable Supabase stub for the owned-rows read. */
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

  it("is never the implicit target, even as the caller's ONLY membership", async () => {
    const { service } = await withMemberships([
      wsWithRole("ws-solo", "solo", "link", "owner"),
    ]);

    const res = await service.resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-home");
    expect(res.workspace.kind).toBe("personal");
  });

  it("never becomes anyone's billing target, even as the only owned row", async () => {
    primeOwnedWorkspaces([{ id: "ws-solo", kind: "link" }]);
    expect((await findSoleOwnedStandardWorkspace(USER)).workspace).toBeNull();
  });
});

describe("resolveActiveWorkspace — no membership is an IMPLICIT candidate", () => {
  it("a caller with a standard workspace among N links still lands on their container", async () => {
    const { service } = await withMemberships([
      wsWithRole("ws-link-a", "link-a", "link"),
      wsWithRole("ws-real", "real", "standard", "owner"),
      wsWithRole("ws-link-b", "link-b", "link"),
    ]);

    // 🔒 THE BEHAVIOUR CHANGE OF B10, STATED AS A CASE: this used to answer
    // `ws-real` by counting. "Which of my workspaces" is not a question the
    // resolver asks any more — home is a constant.
    const res = await service.resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-home");
  });

  it("ZERO standard + N links resolves too — there is no refusal left to raise", async () => {
    const { service } = await withMemberships([
      wsWithRole("ws-link-a", "link-a", "link"),
      wsWithRole("ws-link-b", "link-b", "link"),
    ]);

    const res = await service.resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-home");
    expect(res.workspace.kind).toBe("personal");
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

describe("findSoleOwnedStandardWorkspace — standard only, and it REFUSES", () => {
  const primeSupabase = primeOwnedWorkspaces;

  it("ignores the containers beside the one real workspace", async () => {
    primeSupabase([
      { id: "ws-link", kind: "link" },
      { id: "ws-real", kind: "standard" },
      { id: "ws-home", kind: "personal" },
    ]);
    const { workspace, count } = await findSoleOwnedStandardWorkspace(USER);
    expect(workspace?.id).toBe("ws-real");
    expect(count).toBe(1);
  });

  it("owning only containers answers NOTHING, with the count that says why", async () => {
    primeSupabase([{ id: "ws-link", kind: "link" }, { id: "ws-home", kind: "personal" }]);
    expect(await findSoleOwnedStandardWorkspace(USER)).toEqual({
      workspace: null,
      count: 0,
    });
  });

  it("🔒 TWO owned standard workspaces REFUSE — the old shape picked the oldest", async () => {
    primeSupabase([{ id: "ws-oldest" }, { id: "ws-newer" }]);
    const { workspace, count } = await findSoleOwnedStandardWorkspace(USER);
    expect(workspace).toBeNull();
    expect(count).toBe(2);
  });

  it("kind-less rows (a narrowed projection) still count as standard", async () => {
    primeSupabase([{ id: "ws-oldest" }]);
    const { workspace, count } = await findSoleOwnedStandardWorkspace(USER);
    expect(workspace?.id).toBe("ws-oldest");
    expect(workspace?.kind).toBeUndefined();
    expect(count).toBe(1);
  });

  it("🔒 a `slug='default'` row gets no special treatment", async () => {
    // The legacy branch this function inherited preferred that slug outright.
    // It is gone: two workspaces are two workspaces, whatever they are called.
    primeSupabase([{ id: "ws-a", slug: "default" }, { id: "ws-b", slug: "beta" }]);
    expect((await findSoleOwnedStandardWorkspace(USER)).workspace).toBeNull();
  });
});
