/**
 * NET-NEW — bootServer workspace resolution + directory-load failure.
 *
 * The SDK `McpServer` is mocked (like server.test.ts) so `createServer`
 * registers tools without touching a real transport. We drive `bootServer`
 * over a stubbed `DoplClient` and assert what it wires onto the client
 * (`setWorkspaceId` — the on-the-wire default) and what it reports back
 * (`activeWorkspace`, `directoryLoadFailed`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool() {}
  },
}));

import { bootServer } from "./factory.js";

function wsItem(
  id: string,
  slug: string,
  name: string,
  role: WorkspaceListItem["role"],
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role,
  };
}

const WS1 = wsItem("id-1", "alpha", "Alpha", "owner");
const WS2 = wsItem("id-2", "beta", "Beta", "member");

function mockClient(opts: {
  directory?: WorkspaceListItem[];
  pin?: string | null;
  listThrows?: boolean;
}): DoplClient {
  return {
    pingMcpStatus: vi
      .fn()
      .mockResolvedValue({ is_admin: false, user_id: "user-1" }),
    listWorkspaces: opts.listThrows
      ? vi.fn().mockRejectedValue(new Error("backend down"))
      : vi.fn().mockResolvedValue({ workspaces: opts.directory ?? [] }),
    getWorkspaceId: vi.fn(() => opts.pin ?? null),
    setWorkspaceId: vi.fn(),
  } as unknown as DoplClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bootServer workspace resolution", () => {
  it("single membership → auto-targets it on the wire (setWorkspaceId with its id)", async () => {
    const client = mockClient({ directory: [WS1], pin: null });
    const res = await bootServer(client);
    expect(client.setWorkspaceId).toHaveBeenCalledWith("id-1");
    expect(res.activeWorkspace).toMatchObject({ id: "id-1", slug: "alpha" });
    expect(res.directoryLoadFailed).toBe(false);
  });

  it("2+ memberships, no pin → no default (setWorkspaceId null)", async () => {
    const client = mockClient({ directory: [WS1, WS2], pin: null });
    const res = await bootServer(client);
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
    expect(res.activeWorkspace).toBeNull();
    expect(res.directoryLoadFailed).toBe(false);
  });

  it("valid pin among 2+ → targets the pinned workspace", async () => {
    const client = mockClient({ directory: [WS1, WS2], pin: "id-2" });
    const res = await bootServer(client);
    expect(client.setWorkspaceId).toHaveBeenCalledWith("id-2");
    expect(res.activeWorkspace).toMatchObject({ id: "id-2", slug: "beta" });
  });

  it("invalid/non-member pin among 2+ → cleared to null default and logged", async () => {
    const onDiag = vi.fn();
    const client = mockClient({ directory: [WS1, WS2], pin: "ghost" });
    const res = await bootServer(client, { onDiag });
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
    expect(res.activeWorkspace).toBeNull();
    // The dropped pin must be observable, not silent (FIX 2).
    expect(onDiag).toHaveBeenCalledWith(
      expect.stringContaining("ghost"),
    );
  });

  it("invalid pin with a sole membership → falls back to sole-membership auto-target", async () => {
    const client = mockClient({ directory: [WS1], pin: "ghost" });
    const res = await bootServer(client);
    expect(client.setWorkspaceId).toHaveBeenCalledWith("id-1");
    expect(res.activeWorkspace).toMatchObject({ id: "id-1" });
  });

  it("listWorkspaces throws → directoryLoadFailed surfaced, no default", async () => {
    const client = mockClient({ listThrows: true, pin: null });
    const res = await bootServer(client);
    expect(res.directoryLoadFailed).toBe(true);
    expect(res.activeWorkspace).toBeNull();
    expect(client.setWorkspaceId).toHaveBeenCalledWith(null);
  });
});
