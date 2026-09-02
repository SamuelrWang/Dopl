/**
 * 🔒 **G16 — PUBLISHING INTO A PEER'S ROOM IS A SERVER PRECONDITION** (A11,
 * `docs/specs/mcp-v2-architecture.md`; findings §6 row 12, which recorded the
 * enforcement as **NONE**).
 *
 * ⚠ **THIS SUITE DRIVES ALL THREE FEATURE SERVICES, NOT THE HELPER ALONE**, and
 * that is the point of putting it here rather than beside any of them. The gap
 * it closes was one rule stated in one client; the repair is one predicate
 * called from three features, and a unit test of the predicate would pass just
 * as well if `createTemplate` never called it. Each `it` below reaches the real
 * service and asserts on the REPOSITORY — what was written, or that nothing was.
 *
 * ⚠ **SKILLS WERE THE THIRD CALLER AND THEY WERE MISSING UNTIL 2026-09-02.** A11
 * shipped the helper into knowledge bases and agent templates and left
 * `dopl_skill(op="set_visibility")` publishing into a peer's container with
 * nothing in front of it and nothing behind it — a row closed on two of three
 * types reads, from the ledger, as a row closed. That is why the arms below are
 * written per FEATURE rather than per axis: a fourth resource type that forgets
 * the call shows up here as a missing test, not as a passing one.
 *
 * FOUR REFUSAL-ADJACENT AXES, one arm each:
 *   1. the refusal itself (link + 2 members + shared visibility, no flag);
 *   2. the flag satisfying it;
 *   3. each clause of the predicate letting the write through on its own
 *      (standard workspace, solo container, private visibility);
 *   4. the UPDATE path, which is the other door to the same state (F-289's
 *      argument on a different axis).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("./repository", () => ({
  findDefaultWorkspaceForUser: vi.fn().mockResolvedValue(null),
  findWorkspaceById: vi.fn(),
}));
vi.mock("./repository-overview", () => ({
  countActiveMembers: vi.fn(),
}));

vi.mock("@/features/agent-templates/server/repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  insertTemplate: vi.fn(),
  updateTemplateRow: vi.fn(),
  hardDeleteTemplate: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  replaceTeamLinks: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  filterTeamIdsInWorkspace: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
  replaceKnowledgeLinks: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
}));

vi.mock("@/features/knowledge/server/repository", () => ({
  insertBase: vi.fn(),
  updateBaseRow: vi.fn(),
  hardDeleteBase: vi.fn(),
  listBaseSlugsForWorkspace: vi.fn(),
}));
vi.mock("@/features/knowledge/server/service-base-gates", () => ({
  assertCreatorCanReadItBack: vi.fn().mockResolvedValue(undefined),
  resolveHomeScope: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/features/knowledge/server/service-shared", () => ({
  assertAgentCanDelete: vi.fn(),
  assertBaseWritable: vi.fn().mockResolvedValue(undefined),
  deriveSlug: () => "notes",
  errorCode: () => undefined,
  listSlugs: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/features/knowledge/server/service-bases", () => ({
  getBaseById: vi.fn(),
}));

vi.mock("@/features/skills/server/repository", () => ({
  insertSkill: vi.fn(),
  updateSkillRow: vi.fn(),
  listSlugsForWorkspace: vi.fn(),
  readSkillBody: vi.fn(),
  pgErrorCode: () => undefined,
}));
vi.mock("@/features/skills/server/service-reads", () => ({
  getSkillBySlug: vi.fn(),
}));
vi.mock("@/features/skills/server/service-shared", () => ({
  assertAgentWriteAllowed: vi.fn().mockResolvedValue(undefined),
  stripNullBytes: (v: unknown) => v,
}));
vi.mock("@/features/skills/server/history", () => ({
  recordVersion: vi.fn().mockResolvedValue(undefined),
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/teams/server/repository", () => ({
  deleteGrantsForResource: vi.fn().mockResolvedValue(undefined),
  insertReadGrantsIfMissing: vi.fn().mockResolvedValue(undefined),
  listGrantsForResources: vi.fn().mockResolvedValue([]),
  listTeamIdsForUser: vi.fn().mockResolvedValue([]),
}));

import { findWorkspaceById } from "./repository";
import { countActiveMembers } from "./repository-overview";
import { ContainerPublishUnacknowledgedError } from "./shared-publish";
import * as templateRepo from "@/features/agent-templates/server/repository";
// ⚠ THE FEATURE'S OWN FIXTURES, NOT A THIRD COPY. `resetRepoMocks` is where the
// echo-what-you-inserted behaviour lives, and a hand-rolled row here would 404
// on its own result the first time `canSeeTemplate` moved.
import {
  OWNER,
  ctx as templateFixtureCtx,
  resetRepoMocks,
  template,
} from "@/features/agent-templates/server/service-writes-fixtures";
import {
  createTemplate,
  updateTemplate,
} from "@/features/agent-templates/server/service-writes";
import * as baseRepo from "@/features/knowledge/server/repository";
import { getBaseById } from "@/features/knowledge/server/service-bases";
import {
  createBase,
  updateBase,
} from "@/features/knowledge/server/service-base-writes";
import type { KnowledgeContext } from "@/features/knowledge/types";
import * as skillRepo from "@/features/skills/server/repository";
import {
  createSkill,
  updateSkill,
} from "@/features/skills/server/service-writes";
import { getSkillBySlug } from "@/features/skills/server/service-reads";
import type { SkillContext } from "@/features/skills/types";

const CONTAINER = "ws-link";
const USER = OWNER;

const mockWorkspace = vi.mocked(findWorkspaceById);
const mockCount = vi.mocked(countActiveMembers);
const mockTemplates = vi.mocked(templateRepo);
const mockBases = vi.mocked(baseRepo);
const mockGetBase = vi.mocked(getBaseById);
const mockSkills = vi.mocked(skillRepo);
const mockGetSkill = vi.mocked(getSkillBySlug);

/** The operator, at the keyboard, inside their own link container. */
function templateCtx() {
  return templateFixtureCtx({ workspaceId: CONTAINER, role: "owner" });
}

