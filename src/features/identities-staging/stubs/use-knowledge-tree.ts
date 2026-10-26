"use client";

/**
 * STAGING STUB of `src/features/knowledge/client/hooks.ts › useKnowledgeTree`, as the knowledge
 * picker's lazy tree reads it: `null` id = idle; otherwise one loading beat, then the base's
 * folders + entries from `/knowledge`'s seed. Same `{ data, status, error, refetch }` shape.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import { KNOWLEDGE_BASES, KNOWLEDGE_ENTRIES, KNOWLEDGE_FOLDERS } from "../data";

type Tree = { base: KnowledgeBase; folders: KnowledgeFolder[]; entries: KnowledgeEntry[] };

export function useKnowledgeTree(
  baseId: string | null | undefined,
  workspaceId?: string
): {
  data: Tree | null;
  status: "idle" | "loading" | "success" | "error";
  error: Error | null;
  refetch: () => void;
} {
  void workspaceId;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!baseId) return;
    const t = setTimeout(() => setLoadedFor(baseId), 180);
    return () => clearTimeout(t);
  }, [baseId]);
  const data = useMemo<Tree | null>(() => {
    if (!baseId || loadedFor !== baseId) return null;
    const base = KNOWLEDGE_BASES.find((b) => b.id === baseId);
    if (!base) return null;
    return {
      base,
      folders: KNOWLEDGE_FOLDERS.filter((f) => f.knowledgeBaseId === baseId),
      entries: KNOWLEDGE_ENTRIES.filter((e) => e.knowledgeBaseId === baseId),
    };
  }, [baseId, loadedFor]);
  return {
    data,
    status: !baseId ? "idle" : data ? "success" : "loading",
    error: null,
    refetch: () => {},
  };
}
