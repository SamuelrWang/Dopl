/**
 * INVARIANT SUITE — cross-feature workspace Trash aggregation + dispatch.
 *
 * Through the public aggregation surface with all five feature service
 * barrels mocked (no Supabase, no network):
 *   - `listWorkspaceTrash` flattens + normalizes every feature's trash shape
 *     into `TrashItem`, sorted newest-deleted first,
 *   - `purgesAt` = deletedAt + RETENTION_DAYS, and `detail` carries the KB
 *     parent name (knowledge) / "N objects" (cluster),
 *   - one feature list rejecting is logged + skipped, never blanking the rest,
 *   - `restoreTrashItem` / `purgeTrashItem` route each kind to the owning
 *     feature fn, and an unknown kind → 400 HttpError.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

vi.mock("@/features/knowledge/server/service", () => ({
  buildKnowledgeContext: vi.fn((a) => ({ feature: "knowledge", ...a })),
  listTrashedForWorkspace: vi.fn(),
  restoreBase: vi.fn(),
  restoreFolder: vi.fn(),
  restoreEntry: vi.fn(),
  purgeBase: vi.fn(),
  purgeFolder: vi.fn(),
  purgeEntry: vi.fn(),
}));

vi.mock("@/features/skills/server/service", () => ({
  buildSkillContext: vi.fn((a) => ({ feature: "skills", ...a })),
  listTrashedSkills: vi.fn(),
  restoreSkill: vi.fn(),
  purgeSkill: vi.fn(),
}));

vi.mock("@/features/workflows/server/service", () => ({
  listTrashedWorkflows: vi.fn(),
  restoreWorkflow: vi.fn(),
  purgeWorkflow: vi.fn(),
}));

vi.mock("@/features/chats/server/service", () => ({
  buildChatContext: vi.fn((a) => ({ feature: "chats", ...a })),
  listTrashedChats: vi.fn(),
  restoreChat: vi.fn(),
  purgeChat: vi.fn(),
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: vi.fn((a) => ({ feature: "ontology", ...a })),
  listTrashedClusters: vi.fn(),
  restoreCluster: vi.fn(),
  purgeCluster: vi.fn(),
}));

import { HttpError } from "@/shared/lib/http-error";
import * as chats from "@/features/chats/server/service";
import * as knowledge from "@/features/knowledge/server/service";
import * as ontology from "@/features/ontology/server/service";
import * as skills from "@/features/skills/server/service";
import * as workflows from "@/features/workflows/server/service";
import {
  RETENTION_DAYS,
  listWorkspaceTrash,
  purgeTrashItem,
  restoreTrashItem,
} from "./service";

const auth: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "ws",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

function expectedPurgesAt(deletedAt: string): string {
  return new Date(
    Date.parse(deletedAt) + RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default every list to empty; individual tests override what they exercise.
  vi.mocked(knowledge.listTrashedForWorkspace).mockResolvedValue([]);
  vi.mocked(skills.listTrashedSkills).mockResolvedValue([]);
  vi.mocked(workflows.listTrashedWorkflows).mockResolvedValue([]);
  vi.mocked(chats.listTrashedChats).mockResolvedValue([]);
  vi.mocked(ontology.listTrashedClusters).mockResolvedValue([]);
});

describe("listWorkspaceTrash", () => {
  it("aggregates + normalizes every feature, newest-deleted first", async () => {
    vi.mocked(knowledge.listTrashedForWorkspace).mockResolvedValue([
      {
        kind: "knowledge_entry",
        id: "e1",
        name: "Entry",
        deletedAt: "2026-02-10T00:00:00.000Z",
        parentName: "KB A",
      },
      {
        kind: "knowledge_base",
        id: "b1",
        name: "Base",
        deletedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(skills.listTrashedSkills).mockResolvedValue([
      { kind: "skill", id: "s1", name: "Skill", deletedAt: "2026-02-05T00:00:00.000Z" },
    ]);
    vi.mocked(workflows.listTrashedWorkflows).mockResolvedValue([
      { kind: "workflow", id: "w1", name: "WF", deletedAt: "2026-02-15T00:00:00.000Z" },
    ]);
    vi.mocked(chats.listTrashedChats).mockResolvedValue([
      { kind: "chat", id: "c1", name: "Chat", deletedAt: "2026-02-03T00:00:00.000Z" },
    ]);
    vi.mocked(ontology.listTrashedClusters).mockResolvedValue([
      {
        kind: "ontology_cluster",
        id: "cl1",
        name: "Cluster",
        deletedAt: "2026-02-20T00:00:00.000Z",
        objectCount: 3,
      },
    ]);

    const items = await listWorkspaceTrash(auth);

    // Sorted newest-deleted first across all kinds.
    expect(items.map((i) => i.id)).toEqual(["cl1", "w1", "e1", "s1", "c1", "b1"]);

    const byId = new Map(items.map((i) => [i.id, i]));
    // detail: KB parent name for a nested knowledge row.
    expect(byId.get("e1")?.detail).toBe("KB A");
    // detail: "N objects" for a cluster.
    expect(byId.get("cl1")?.detail).toBe("3 objects");
    // detail omitted where the feature supplies none.
    expect(byId.get("b1")?.detail).toBeUndefined();
    expect(byId.get("s1")?.detail).toBeUndefined();
    expect(byId.get("w1")?.detail).toBeUndefined();
    expect(byId.get("c1")?.detail).toBeUndefined();
  });

  it("computes purgesAt as deletedAt + RETENTION_DAYS", async () => {
    vi.mocked(ontology.listTrashedClusters).mockResolvedValue([
      {
        kind: "ontology_cluster",
        id: "cl1",
        name: "Cluster",
        deletedAt: "2026-02-20T00:00:00.000Z",
        objectCount: 1,
      },
    ]);

    const [item] = await listWorkspaceTrash(auth);
    expect(item.purgesAt).toBe(expectedPurgesAt("2026-02-20T00:00:00.000Z"));
  });

  it("skips a feature whose list rejects, keeping the rest", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(skills.listTrashedSkills).mockResolvedValue([
      { kind: "skill", id: "s1", name: "Skill", deletedAt: "2026-02-05T00:00:00.000Z" },
    ]);
    vi.mocked(workflows.listTrashedWorkflows).mockRejectedValue(new Error("boom"));

    const items = await listWorkspaceTrash(auth);

    expect(items.map((i) => i.id)).toEqual(["s1"]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("workflows"),
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});

describe("restoreTrashItem / purgeTrashItem dispatch", () => {
  it("routes each known kind to the owning feature fn", async () => {
    await restoreTrashItem(auth, "knowledge_base", "b1");
    expect(knowledge.restoreBase).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "knowledge" }),
      "b1"
    );

    await restoreTrashItem(auth, "skill", "s1");
    expect(skills.restoreSkill).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "skills" }),
      "s1"
    );

    // Workflows take (id, scope) — scope built from auth, not a ctx object.
    await restoreTrashItem(auth, "workflow", "w1");
    expect(workflows.restoreWorkflow).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ workspaceId: "ws-1", userId: "user-1", source: "user" })
    );

    await purgeTrashItem(auth, "chat", "c1");
    expect(chats.purgeChat).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "chats" }),
      "c1"
    );

    await purgeTrashItem(auth, "ontology_cluster", "cl1");
    expect(ontology.purgeCluster).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "ontology" }),
      "cl1"
    );

    await purgeTrashItem(auth, "knowledge_folder", "f1");
    expect(knowledge.purgeFolder).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "knowledge" }),
      "f1"
    );
  });

  it("rejects an unknown kind with a 400 HttpError", async () => {
    await expect(restoreTrashItem(auth, "bogus", "x")).rejects.toBeInstanceOf(HttpError);
    await expect(restoreTrashItem(auth, "bogus", "x")).rejects.toMatchObject({
      status: 400,
    });
    await expect(purgeTrashItem(auth, "nope", "y")).rejects.toMatchObject({
      status: 400,
    });

    // No feature fn is touched on the unknown-kind path.
    expect(knowledge.restoreBase).not.toHaveBeenCalled();
    expect(skills.purgeSkill).not.toHaveBeenCalled();
  });
});
