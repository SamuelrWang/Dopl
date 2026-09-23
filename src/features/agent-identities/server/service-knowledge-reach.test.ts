/**
 * The launch payload's knowledge reach: an attachment the viewer filter drops still launches, is
 * counted in `unreachableKnowledgeBaseCount`, and discloses nothing else (the desktop writes the count
 * into text an agent reads).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity } from "../types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import { resolveIdentityForLaunch } from "./service";
import {
  AUDITOR,
  OWNER as CREATOR,
  ctx,
  identity as baseIdentity,
  resetReadMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancy);

const REACHABLE = "kb-reachable";
const OUT_OF_REACH = "kb-out-of-reach";

const identity = (over: Partial<AgentIdentity> = {}) => baseIdentity({ ...AUDITOR, ...over });

/** A junction row: the identity NAMES this base, whatever the reader can see. */
const link = (knowledgeBaseId: string) => ({
  identityId: "id-1",
  knowledgeBaseId,
  scopeKind: "base" as const,
  folderId: null,
  entryId: null,
});
const folderLink = (knowledgeBaseId: string, folderId: string) =>
  ({ ...link(knowledgeBaseId), scopeKind: "folder" as const, folderId });
const entryLink = (knowledgeBaseId: string, entryId: string) =>
  ({ ...link(knowledgeBaseId), scopeKind: "entry" as const, entryId });

/** A base row the viewer filter WILL keep — public, workspace-wide. */
const visibleBase = (id: string, name: string) => ({
  id,
  name,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  createdBy: CREATOR,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTenancy.resolveResource.mockResolvedValue(null);
  mockRepo.findIdentityById.mockResolvedValue(identity());
  resetReadMocks(mockRepo);
});

describe("the count", () => {
  it("is 0 when the identity attaches nothing", async () => {
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([]);
  });

  it("is 0 when every attachment resolves", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(REACHABLE)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });

  it("counts the attachment the viewer filter dropped — THE RULED CASE", async () => {
    // The junction row exists; the base row does not come back.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("counts only the dropped ones when an identity has both", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      link(REACHABLE),
      link(OUT_OF_REACH),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });
});

describe("what it must NOT do", () => {
  it("does not block the launch — the payload is whole, minus the base", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.name).toBe("Code Auditor");
    expect(resolved.instructions).toBe("Audit the diff.");
    expect(resolved.knowledgeBases).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("says NOTHING about the dropped base beyond the count — no id, no name, no container", async () => {
    // Serialised: the dropped id may not appear at any depth.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(JSON.stringify(resolved)).not.toContain(OUT_OF_REACH);
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledge",
      "knowledgeBases",
      "model",
      "name",
      "runtime",
      "unreachableKnowledgeBaseCount",
    ]);
  });

  it("issues NO second read to find out where the base went", async () => {
    // The count is over rows already read; a probe for the missing base is what the rule forbids.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    await resolveIdentityForLaunch(ctx(), "id-1");
    expect(mockRepo.listKnowledgeLinksForIdentities).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledWith("ws-1", [
      OUT_OF_REACH,
    ]);
  });
});

