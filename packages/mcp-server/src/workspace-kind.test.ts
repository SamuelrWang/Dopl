/**
 * MCP KIND-AWARENESS — `kind='link'` home-channel containers are UNLISTABLE and
 * UN-DEFAULTABLE, but stay explicitly ADDRESSABLE. The asymmetry is the whole
 * feature, so both halves are pinned here:
 *
 *   - `bootServer` never auto-targets a link container off "sole membership",
 *     and a caller whose only membership is a link resolves to NO default (the
 *     wrapper then demands `workspace=`, which is the correct fail-closed
 *     answer for a workspace that has no UI).
 *   - `list_workspaces` / `noWorkspaceError` never advertise one.
 *   - `resolveWorkspaceRef` DOES resolve one, by id and by slug, off the same
 *     cache — that is how an agent acting inside a home channel targets its own
 *     container.
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
import { createWorkspaceDirectory } from "./workspace-directory.js";

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

describe("bootServer — session default excludes link containers", () => {
  it("one standard + N links auto-targets the STANDARD one", async () => {
    const client = mockClient([LINK_A, STANDARD, LINK_B]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toMatchObject({ id: "id-std", slug: "alpha" });
    expect(client.setWorkspaceId).toHaveBeenCalledWith("id-std");
  });

  it("links ONLY → no default, and no bogus X-Workspace-Id on the wire", async () => {
    const client = mockClient([LINK_A, LINK_B]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toBeNull();
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
  });

  it("a kind-less directory (migration unapplied) still auto-targets its sole row", async () => {
    const client = mockClient([KINDLESS]);
    const res = await bootServer(client);
    expect(res.activeWorkspace).toMatchObject({ id: "id-old" });
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

  it("getWorkspaceList drops link containers", async () => {
    const list = await directoryOver([STANDARD, LINK_A, KINDLESS]).getWorkspaceList();
    expect(list.map((w) => w.id)).toEqual(["id-std", "id-old"]);
  });

  it("resolveWorkspaceRef resolves a link container by id AND by slug", async () => {
    const dir = directoryOver([STANDARD, LINK_A]);
    expect((await dir.resolveWorkspaceRef("id-link-a"))?.id).toBe("id-link-a");
    expect((await dir.resolveWorkspaceRef("link-a"))?.id).toBe("id-link-a");
  });

  it("noWorkspaceError never names a link container", async () => {
    const err = await directoryOver([LINK_A, LINK_B]).noWorkspaceError();
    expect(err.isError).toBe(true);
    const text = err.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    expect(text).not.toContain("link-a");
    expect(text).toContain("not an active member of any workspace");
  });

  it("2+ standards alongside links list only the standards in the refusal", async () => {
    const other = wsItem("id-std2", "beta", "standard");
    const err = await directoryOver([STANDARD, LINK_A, other]).noWorkspaceError();
    const text = err.content.map((c) => ("text" in c ? c.text : "")).join("\n");
    expect(text).toContain("you belong to 2 workspaces");
    expect(text).not.toContain("link-a");
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
