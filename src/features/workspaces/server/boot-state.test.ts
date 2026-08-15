/**
 * `getBootState` + the membership facts the segment resolver carries. Pins:
 *   - FAIL-CLOSED: segment mode resolves or returns null, NEVER falls through
 *     to `ensureDefaultWorkspace` (that is a cross-tenant bug).
 *   - NO PROVISIONING BEFORE ONBOARDING (gate moved server-side from the SPA's
 *     `enabled: signedIn && onboarded`).
 *   - ROLE THREADED, NOT RE-READ: the membership fetch proving access is the
 *     same one that answers `GET /api/workspaces/me`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Workspace, WorkspaceMembership } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));
vi.mock("./repository", () => ({
  findWorkspaceById: vi.fn(),
  findWorkspaceByPublicId: vi.fn(),
  findMemberWorkspaceBySlug: vi.fn(),
  findMembership: vi.fn(),
  findDefaultWorkspaceForUser: vi.fn(),
  listWorkspacesWithRoleForUser: vi.fn(),
  ensureDefaultWorkspaceRow: vi.fn(),
  countWorkspaceResources: vi.fn(),
  deleteWorkspace: vi.fn(),
  insertWorkspaceWithOwnerMembership: vi.fn(),
  listMembers: vi.fn(),
  updateWorkspace: vi.fn(),
}));
vi.mock("./last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("./seed-workspace", () => ({ seedNewWorkspace: vi.fn() }));
vi.mock("@/features/onboarding/server/service", () => ({
  getOnboardingStatus: vi.fn(),
}));
vi.mock("@/features/teams/server/access", async () => {
  const actual = await vi.importActual<typeof import("@/features/teams/server/access")>(
    "@/features/teams/server/access"
  );
  return { ...actual, listEffectiveAccess: vi.fn() };
});

import * as repo from "./repository";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import { listEffectiveAccess } from "@/features/teams/server/access";
import { getBootState, resolveWorkspaceSegmentForUser } from "./segment";

const mockRepo = vi.mocked(repo);
const mockOnboarding = vi.mocked(getOnboardingStatus);
const mockAccess = vi.mocked(listEffectiveAccess);

const USER = "user-1";
const WS_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ID = "abc123def456";
const CANONICAL = `acme-${PUBLIC_ID}`;

const WORKSPACE: Workspace = {
  id: WS_ID,
  ownerId: USER,
  name: "Acme",
  slug: "acme",
  publicId: PUBLIC_ID,
  description: null,
  iconUrl: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function membership(role: WorkspaceMembership["role"] = "owner"): WorkspaceMembership {
  return {
    workspaceId: WS_ID,
    userId: USER,
    role,
    status: "active",
    joinedAt: "2026-08-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnboarding.mockResolvedValue({ onboarded: true, surveyCompleted: true });
  mockAccess.mockResolvedValue({
    defaultLevel: "edit",
    isAdmin: true,
    teamsModeResources: [],
  });
});

describe("resolveWorkspaceSegmentForUser — role rides along", () => {
  it("returns the caller's role with the workspace it just proved membership on", async () => {
    mockRepo.findWorkspaceByPublicId.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue(membership("admin"));

    const resolved = await resolveWorkspaceSegmentForUser(CANONICAL, USER);
    expect(resolved).toMatchObject({ canonical: CANONICAL, needsRedirect: false, role: "admin" });
    // Membership read happens ONCE — same read that gates access.
    expect(mockRepo.findMembership).toHaveBeenCalledTimes(1);
  });

  it("null for a workspace the caller is not an active member of", async () => {
    mockRepo.findWorkspaceByPublicId.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue({ ...membership(), status: "revoked" });
    mockRepo.findMemberWorkspaceBySlug.mockResolvedValue(null);

    expect(await resolveWorkspaceSegmentForUser(CANONICAL, USER)).toBeNull();
  });
});

describe("getBootState — segment mode", () => {
  it("answers workspace + role + userId + myAccess from one composition", async () => {
    mockRepo.findWorkspaceByPublicId.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue(membership("member"));
    mockAccess.mockResolvedValue({
      defaultLevel: "edit",
      isAdmin: false,
      teamsModeResources: [
        { resourceType: "knowledge_base", resourceId: "kb-1", level: null },
      ],
    });

    const state = await getBootState(USER, CANONICAL);
    expect(state).toMatchObject({
      isOnboarded: true,
      userId: USER,
      segment: CANONICAL,
      needsRedirect: false,
      role: "member",
    });
    // The role is THREADED into the access batch, not re-fetched by it.
    expect(mockAccess).toHaveBeenCalledWith(WS_ID, USER, { role: "member" });
    // Teams-mode resource with no grant reads as "read", never omission.
    expect(state?.myAccess).toEqual({
      defaultLevel: "edit",
      overrides: [{ resourceType: "knowledge_base", resourceId: "kb-1", level: "read" }],
    });
    // FAIL-CLOSED: nothing in the segment mode may provision.
    expect(mockRepo.ensureDefaultWorkspaceRow).not.toHaveBeenCalled();
    expect(mockRepo.findDefaultWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("returns null — and provisions NOTHING — for a segment that misses", async () => {
    mockRepo.findWorkspaceByPublicId.mockResolvedValue(null);
    mockRepo.findMemberWorkspaceBySlug.mockResolvedValue(null);

    expect(await getBootState(USER, "someone-elses-workspace")).toBeNull();
    expect(mockRepo.ensureDefaultWorkspaceRow).not.toHaveBeenCalled();
    expect(mockRepo.findDefaultWorkspaceForUser).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("passes needsRedirect through for a legacy slug-only segment", async () => {
    mockRepo.findWorkspaceByPublicId.mockResolvedValue(null);
    mockRepo.findMemberWorkspaceBySlug.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue(membership("viewer"));

    const state = await getBootState(USER, "acme");
    expect(state).toMatchObject({
      segment: CANONICAL,
      needsRedirect: true,
      role: "viewer",
    });
  });
});

describe("getBootState — launch mode", () => {
  it("provisions the default workspace and answers its membership", async () => {
    mockRepo.findDefaultWorkspaceForUser.mockResolvedValue(WORKSPACE);
    mockRepo.findWorkspaceById.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue(membership("owner"));

    const state = await getBootState(USER, null);
    expect(state).toMatchObject({
      isOnboarded: true,
      workspace: WORKSPACE,
      segment: CANONICAL,
      needsRedirect: false,
      role: "owner",
      userId: USER,
    });
  });

  it("does NOT provision for a caller who has not finished onboarding", async () => {
    mockOnboarding.mockResolvedValue({ onboarded: false, surveyCompleted: false });

    const state = await getBootState(USER, null);
    expect(state).toMatchObject({
      isOnboarded: false,
      workspace: null,
      segment: null,
      role: null,
      myAccess: null,
    });
    expect(mockRepo.findDefaultWorkspaceForUser).not.toHaveBeenCalled();
    expect(mockRepo.ensureDefaultWorkspaceRow).not.toHaveBeenCalled();
  });

  it("404s a workspace the caller owns but is no longer an active member of", async () => {
    mockRepo.findDefaultWorkspaceForUser.mockResolvedValue(WORKSPACE);
    mockRepo.findWorkspaceById.mockResolvedValue(WORKSPACE);
    mockRepo.findMembership.mockResolvedValue({ ...membership(), status: "revoked" });

    await expect(getBootState(USER, null)).rejects.toMatchObject({
      status: 404,
      code: "WORKSPACE_NOT_FOUND",
    });
  });
});
