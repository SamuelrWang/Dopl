"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";

/**
 * The knowledge bases and skills the caller can attach to a workflow step
 * (read refs + action refs). Both endpoints enforce visibility server-side,
 * so whatever arrives here is attachable — the pickers never filter for
 * security. Query-cached; revisits render instantly. Parallels ontology's
 * OntologyResourcesProvider but is standalone (features don't import each
 * other's components — ENGINEERING §3), and it needs no graph because step
 * read/action chips already carry their resolved `name` from the API.
 */

export interface WorkspacePickResource {
  id: string;
  name: string;
  /** Sharing scope — groups the skill picker. */
  scope: string;
}

interface WorkflowResources {
  workspaceId: string;
  bases: WorkspacePickResource[];
  skills: WorkspacePickResource[];
}

const EMPTY: WorkflowResources = { workspaceId: "", bases: [], skills: [] };
const ResourcesContext = createContext<WorkflowResources>(EMPTY);

interface ResourceRow {
  id: string;
  name: string;
  visibility: string;
}

const toResources = (rows: ResourceRow[] | undefined): WorkspacePickResource[] =>
  (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.visibility === "private" ? "Private" : "Workspace",
  }));

const selectBases = (body: { bases: ResourceRow[] }) => toResources(body.bases);
const selectSkills = (body: { skills: ResourceRow[] }) => toResources(body.skills);

export function WorkflowResourcesProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const basesQuery = useApiQuery("/api/knowledge/bases", {
    workspaceId,
    select: selectBases,
  });
  const skillsQuery = useApiQuery("/api/skills", {
    workspaceId,
    select: selectSkills,
  });

  const value = useMemo<WorkflowResources>(
    () => ({
      workspaceId,
      bases: basesQuery.data ?? [],
      skills: skillsQuery.data ?? [],
    }),
    [workspaceId, basesQuery.data, skillsQuery.data]
  );

  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useWorkflowResources(): WorkflowResources {
  return useContext(ResourcesContext);
}
