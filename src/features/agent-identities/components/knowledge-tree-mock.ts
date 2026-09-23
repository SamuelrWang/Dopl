import type { KnowledgeEntry, KnowledgeFolder } from "@/features/knowledge/types";

/**
 * One fake knowledge tree for the suites that render the knowledge picker (each `vi.mock` factory
 * `await import`s it). Two levels deep so a path must be walked up `parentId`.
 */
const TREE: Record<
  string,
  {
    folders: Array<Pick<KnowledgeFolder, "id" | "parentId" | "name" | "position">>;
    entries: Array<Pick<KnowledgeEntry, "id" | "folderId" | "title" | "position">>;
  }
> = {
  "kb-1": {
    folders: [
      { id: "f-1", parentId: null, name: "Deploys", position: 0 },
      { id: "f-2", parentId: "f-1", name: "Nightly", position: 0 },
    ],
    entries: [
      { id: "e-1", folderId: "f-2", title: "Rollback", position: 0 },
      { id: "e-2", folderId: null, title: "Loose", position: 1 },
    ],
  },
};

const EMPTY = { folders: [], entries: [] };

/** The hook's `Result<T>` shape; a null base id stays `idle` (the lazy case). */
export function useKnowledgeTree(baseId: string | null | undefined) {
  return {
    data: baseId ? (TREE[baseId] ?? EMPTY) : null,
    status: baseId ? ("success" as const) : ("idle" as const),
    error: null,
    refetch: () => {},
  };
}
