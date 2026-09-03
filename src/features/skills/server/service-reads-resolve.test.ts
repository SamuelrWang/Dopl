/**
 * 🔒 **`resolveSkillBody` — A SKILL FOLLOWS ITS OWN ID, AND A SLUG DOES NOT
 * (B2).**
 *
 * ⚠ **THE FENCE ITSELF IS NOT RE-TESTED HERE.** Shared credentials, the `viewer`
 * floor, the container lock and the two-arm `.or()` are asserted un-mocked in
 * `shared/tenancy/resolve-resource.test.ts`; the follow is asserted in
 * `shared/tenancy/read-resource.test.ts`. This file owns what THIS feature's
 * read door does with the answer — including the half that is a REFUSAL to
 * follow, which no shared test can state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Skill, SkillContext } from "../types";

vi.mock("./repository");
vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { getSkillBySlug, resolveSkillBody } from "./service-reads";
import { SkillNotFoundError } from "./errors";

const ME = "user-me";
const OTHER = "user-other";
const HERE = "ws-here";
const THERE = "ws-there";
const ID = "44444444-4444-4444-4444-444444444444";

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    workspaceId: HERE,
    userId: ME,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: ME,
    ...over,
  };
}

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: ID,
    workspaceId: THERE,
    slug: "triage",
    publicId: "sk_triage",
    name: "Triage",
    description: "d",
    whenToUse: "w",
    whenNotToUse: null,
    connectors: [],
    status: "active",
    agentWriteEnabled: false,
    visibility: "private",
    accessMode: "workspace",
    folder: null,
    grantedTeamIds: [],
    createdBy: ME,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

/** A by-id read that answers in `THERE` and nowhere else — the shape a follow
 *  exists for. ⚠ `findSkillById` IS WORKSPACE-KEYED, so the first load must miss
 *  or there is nothing to follow. */
function livesInThere(over: Partial<Skill> = {}) {
  vi.mocked(repo.findSkillById).mockImplementation(async (workspaceId) =>
    workspaceId === THERE ? skill(over) : null
  );
}

function resolvedIn(containerId: string): ResolvedResource {
  return {
    type: "skill",
    id: ID,
    name: "Triage",
    containerId,
    containerName: "Acme",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "admin",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(repo.readSkillBody).mockResolvedValue(null);
  vi.mocked(repo.knowledgeBaseSlugExists).mockResolvedValue(false);
});

describe("🔒 a UUID names its own container", () => {
  it("reads the caller's own skill out of ANOTHER container of theirs", async () => {
    livesInThere();
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    const resolved = await resolveSkillBody(ctx(), ID);
    expect(resolved.skill).toMatchObject({ id: ID, workspaceId: THERE });
    // 🔒 ⚠ AND THE BODY IS READ THERE TOO. A follow that resolved the ROW in one
    // container and its CONTENTS in another is the bug this assertion exists
    // for — `readSkillBody` is workspace-keyed like every other read under it.
    expect(repo.readSkillBody).toHaveBeenCalledWith(THERE, ID);
  });

  it("🔒 RESOLUTION IS NOT AUTHORISATION — the matrix still refuses", async () => {
    livesInThere({ createdBy: OTHER });
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(resolveSkillBody(ctx(), ID)).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
  });

  it("404s an id that is nameable nowhere", async () => {
    vi.mocked(repo.findSkillById).mockResolvedValue(null);
    await expect(resolveSkillBody(ctx(), ID)).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
  });
});

describe("🔒 a SLUG does not follow, and that is the fence", () => {
  it("never asks the resolver about a slug", async () => {
    // ⚠ MUTATION CHECK. `skills` is unique on `(workspace_id, slug)` — per
    // CONTAINER — so the same slug legitimately names a different skill in each
    // container the caller is in, and every tie-break resolves one they did not
    // choose. An id is a primary key and has no such question.
    vi.mocked(repo.findSkillBySlug).mockResolvedValue(null);
    await expect(resolveSkillBody(ctx(), "triage")).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
    expect(repo.findSkillById).not.toHaveBeenCalled();
  });
});

describe("🔒 the WRITE gate did not move", () => {
  it("getSkillBySlug still refuses a skill outside this container", async () => {
    // ⚠ MUTATION CHECK: `service-writes.ts` funnels through it, so following an
    // id here would make `workspace=` ignorable on a PATCH (INVARIANTS §T35).
    vi.mocked(repo.findSkillById).mockResolvedValue(null);
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(getSkillBySlug(ctx(), ID)).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});
