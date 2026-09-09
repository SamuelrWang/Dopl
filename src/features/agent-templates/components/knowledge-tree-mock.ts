import type { KnowledgeEntry, KnowledgeFolder } from "@/features/knowledge/types";

/**
 * ONE FAKE KNOWLEDGE TREE for the three suites that render the knowledge picker.
 *
 * ⚠ **A HELPER, NOT A `vi.mock` FACTORY.** Vitest hoists `vi.mock` above the
 * imports, so a factory cannot close over a module-scope value — each suite
 * writes its own two-line factory that `await import`s this. What is shared is
 * the SHAPE of the tree, which three files would otherwise re-type and drift on.
 *
 * ⚠ TWO LEVELS DEEP ON PURPOSE (`Deploys/Nightly`): a one-level tree cannot tell
 * a path composed by walking `parentId` from one that concatenates a folder's
 * own name, which is the bug the picker's path derivation exists to avoid.
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

/** The hook's own `Result<T>` shape — `data` held, never thrown. ⚠ A null base
 *  id is the LAZY case and stays `idle`, which is what makes an unexpanded base
 *  cost no request. */
export function useKnowledgeTree(baseId: string | null | undefined) {
  return {
    data: baseId ? (TREE[baseId] ?? EMPTY) : null,
    status: baseId ? ("success" as const) : ("idle" as const),
    error: null,
    refetch: () => {},
  };
}
