/**
 * The workspace resolver. Pins the resolution matrix and the flat error
 * envelope `withWorkspaceAuth` / `GET /api/workspaces/me` surface verbatim:
 *   - header UUID → membership check (404 for non-member / nonexistent);
 *   - blank / non-UUID header → 400 WORKSPACE_INVALID (never a 500, never a
 *     silent fall-through);
 *   - **no header → the caller's own personal container, minted on first ask**
 *     (ruling B10). No membership count, no auto-target, no refusal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role, Workspace, WorkspaceMembership } from "../types";

vi.mock("./repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  ensurePersonalContainerRow: vi.fn(),
}));
vi.mock("./last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("./seed-workspace", () => ({ seedNewWorkspace: vi.fn() }));
vi.mock("@/shared/tenancy/personal-container", () => ({
  findPersonalContainerId: vi.fn(),
}));

import * as repo from "./repository";
import { HttpError } from "@/shared/lib/http-error";
import {
  resolveActiveWorkspace,
  resolveMembershipOrThrow,
  WorkspaceResolutionError,
} from "./service";

const mockRepo = vi.mocked(repo);

const USER = "user-1";
const UUID_A = "11111111-1111-1111-1111-111111111111";

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
  });
});

describe("resolveActiveWorkspace — no-header path is the PERSONAL CONTAINER", () => {
  function primeContainer(role: Role = "owner") {
    mockRepo.ensurePersonalContainerRow.mockResolvedValue({
      workspace: { ...workspace("ws-home", "personal"), kind: "personal" },
      created: false,
    });
    mockRepo.findWorkspaceById.mockResolvedValue({
      ...workspace("ws-home", "personal"),
      kind: "personal",
    });
    mockRepo.findMembership.mockResolvedValue(membership("ws-home", role));
  }

  it("answers the caller's own container, and asks the membership directory nothing", async () => {
    primeContainer();

    const res = await resolveActiveWorkspace(USER, null);
    expect(res.workspace.id).toBe("ws-home");
    expect(res.membership.role).toBe("owner");
    // 🔒 THE COUNT IS GONE, not merely unreached: the one query that powered
    // the auto-target, the refusal and its choice list is never issued.
    expect(mockRepo.listWorkspacesWithRoleForUser).not.toHaveBeenCalled();
  });

  it("🔒 a caller who belongs to N workspaces still lands on their OWN container", async () => {
    // The old shape refused here (2+ memberships → WORKSPACE_REQUIRED) and
    // auto-targeted at exactly 1. Neither number is asked any more, so this
    // case and the zero-workspace one below are the SAME code path.
    primeContainer();
    expect((await resolveActiveWorkspace(USER, null)).workspace.id).toBe("ws-home");
    expect(mockRepo.listWorkspacesWithRoleForUser).not.toHaveBeenCalled();
  });

  it("🔒 a caller with ZERO workspaces resolves — sign-in cannot dead-end", async () => {
    primeContainer();
    const res = await resolveActiveWorkspace(USER, null);
    expect(res.workspace.kind).toBe("personal");
    expect(mockRepo.ensurePersonalContainerRow).toHaveBeenCalledWith(USER);
  });

  it("still fails closed on the container it just ensured (revoked membership → 404)", async () => {
    primeContainer();
    mockRepo.findMembership.mockResolvedValue(null);

    const err = (await catchErr(
      resolveActiveWorkspace(USER, null)
    )) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
  });
});

/**
 * ⚠ `resolveMembershipOrThrow` is the hot path of every `withWorkspaceAuth`
 * route; its two reads key only on `workspaceId` and neither feeds the other,
 * so they MUST stay parallel — series adds a DB round trip to every
 * authenticated request.
 */
describe("resolveMembershipOrThrow — the two reads are PARALLEL", () => {
  it("dispatches the membership read before the workspace read resolves", async () => {
    let membershipStarted = false;
    let workspaceResolved = false;
    mockRepo.findWorkspaceById.mockImplementation(async () => {
      await Promise.resolve();
      workspaceResolved = true;
      return workspace(UUID_A, "acme");
    });
    mockRepo.findMembership.mockImplementation(async () => {
      membershipStarted = true;
      // A SERIAL implementation reaches this only after the workspace read
      // has settled.
      expect(workspaceResolved).toBe(false);
      return membership(UUID_A, "member");
    });

    const res = await resolveMembershipOrThrow(UUID_A, USER);
    expect(membershipStarted).toBe(true);
    expect(res.membership.role).toBe("member");
  });

  it("still 404s a missing workspace even though the membership read ran", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(null);
    mockRepo.findMembership.mockResolvedValue(membership(UUID_A));

    const err = (await catchErr(
      resolveMembershipOrThrow(UUID_A, USER)
    )) as HttpError;
    // ⚠ Existence must not become an oracle: same 404 either way.
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("WORKSPACE_NOT_FOUND");
  });
});

describe("WorkspaceResolutionError — flat billing-style envelope, ONE code", () => {
  it("serializes { error, message } and nothing else", () => {
    const err = new WorkspaceResolutionError("bad header");
    expect(err.toResponseBody()).toEqual({
      error: "WORKSPACE_INVALID",
      message: "bad header",
    });
  });

  it("🔒 carries no choice list at all — there is nothing to choose between", () => {
    // The `workspaces: []` key existed only to render a WORKSPACE_REQUIRED
    // refusal. Asserted by SHAPE so re-adding a third field fails here.
    expect(Object.keys(new WorkspaceResolutionError("x").toResponseBody())).toEqual([
      "error",
      "message",
    ]);
  });
});