function knowledgeCtx(): KnowledgeContext {
  return {
    workspaceId: CONTAINER,
    userId: USER,
    source: "user",
    role: "owner",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: USER,
  } as KnowledgeContext;
}

function skillCtx(): SkillContext {
  return {
    workspaceId: CONTAINER,
    userId: USER,
    source: "user",
    role: "owner",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: USER,
  } as SkillContext;
}

/** What the room is, as the two DB facts the predicate reads. */
function room(kind: string, members: number): void {
  mockWorkspace.mockResolvedValue({ id: CONTAINER, kind } as never);
  mockCount.mockResolvedValue(members);
}

beforeEach(() => {
  vi.clearAllMocks();
  room("link", 2);

  resetRepoMocks(mockTemplates);
  mockTemplates.findTemplateById.mockResolvedValue(
    template({ workspaceId: CONTAINER })
  );

  mockBases.insertBase.mockResolvedValue({ id: "kb-1", slug: "notes" } as never);
  mockBases.updateBaseRow.mockResolvedValue({ id: "kb-1" } as never);
  mockBases.listBaseSlugsForWorkspace.mockResolvedValue([]);
  mockSkills.listSlugsForWorkspace.mockResolvedValue([]);
  mockSkills.insertSkill.mockResolvedValue({ id: "skill-1", slug: "ship-it" } as never);
  mockSkills.updateSkillRow.mockResolvedValue({ id: "skill-1", slug: "ship-it" } as never);
  mockSkills.readSkillBody.mockResolvedValue({ body: "" } as never);
  mockGetSkill.mockResolvedValue({
    id: "skill-1",
    slug: "ship-it",
    visibility: "private",
    accessMode: "workspace",
    createdBy: USER,
    updatedAt: "2026-09-02T00:00:00Z",
  } as never);
  mockGetBase.mockResolvedValue({
    id: "kb-1",
    slug: "notes",
    visibility: "private",
    accessMode: "workspace",
    createdBy: USER,
    updatedAt: "2026-09-02T00:00:00Z",
  } as never);
});

// ── The refusal ──────────────────────────────────────────────────────

