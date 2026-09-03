/**
 * MCP KIND-AWARENESS, AFTER B10 — a `kind='link'` container is LISTED like any
 * other container and is never CALLED a workspace. The asymmetry that used to
 * be the feature is gone with the thing it protected:
 *
 *   - `bootServer` auto-targets NOTHING. There is no sole-membership rule left
 *     to exclude a container from, so the "un-defaultable" half is not a
 *     narrower rule — it is no rule at all, for any kind.
 *   - `getWorkspaceList` LISTS containers (B10: "all workspaces are just normal
 *     workspaces"). What keeps §4A true is that every surface renders the KIND,
 *     which `containerKind` answers positively from the row.
 *   - `resolveWorkspaceRef` resolves one by id and by slug off the same cache —
 *     how an agent acting inside a home channel targets its own container.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isStandardWorkspace } from "@dopl/client";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    // ⚠ THE MCP RESOURCE SEAM (2026-09-02). `createServer` publishes
    // `dopl://doctrine/channels` through `registerResource` (`resources.ts`), so
    // a double without this method throws before a single tool is registered.
    // ⚠ IT IS A NO-OP HERE ON PURPOSE — these suites assert over TOOLS. The
    // resource's own content is pinned in `channel-doctrine.test.ts`, and that
    // it is registered at all in `server.test.ts`.
    registerResource() {}
    registerTool() {}
  },
}));

import { bootServer } from "./factory.js";
import { containerKind, createWorkspaceDirectory } from "./workspace-directory.js";

function wsItem(
  id: string,
  slug: string,
  kind?: "standard" | "link",
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    ...(kind ? { kind } : {}),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

const STANDARD = wsItem("id-std", "alpha", "standard");
const KINDLESS = wsItem("id-old", "legacy");
const LINK_A = wsItem("id-link-a", "link-a", "link");
const LINK_B = wsItem("id-link-b", "link-b", "link");

function mockClient(directory: WorkspaceListItem[], pin?: string | null): DoplClient {
  return {
    pingMcpStatus: vi.fn().mockResolvedValue({ is_admin: false, user_id: "user-1" }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => pin ?? null),
    setWorkspaceId: vi.fn(),
  } as unknown as DoplClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bootServer — nothing auto-targets, of any kind", () => {
  it("one standard + N links binds NOTHING and sends no X-Workspace-Id", async () => {
    // ⚠ **THIS USED TO ASSERT THE STANDARD ONE WAS PICKED**, and the pick is
    // what B10 deletes: a container the caller never named must not become the
    // one their calls land in, and neither must a workspace. The API applies
    // the identical sole-membership rule one layer down
    // (`with-workspace-auth.ts › resolveActiveWorkspace`), so the caller's
    // answer is unchanged and there is now ONE copy of it.
    const client = mockClient([LINK_A, STANDARD, LINK_B]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toBeNull();
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
  });

  it("links ONLY → nothing bound, and no bogus X-Workspace-Id on the wire", async () => {
    const client = mockClient([LINK_A, LINK_B]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toBeNull();
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
  });

  it("a sole standard membership is not special either", async () => {
    const client = mockClient([KINDLESS]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toBeNull();
  });

  it("an explicit X-Workspace-Id pin on a link container is honoured", async () => {
    const client = mockClient([STANDARD, LINK_A], "id-link-a");
    const res = await bootServer(client);
    expect(res.activeWorkspace).toMatchObject({ id: "id-link-a" });
    expect(client.setWorkspaceId).toHaveBeenCalledWith("id-link-a");
  });
});

describe("WorkspaceDirectory — listing vs resolution", () => {
  function directoryOver(rows: WorkspaceListItem[]) {
    return createWorkspaceDirectory(mockClient(rows), { directory: rows });
  }

  it("getWorkspaceList LISTS link containers — they are containers too (B10)", async () => {
    const list = await directoryOver([STANDARD, LINK_A, KINDLESS]).getWorkspaceList();
    expect(list.map((w) => w.id)).toEqual(["id-std", "id-link-a", "id-old"]);
  });

  it("resolveWorkspaceRef resolves a link container by id AND by slug", async () => {
    const dir = directoryOver([STANDARD, LINK_A]);
    expect((await dir.resolveWorkspaceRef("id-link-a"))?.id).toBe("id-link-a");
    expect((await dir.resolveWorkspaceRef("link-a"))?.id).toBe("id-link-a");
  });

  it("containerKind labels each row POSITIVELY, from its own kind (F-564)", () => {
    // ⚠ THE F-564 SHAPE, ASSERTED. `!isStandardWorkspace(…)` answered "home
    // channel" for anything not standard, which `20260920120000`'s `personal`
    // kind makes false for every user at once. The `default` arm is the safe
    // one: an unknown kind is a workspace, never somebody's room.
    expect(containerKind(STANDARD)).toBe("workspace");
    expect(containerKind(KINDLESS)).toBe("workspace");
    expect(containerKind(LINK_A)).toBe("home channel");
    expect(containerKind({ kind: "personal" })).toBe("personal");
    expect(containerKind({ kind: "vault" as never })).toBe("workspace");
  });
});

describe("isStandardWorkspace — the predicate itself", () => {
  /**
   * ⚠ HAND-MIRRORED FROM THE SERVER (`src/features/workspaces/types.ts`), which
   * is F-295's standing entry. This block is the SDK-side half of a test that
   * exists on both sides on purpose: a predicate copied into two packages drifts
   * in exactly one of them, and the only thing that notices is a test in each.
   */
  it("standard is standard, absent reads standard, link is not", () => {
    expect(isStandardWorkspace({ kind: "standard" })).toBe(true);
    expect(isStandardWorkspace({})).toBe(true);
    expect(isStandardWorkspace({ kind: "link" })).toBe(false);
  });

  it("is POSITIVE — a kind nobody has heard of is NOT standard", () => {
    // `!== "link"` would answer TRUE here, and the next kind added to the union
    // would be silently listable in `list_workspaces` and auto-targetable at
    // boot, with no error anywhere. A newer server sending an unknown kind is
    // exactly the case the SDK copy has to survive.
    const future = { kind: "vault" as unknown as "standard" | "link" };
    expect(isStandardWorkspace(future)).toBe(false);
  });
});