/** A scope drops with its base, or on its own (trashed, or in another base), into the same count. */
describe("folder and entry scopes", () => {
  const FOLDER = "f-1";
  const ENTRY = "e-1";

  it("renders a folder scope as a path, and a toolPath that is NOT the display one", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: "f-0", knowledgeBaseId: REACHABLE, parentId: null, name: "Runbooks" },
      { id: FOLDER, knowledgeBaseId: REACHABLE, parentId: "f-0", name: "Deploys" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge).toEqual([
      {
        baseId: REACHABLE,
        baseName: "Ops Notes",
        scope: "folder",
        folderId: FOLDER,
        folderName: "Deploys",
        path: "Ops Notes / Runbooks / Deploys",
        // The base-relative `dopl_kb` address; a base named "Ops / Legal" makes splitting `path` wrong.
        toolPath: "Runbooks/Deploys",
      },
    ]);
    // Listing the base here would tell an older reader the whole base is attached.
    expect(resolved.knowledgeBases).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
  });

  it("renders an entry scope at its folder's path", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      entryLink(REACHABLE, ENTRY),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: "f-0", knowledgeBaseId: REACHABLE, parentId: null, name: "Runbooks" },
    ]);
    mockRepo.listLiveEntryRows.mockResolvedValue([
      { id: ENTRY, knowledgeBaseId: REACHABLE, folderId: "f-0", title: "Rollback" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge[0]?.path).toBe("Ops Notes / Runbooks / Rollback");
    expect(resolved.knowledge[0]?.toolPath).toBe("Runbooks/Rollback");
  });

  it("drops a TRASHED entry into the same count, naming nothing", async () => {
    // A soft delete reaches this layer as the live-entry read not returning the row.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      entryLink(REACHABLE, ENTRY),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveEntryRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(JSON.stringify(resolved)).not.toContain(ENTRY);
  });

  it("drops a folder that lives in ANOTHER base — the row is not evidence", async () => {
    // The trigger refuses this write; this refuses reading a row written before the trigger.
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      { id: FOLDER, knowledgeBaseId: OUT_OF_REACH, parentId: null, name: "Elsewhere" },
    ]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("drops every scope of a base the viewer cannot see, without reading its tree", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(OUT_OF_REACH, FOLDER),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(mockRepo.listLiveFoldersForBases).not.toHaveBeenCalled();
  });
});

/** The card a `scope: "base"` ref carries (slug, summary, top folders, count); an invisible base gets none. */
describe("the base card", () => {
  const folder = (id: string, name: string, description: string | null = null) => ({
    id,
    knowledgeBaseId: REACHABLE,
    parentId: null,
    name,
    description,
  });

  beforeEach(() => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(REACHABLE)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      {
        ...visibleBase(REACHABLE, "Deploys"),
        slug: "deploys",
        description: "How this service is released.",
      },
    ]);
  });

  it("carries the slug, the summary, the TOP-LEVEL folders and the true count", async () => {
    mockRepo.listLiveFoldersForBases.mockResolvedValue([
      folder("f-1", "Runbooks", "one per incident class"),
      folder("f-2", "Postmortems"),
      // A child folder is not a card folder: the subtree is `get_tree`'s job, and the card stays bounded.
      { ...folder("f-3", "2026"), parentId: "f-2" },
    ]);

    const [ref] = (await resolveIdentityForLaunch(ctx(), "id-1")).knowledge;
    expect(ref.baseSlug).toBe("deploys");
    expect(ref.baseSummary).toBe("How this service is released.");
    expect(ref.baseFolders).toEqual([
      { name: "Runbooks", summary: "one per incident class" },
      { name: "Postmortems" },
    ]);
    expect(ref.baseFolderCount).toBe(2);
  });

  it("says NOTHING about a base the viewer cannot see — not even its shape", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([link(OUT_OF_REACH)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);

    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.knowledge).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(JSON.stringify(resolved)).not.toContain(OUT_OF_REACH);
  });

  it("a FOLDER scope gets no card — it already names the thing it points at", async () => {
    mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([
      folderLink(REACHABLE, "f-1"),
    ]);
    mockRepo.listLiveFoldersForBases.mockResolvedValue([folder("f-1", "Runbooks")]);

    const [ref] = (await resolveIdentityForLaunch(ctx(), "id-1")).knowledge;
    expect(ref.scope).toBe("folder");
    expect(ref.baseSlug).toBeUndefined();
    expect(ref.baseFolders).toBeUndefined();
    expect(ref.baseFolderCount).toBeUndefined();
  });

  it("a base with no folders carries a count of 0, which is an ANSWER", async () => {
    mockRepo.listLiveFoldersForBases.mockResolvedValue([]);
    const [ref] = (await resolveIdentityForLaunch(ctx(), "id-1")).knowledge;
    expect(ref.baseFolders).toEqual([]);
    expect(ref.baseFolderCount).toBe(0);
  });
});
