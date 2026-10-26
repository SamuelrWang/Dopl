"use client";

/**
 * STAGING STAND-IN for `src/features/ontology/hooks/use-workspace-resources.tsx`:
 * same provider + hook API, fed by `data/demo-ontology-data.ts` instead of
 * `/api/knowledge/bases`, `/api/skills` and `/api/knowledge/entries`.
 * The pane is the operator's HOME space, which has no skills (`homeSpace: true`).
 * ⚠ PORTING: do not port this file.
 */

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { GraphState } from "@/features/ontology/graph-state";
import type { WorkspaceResource } from "@/features/ontology/types";
import {
  DEMO_KNOWLEDGE_BASES,
  DEMO_KNOWLEDGE_ENTRIES,
} from "../../data/demo-ontology-data";

interface WorkspaceResources {
  workspaceId: string;
  knowledge: WorkspaceResource[];
  skills: WorkspaceResource[];
  nameOf: (id: string) => string | null;
  homeSpace: boolean;
}

const EMPTY: WorkspaceResources = {
  workspaceId: "",
  homeSpace: false,
  knowledge: [],
  skills: [],
  nameOf: () => null,
};

const ResourcesContext = createContext<WorkspaceResources>(EMPTY);

export function OntologyResourcesProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  graph: GraphState;
  children: ReactNode;
}) {
  const value = useMemo<WorkspaceResources>(() => {
    const knowledge: WorkspaceResource[] = DEMO_KNOWLEDGE_BASES.map((b) => ({
      id: b.id,
      name: b.name,
      scope: b.visibility === "private" ? "Private" : "Workspace",
      accessible: true,
    }));
    const names = new Map<string, string>();
    for (const b of DEMO_KNOWLEDGE_BASES) {
      names.set(b.id, b.name);
      for (const e of DEMO_KNOWLEDGE_ENTRIES[b.id] ?? []) {
        names.set(e.id, `${b.name} / ${e.title}`);
      }
    }
    return {
      workspaceId,
      knowledge,
      skills: [],
      nameOf: (id) => names.get(id) ?? null,
      homeSpace: true,
    };
  }, [workspaceId]);
  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useWorkspaceResources(): WorkspaceResources {
  return useContext(ResourcesContext);
}
