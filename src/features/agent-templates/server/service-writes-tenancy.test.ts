/**
 * 🔓 **WHICH CONTAINER A TEMPLATE WRITE LANDS IN — Samuel's ruling, 2026-09-06**
 * (INVARIANTS §T35; the argument is in `shared/tenancy/read-resource.ts`).
 *
 * ⚠ **A SECOND FILE FOR THE SAME SERVICE, AND ONLY BECAUSE OF THE §1 LINE CAP** —
 * the same reason `service-writes-junction.test.ts` exists. The harness is shared
 * (`service-writes-fixtures.ts`) so the two cannot drift; what lives HERE is the
 * tenancy question, and what lives there is the gate grid.
 *
 * Repository and resolver mocked; no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠ THE GRANT ARM IS A DB READ (F-604) — empty here, as in the sibling suites.
vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

// 🔓 THE FOLLOW ITSELF. ⚠ The FENCE is not re-tested here — `shared/tenancy/
// resolve-resource.test.ts` owns its four clauses un-mocked, and this file owns
// only what the WRITE does with the address it is handed.
vi.mock("@/shared/tenancy/resolve-resource", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resolve-resource")
  >()),
  resolveResource: vi.fn(async () => null),
}));

// 🔒 G16's two reads — unmocked they reach Supabase and hang.
vi.mock("@/features/workspaces/server/repository", () => ({
  findDefaultWorkspaceForUser: vi.fn().mockResolvedValue(null),
  findWorkspaceById: vi.fn().mockResolvedValue({ id: "ws-1", kind: "standard" }),
}));
vi.mock("@/features/workspaces/server/repository-overview", () => ({
  countActiveMembers: vi.fn().mockResolvedValue(1),
}));
vi.mock("./repository", () => ({
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

import * as repo from "./repository";
import { resolveResource } from "@/shared/tenancy/resolve-resource";
import { deleteTemplate, updateTemplate } from "./service";
import { AgentTemplateNotFoundError } from "./errors";
import {
  OTHER,
  OWNER,
  ctx,
  resetRepoMocks,
  template,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockResolve = vi.mocked(resolveResource);

beforeEach(() => {
  vi.clearAllMocks();
  resetRepoMocks(mockRepo);
});

/**
 * 🔓 **THE WRITE DOORS FOLLOW THE ID — SAMUEL'S RULING, 2026-09-06** (INVARIANTS
 * §T35, rewritten; the argument is in `shared/tenancy/read-resource.ts`).
 *
 * ⚠ **THE REPORTED SHAPE WAS AN AGENT THAT COULD READ A TEMPLATE ON ITS
 * OPERATOR'S PERSONAL SHELF AND COULD NOT EDIT IT** — `AGENT_TEMPLATE_NOT_FOUND`
 * from `op="update"` for the very row `op="get"` had just rendered, one call
 * earlier, in the same session. The read door followed the id from A12 onward;
 * the write door did not, and the comment on it said outright that the ruling
 * was owed.
 *
 * ⚠ **THE CONTAINER ASSERTIONS ARE THE LOAD-BEARING ONES.** A gate that follows
 * an id and then writes through the ORIGINAL context would authorise against one
 * container and mutate another — strictly worse than the refusal it replaces —
 * so what each case pins is the ARGUMENT the repository received.
 */
describe("🔓 update and delete name the id's own container", () => {
  const SHELF = "ws-personal";

  /** Present in `SHELF`, absent everywhere else — the shape of a row on the
   *  caller's personal shelf, read from a channel they are standing in. */
  function livesOnTheShelf(over: Partial<ReturnType<typeof template>> = {}) {
    mockRepo.findTemplateById.mockImplementation(
      (async (workspaceId: string) =>
        workspaceId === SHELF
          ? template({ workspaceId: SHELF, ...over })
          : null) as never
    );
    mockResolve.mockResolvedValue({
      type: "agent_template",
      id: "tpl-1",
      name: "Researcher",
      containerId: SHELF,
      containerName: "Samuel's Workspace",
      containerKind: "personal",
      ownedByCaller: true,
      containerRole: "owner",
    } as never);
  }

  it("PATCHes a template on the caller's shelf, and updates it THERE", async () => {
    livesOnTheShelf();
    mockRepo.updateTemplateRow.mockResolvedValue(template({ workspaceId: SHELF }));
    await expect(
      updateTemplate(ctx(), "tpl-1", { name: "Renamed" })
    ).resolves.toMatchObject({ id: "tpl-1" });
    // ⚠ MUTATION CHECK. `ctx.workspaceId` here is `ws-1`, and that is what this
    // read before the ruling: the row was gated in one container and written in
    // another, which is the same UPDATE landing on zero rows.
    expect(mockRepo.updateTemplateRow).toHaveBeenCalledWith(
      SHELF,
      "tpl-1",
      expect.objectContaining({ name: "Renamed" })
    );
  });

  it("replaces BOTH junctions in that container too", async () => {
    livesOnTheShelf();
    mockRepo.updateTemplateRow.mockResolvedValue(template({ workspaceId: SHELF }));
    await updateTemplate(ctx(), "tpl-1", { knowledgeBaseIds: [] });
    // ⚠ A junction row filed under the calling room is a link the row's own
    // container never reads back — the template would come back attachment-less.
    expect(mockRepo.replaceKnowledgeLinks).toHaveBeenCalledWith(
      SHELF,
      "tpl-1",
      [],
      OWNER
    );
  });

  it("DELETEs it there as well", async () => {
    livesOnTheShelf();
    await expect(deleteTemplate(ctx(), "tpl-1")).resolves.toBeUndefined();
    expect(mockRepo.hardDeleteTemplate).toHaveBeenCalledWith(SHELF, "tpl-1");
  });

  it("🔒 and the matrix still runs in the container the id named", async () => {
    // ⚠ FOLLOWING AN ID AUTHORISES NOTHING. Somebody else's private row is the
    // same single 404 it always was, and no write is attempted.
    livesOnTheShelf({ createdBy: OTHER, visibility: "private" });
    const err = await updateTemplate(ctx(), "tpl-1", { name: "Hijacked" }).catch(
      (e) => e
    );
    expect(err.code).toBe("AGENT_TEMPLATE_NOT_FOUND");
    expect(mockRepo.updateTemplateRow).not.toHaveBeenCalled();
  });

  it("🔒 an id that resolves NOWHERE is still a 404, and costs one resolve", async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    mockResolve.mockResolvedValue(null);
    await expect(deleteTemplate(ctx(), "tpl-1")).rejects.toBeInstanceOf(
      AgentTemplateNotFoundError
    );
    expect(mockRepo.hardDeleteTemplate).not.toHaveBeenCalled();
  });

  it("costs NOTHING on the hit path — a row found where it was asked never resolves", async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    await deleteTemplate(ctx(), "tpl-1");
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRepo.hardDeleteTemplate).toHaveBeenCalledWith("ws-1", "tpl-1");
  });
});
