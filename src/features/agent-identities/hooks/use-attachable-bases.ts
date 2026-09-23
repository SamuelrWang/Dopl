"use client";

/**
 * The knowledge bases an identity can attach, with the read's state kept apart
 * (P9-04): `pending` is not "no knowledge here", and a failed read is neither.
 * The editor's picker and the /home card popup read it the same way.
 */

import { useMemo } from "react";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";
import type { KnowledgeBaseOption } from "../components/knowledge-scope-picker";

export type AttachableBasesState = "pending" | "failed" | "ready";

export interface AttachableBases {
  bases: ReadonlyArray<KnowledgeBaseOption>;
  state: AttachableBasesState;
  retry: () => void;
}

const NO_BASES: ReadonlyArray<KnowledgeBaseOption> = Object.freeze([]);

export function useAttachableBases(workspaceId: string): AttachableBases {
  const list = useKnowledgeBaseList(workspaceId);
  const bases = useMemo(
    () => list.data?.bases.map((b) => ({ id: b.id, name: b.name })) ?? NO_BASES,
    [list.data]
  );
  const state: AttachableBasesState = list.data
    ? "ready"
    : list.status === "error"
      ? "failed"
      : "pending";
  return { bases, state, retry: list.refetch };
}
