/**
 * 🔒 THE HOME SPACE IS PERMANENT (Samuel's ruling R-35 / R-34, 2026-09-17:
 * *"Each user has a home space, and that should be permanent. Every user will
 * always have a home space, no matter what."*).
 *
 * Four claims, and they are deliberately at four different layers, because the
 * ruling is only true if every one of them holds:
 *   1. **DELETE is refused by the SERVICE** — `deleteWorkspaceForUser` 403s a
 *      `kind='home'` container for its OWNER, which is the only role that
 *      could have deleted it, and lets `standard` / `link` through unchanged.
 *   2. **LEAVING is refused by the SERVICE** — `removeMember` refuses on the
 *      KIND, ahead of the last-owner protection that would otherwise refuse for
 *      an accident of the roster.
 *   3. **DELETE is refused by the DATABASE** — the migration is read as SQL and
 *      asserted to carry the trigger AND its cascade exemption. ⚠ What this can
 *      prove is that the file still SAYS so; only a database can say Postgres
 *      agrees, which is the `rls-redteam` job's kind of claim, not this one.
 *   4. **ACCOUNT DELETION IS NOT BLOCKED** — the `pg_trigger_depth() > 1`
 *      exemption is asserted to run BEFORE the raise. Without it, permanence
 *      would pin every `auth.users` row forever: a retention bug wearing a
 *      security rule's clothes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpError } from "@/shared/lib/http-error";
import type { Role, Workspace, WorkspaceKind, WorkspaceMembership } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findWorkspaceByPublicId: vi.fn(),
  findMemberWorkspaceBySlug: vi.fn(),
  findMembership: vi.fn(),
  ensureHomeSpaceRow: vi.fn(),
  insertWorkspaceWithOwnerMembership: vi.fn(),
  listMembers: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
vi.mock("./last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("./seed-workspace", () => ({ seedNewWorkspace: vi.fn() }));
vi.mock("@/shared/tenancy/home-space", () => ({
  findHomeSpaceId: vi.fn(),
}));
vi.mock("@/features/billing/server/seats", () => ({ syncSeatQuantity: vi.fn() }));
vi.mock("@/features/channels/server/service", () => ({
  removeWorkspaceDepartedMember: vi.fn(),
}));
vi.mock("@/features/members/server/activity", () => ({ recordActivity: vi.fn() }));

import * as repo from "./repository";
import { deleteWorkspaceForUser } from "./service";
import { removeMember } from "./membership-admin";

const mockRepo = vi.mocked(repo);

const USER = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";

function workspace(kind?: WorkspaceKind): Workspace {
  return {
    id: WS,
    ownerId: USER,
    name: "Home",
    slug: kind === "home" ? "home" : "acme",
    publicId: "pub-abc123456789",
    description: null,
    iconUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...(kind ? { kind } : {}),
  };
}

function membership(role: Role = "owner"): WorkspaceMembership {
  return {
    workspaceId: WS,
    userId: USER,
    role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    lastSeenAt: null,
    invitedBy: null,
    invitedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findMembership.mockResolvedValue(membership());
});

describe("deleteWorkspaceForUser — a home space cannot be deleted", () => {
  it("403 HOME_SPACE_PERMANENT for the OWNER of a home space", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("home"));
    const err = (await deleteWorkspaceForUser(WS, USER).catch(
      (e) => e
    )) as HttpError;
    expect(err.status).toBe(403);
    expect(err.code).toBe("HOME_SPACE_PERMANENT");
    // ⚠ THE POINT OF THE TEST: no row left, not merely a message.
    expect(mockRepo.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("deletes a STANDARD workspace exactly as before", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("standard"));
    await deleteWorkspaceForUser(WS, USER);
    expect(mockRepo.deleteWorkspace).toHaveBeenCalledWith(WS);
  });

  it("deletes a LINK container — a relationship ends, and permanence is not a fence over every kind", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("link"));
    await deleteWorkspaceForUser(WS, USER);
    expect(mockRepo.deleteWorkspace).toHaveBeenCalledWith(WS);
  });

  it("an ABSENT kind reads as standard and still deletes (older row / narrowed projection)", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace());
    await deleteWorkspaceForUser(WS, USER);
    expect(mockRepo.deleteWorkspace).toHaveBeenCalledWith(WS);
  });

  it("a NON-owner still gets the role refusal, not the kind refusal", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("home"));
    mockRepo.findMembership.mockResolvedValue(membership("admin"));
    const err = (await deleteWorkspaceForUser(WS, USER).catch(
      (e) => e
    )) as HttpError;
    // Which KIND of row this is must not leak to somebody who may not delete it.
    expect(err.code).toBe("WORKSPACE_FORBIDDEN");
  });
});

describe("removeMember — nobody leaves a home space", () => {
  it("refuses on the KIND, ahead of the last-owner protection", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("home"));
    const err = (await removeMember(WS, USER, USER).catch((e) => e)) as HttpError;
    expect(err.status).toBe(403);
    expect(err.code).toBe("HOME_SPACE_PERMANENT");
    // NOT `WORKSPACE_LAST_OWNER`: that answer offers "transfer ownership first",
    // which is advice nobody can take on a container that admits no 2nd member.
    expect(err.code).not.toBe("WORKSPACE_LAST_OWNER");
  });

  it("is a no-op for a member who is not there — on every kind", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace("home"));
    mockRepo.findMembership.mockImplementation(async (_ws, user) =>
      user === USER ? membership() : null
    );
    await expect(removeMember(WS, USER, "33333333-3333-3333-3333-333333333333"))
      .resolves.toBeUndefined();
  });
});

describe("the DATABASE half — the live trigger, restated by 20261023120000_home_vocabulary_rename.sql", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20261023120000_home_vocabulary_rename.sql"
    ),
    "utf8"
  );

  it("installs a BEFORE DELETE trigger on public.workspaces", () => {
    expect(sql).toContain("BEFORE DELETE ON public.workspaces");
    expect(sql).toContain("public.enforce_home_space_permanent()");
  });

  it("raises only for kind = 'home'", () => {
    expect(sql).toContain("IF OLD.kind = 'home' THEN");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toContain("ERRCODE = 'check_violation'");
  });

  it("🔒 EXEMPTS THE CASCADE, AND DOES SO BEFORE THE RAISE — account deletion must still work", () => {
    const exemption = sql.indexOf("pg_trigger_depth() > 1");
    const raise = sql.indexOf("RAISE EXCEPTION");
    expect(exemption).toBeGreaterThan(-1);
    expect(raise).toBeGreaterThan(-1);
    // Order is the claim: an exemption after the raise never runs.
    expect(exemption).toBeLessThan(raise);
  });

  it("destroys nothing — a guard migration with a DROP in it is a different change", () => {
    // ⚠ STATEMENTS ONLY. The header quotes `DELETE FROM public.workspaces` while
    // explaining which delete the trigger fences, and a scan that cannot tell
    // prose from SQL would fail on the explanation.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
  });
});
