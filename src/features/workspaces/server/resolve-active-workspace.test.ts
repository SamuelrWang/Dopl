/**
 * NET-NEW (MCP-2) — the fail-closed workspace resolver.
 *
 * `resolveActiveWorkspace` replaced the silent default-workspace fallback
 * (oldest-owned / auto-create) with explicit targeting. This suite pins the
 * resolution matrix and the flat error envelope that `withWorkspaceAuth` and
 * `GET /api/workspaces/me` surface verbatim:
 *
 *   - header UUID → membership check (404 for non-member / nonexistent);
 *   - blank / non-UUID header → 400 WORKSPACE_INVALID (never a 500, never a
 *     silent fall-through to auto-targeting);
 *   - no header → active memberships decide (1 auto-targets; 0 or 2+ → 400
 *     WORKSPACE_REQUIRED with the choices, never `findDefaultWorkspaceForUser`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
  WorkspaceWithRole,
} from "../types";

vi.mock("./repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  findDefaultWorkspaceForUser: vi.fn(),
}));
vi.mock("./last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("./seed-workspace", () => ({ seedNewWorkspace: vi.fn() }));

import * as repo from "./repository";
import { HttpError } from "@/shared/lib/http-error";
import {
  resolveActiveWorkspace,
  WorkspaceResolutionError,
} from "./service";

const mockRepo = vi.mocked(repo);

const USER = "user-1";
const UUID_A = "11111111-1111-1111-1111-111111111111";

function wsWithRole(
  id: string,
  slug: string,
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role,
  };
}

function workspace(id: string, slug: string): Workspace {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    iconUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function membership(id: string, role: Role = "member"): WorkspaceMembership {
  return {
    workspaceId: id,
    userId: USER,
    role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    throw new Error("expected resolveActiveWorkspace to throw");
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveActiveWorkspace — header path", () => {
  it("resolves a valid UUID header for an active member", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace(UUID_A, "acme"));
    mockRepo.findMembership.mockResolvedValue(membership(UUID_A, "admin"));

    const res = await resolveActiveWorkspace(USER, UUID_A);
    expect(res.workspace.slug).toBe("acme");
    expect(res.membership.role).toBe("admin");
    // Never touches the membership directory when a header is present.
    expect(mockRepo.listWorkspacesWithRoleForUser).not.toHaveBeenCalled();
  });

  it("404s a UUID header for a non-member (membership row absent)", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace(UUID_A, "acme"));
    mockRepo.findMembership.mockResolvedValue(null);

    const err = (await catchErr(
      resolveActiveWorkspace(USER, UUID_A)
    )) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("404s a UUID header for a nonexistent workspace", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(null);

    const err = (await catchErr(
      resolveActiveWorkspace(USER, UUID_A)
    )) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
  });

  it("400 WORKSPACE_INVALID for a slug (non-UUID) header — no DB lookup, no 500", async () => {
    const err = (await catchErr(
      resolveActiveWorkspace(USER, "my-team")
    )) as WorkspaceResolutionError;
    expect(err).toBeInstanceOf(WorkspaceResolutionError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("WORKSPACE_INVALID");
    expect(mockRepo.findWorkspaceById).not.toHaveBeenCalled();
    expect(mockRepo.listWorkspacesWithRoleForUser).not.toHaveBeenCalled();
  });

  it("400 WORKSPACE_INVALID for a present-but-blank header", async () => {
    const err = (await catchErr(
      resolveActiveWorkspace(USER, "   ")
    )) as WorkspaceResolutionError;
    expect(err).toBeInstanceOf(WorkspaceResolutionError);
    expect(err.code).toBe("WORKSPACE_INVALID");
    expect(err.workspaces).toBeUndefined();
  });
});

describe("resolveActiveWorkspace — no-header path (active memberships)", () => {
  it("auto-targets the sole active membership", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole("ws-solo", "solo", "viewer"),
    ]);
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("ws-solo", "solo"));
    mockRepo.findMembership.mockResolvedValue(membership("ws-solo", "viewer"));

    const res = await resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-solo");
    expect(res.membership.role).toBe("viewer");
    // Ownership-based fallback must never be consulted.
    expect(mockRepo.findDefaultWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("400 WORKSPACE_REQUIRED with an empty list + create hint for 0 memberships", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([]);

    const err = (await catchErr(
      resolveActiveWorkspace(USER, null)
    )) as WorkspaceResolutionError;
    expect(err).toBeInstanceOf(WorkspaceResolutionError);
    expect(err.code).toBe("WORKSPACE_REQUIRED");
    expect(err.workspaces).toEqual([]);
    expect(err.message).toContain("POST /api/workspaces");
  });

  it("400 WORKSPACE_REQUIRED listing every workspace for 2+ memberships", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole("ws-1", "alpha", "owner"),
      wsWithRole("ws-2", "beta", "member"),
    ]);

    const err = (await catchErr(
      resolveActiveWorkspace(USER, null)
    )) as WorkspaceResolutionError;
    expect(err.code).toBe("WORKSPACE_REQUIRED");
    expect(err.workspaces).toEqual([
      { name: "alpha workspace", slug: "alpha", role: "owner" },
      { name: "beta workspace", slug: "beta", role: "member" },
    ]);
    // Never resolves a membership when the target is ambiguous.
    expect(mockRepo.findMembership).not.toHaveBeenCalled();
  });
});

describe("WorkspaceResolutionError — flat billing-style envelope", () => {
  it("REQUIRED serializes { error, message, workspaces }", () => {
    const err = new WorkspaceResolutionError("WORKSPACE_REQUIRED", "pick one", [
      { name: "alpha workspace", slug: "alpha", role: "owner" },
    ]);
    expect(err.toResponseBody()).toEqual({
      error: "WORKSPACE_REQUIRED",
      message: "pick one",
      workspaces: [{ name: "alpha workspace", slug: "alpha", role: "owner" }],
    });
  });

  it("INVALID serializes { error, message } with no workspaces key", () => {
    const err = new WorkspaceResolutionError("WORKSPACE_INVALID", "bad header");
    expect(err.toResponseBody()).toEqual({
      error: "WORKSPACE_INVALID",
      message: "bad header",
    });
  });
});