describe("a publish into a shared link container without the flag", () => {
  it("refuses an agent-template create, and writes NOTHING", async () => {
    await expect(
      createTemplate(templateCtx(), { name: "Scout", visibility: "workspace" })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    // 🔒 THE ASSERTION THAT MATTERS. A gate placed after the insert would throw
    // the same error over a row that already exists — and a template published
    // into a peer's room is not undone by the caller seeing a 400.
    expect(mockTemplates.insertTemplate).not.toHaveBeenCalled();
  });

  it("refuses a knowledge-base create, before the slug is taken", async () => {
    await expect(
      createBase(knowledgeCtx(), { name: "Notes", visibility: "public" })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    expect(mockBases.insertBase).not.toHaveBeenCalled();
  });

  it("refuses a skill create, before the slug is taken", async () => {
    await expect(
      createSkill(skillCtx(), {
        name: "Ship it",
        description: "d",
        whenToUse: "w",
        visibility: "public",
      })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    expect(mockSkills.insertSkill).not.toHaveBeenCalled();
  });

  it("carries the code the route maps to a 400", async () => {
    const err = await createTemplate(templateCtx(), {
      name: "Scout",
      visibility: "workspace",
    }).catch((e: unknown) => e);
    expect((err as { code: string }).code).toBe(
      "CONTAINER_PUBLISH_UNACKNOWLEDGED"
    );
  });
});

// ── The flag ─────────────────────────────────────────────────────────

describe("acknowledgeShared: true", () => {
  it("lets the template create through, and is NOT written to the row", async () => {
    await createTemplate(templateCtx(), {
      name: "Scout",
      visibility: "workspace",
      acknowledgeShared: true,
    });
    expect(mockTemplates.insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace" })
    );
    // ⚠ IT IS A PRECONDITION, NOT A COLUMN. A flag that reached the repository
    // would be a schema change nobody asked for, and the next reader would take
    // it for a stored fact about the row.
    expect(mockTemplates.insertTemplate.mock.calls[0][0]).not.toHaveProperty(
      "acknowledgeShared"
    );
  });

  it("lets the knowledge-base create through", async () => {
    await createBase(knowledgeCtx(), {
      name: "Notes",
      visibility: "public",
      acknowledgeShared: true,
    });
    expect(mockBases.insertBase).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public" })
    );
  });

  it("lets the skill create through", async () => {
    await createSkill(skillCtx(), {
      name: "Ship it",
      description: "d",
      whenToUse: "w",
      visibility: "public",
      acknowledgeShared: true,
    });
    expect(mockSkills.insertSkill).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public" })
    );
    expect(mockSkills.insertSkill.mock.calls[0][0]).not.toHaveProperty(
      "acknowledgeShared"
    );
  });

  it("costs ZERO reads — the flag short-circuits before the room is looked up", async () => {
    // ⚠ THE QUERY BUDGET IS PART OF THE CONTRACT (`shared-publish.ts`): a
    // precondition that read two rows on every acknowledged create would put
    // the cost on the common path to fence the rare one.
    await createTemplate(templateCtx(), {
      name: "Scout",
      visibility: "workspace",
      acknowledgeShared: true,
    });
    expect(mockWorkspace).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });
});

// ── Each clause of the predicate, on its own ─────────────────────────

describe("the predicate is narrow, and every clause is load-bearing", () => {
  it("a STANDARD workspace publishes with no flag, and never counts members", async () => {
    room("standard", 40);
    await createTemplate(templateCtx(), { name: "Scout", visibility: "workspace" });
    expect(mockTemplates.insertTemplate).toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("a SOLO container publishes with no flag — there is no second audience", async () => {
    room("link", 1);
    await createTemplate(templateCtx(), { name: "Scout", visibility: "workspace" });
    expect(mockTemplates.insertTemplate).toHaveBeenCalled();
  });

  it("a PRIVATE create never asks the room anything", async () => {
    await createTemplate(templateCtx(), { name: "Scout", visibility: "private" });
    expect(mockTemplates.insertTemplate).toHaveBeenCalled();
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  it("a workspace row that vanished mid-request does not become a refusal", async () => {
    // ⚠ `withWorkspaceAuth` proved the membership before this ran, so `null`
    // means the row is gone and the write underneath fails on its own. Same
    // reading as `knowledge/server/service-audience.ts`'s.
    mockWorkspace.mockResolvedValue(null);
    await createTemplate(templateCtx(), { name: "Scout", visibility: "workspace" });
    expect(mockTemplates.insertTemplate).toHaveBeenCalled();
  });

  it("an UNREADABLE member count fails the request rather than passing it", async () => {
    // 🔒 THE ONE DIRECTION THIS MAY EVER FAIL. "I could not count the people in
    // this room" must never read as "there is nobody in it".
    mockCount.mockRejectedValue(new Error("PostgREST is down"));
    await expect(
      createTemplate(templateCtx(), { name: "Scout", visibility: "workspace" })
    ).rejects.toThrow("PostgREST is down");
    expect(mockTemplates.insertTemplate).not.toHaveBeenCalled();
  });
});

// ── The update door ──────────────────────────────────────────────────

describe("the UPDATE path is fenced too", () => {
  it("refuses a template patch that publishes, and writes no row", async () => {
    await expect(
      updateTemplate(templateCtx(), "tpl-1", { visibility: "workspace" })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    expect(mockTemplates.updateTemplateRow).not.toHaveBeenCalled();
  });

  it("refuses a knowledge-base patch that publishes, and upserts no grant", async () => {
    await expect(
      updateBase(knowledgeCtx(), "kb-1", { visibility: "public" })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    expect(mockBases.updateBaseRow).not.toHaveBeenCalled();
  });

  it("lets a RENAME through untouched — a patch that names no visibility publishes nothing", async () => {
    // ⚠ THE OPPOSITE CHOICE FROM THE PRIVATE FENCE, DELIBERATELY. This gate asks
    // what the caller CHANGED, not where the row LANDS: a row already shared is
    // already seen by the room, and making a rename acknowledge an audience it
    // did not touch is a gate on the wrong verb.
    mockGetBase.mockResolvedValue({
      id: "kb-1",
      slug: "notes",
      visibility: "public",
      accessMode: "workspace",
      createdBy: USER,
      updatedAt: "2026-09-02T00:00:00Z",
    } as never);
    await updateBase(knowledgeCtx(), "kb-1", { name: "Renamed" });
    expect(mockBases.updateBaseRow).toHaveBeenCalled();
    expect(mockWorkspace).not.toHaveBeenCalled();
  });

  it("refuses the skill patch `dopl_skill(op=\"set_visibility\")` sends, and writes no row", async () => {
    // 🔒 THE ROW G16 WAS RECORDED AS CLOSED WHILE THIS DOOR STOOD OPEN. It is the
    // publish lane for the one resource type A11 did not reach.
    await expect(
      updateSkill(skillCtx(), "ship-it", { visibility: "public" })
    ).rejects.toBeInstanceOf(ContainerPublishUnacknowledgedError);
    expect(mockSkills.updateSkillRow).not.toHaveBeenCalled();
  });

  it("lets a skill NARROW to private with no flag — that direction has no audience to warn", async () => {
    mockGetSkill.mockResolvedValue({
      id: "skill-1",
      slug: "ship-it",
      visibility: "public",
      accessMode: "workspace",
      createdBy: USER,
      updatedAt: "2026-09-02T00:00:00Z",
    } as never);
    await updateSkill(skillCtx(), "ship-it", { visibility: "private" });
    expect(mockSkills.updateSkillRow).toHaveBeenCalled();
  });

  it("accepts the acknowledged skill patch", async () => {
    await updateSkill(skillCtx(), "ship-it", {
      visibility: "public",
      acknowledgeShared: true,
    });
    expect(mockSkills.updateSkillRow).toHaveBeenCalled();
  });

  it("accepts the acknowledged patch", async () => {
    await updateTemplate(templateCtx(), "tpl-1", {
      visibility: "workspace",
      acknowledgeShared: true,
    });
    expect(mockTemplates.updateTemplateRow).toHaveBeenCalledWith(
      CONTAINER,
      "tpl-1",
      expect.objectContaining({ visibility: "workspace" })
    );
  });
});
