"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceResource } from "../types";

interface WorkspaceResources {
  knowledge: WorkspaceResource[];
  skills: WorkspaceResource[];
  nameOf: (id: string) => string | null;
}

const EMPTY: WorkspaceResources = { knowledge: [], skills: [], nameOf: () => null };

const ResourcesContext = createContext<WorkspaceResources>(EMPTY);

interface ResourceRow {
  id: string;
  name: string;
  visibility: string;
}

const toResources = (rows: ResourceRow[] | undefined): WorkspaceResource[] =>
  (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.visibility === "private" ? "Private" : "Workspace",
    accessible: true,
  }));

const selectBases = (body: { bases: ResourceRow[] }) => toResources(body.bases);
const selectSkills = (body: { skills: ResourceRow[] }) => toResources(body.skills);

/**
 * The knowledge bases and skills the caller can reference from
 * ontology attributes (ref pickers + name resolution on rendered ref
 * attributes). Both endpoints already enforce visibility server-side,
 * so whatever arrives here is what the caller may see — the pickers
 * never filter for security themselves. Query-cached: revisits render
 * names instantly without re-pulling both collections.
 */
export function OntologyResourcesProvider({
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
  const knowledge = basesQuery.data;
  const skills = skillsQuery.data;

  const value = useMemo<WorkspaceResources>(() => {
    const k = knowledge ?? [];
    const s = skills ?? [];
    const byId = new Map<string, string>();
    for (const r of [...k, ...s]) byId.set(r.id, r.name);
    return { knowledge: k, skills: s, nameOf: (id) => byId.get(id) ?? null };
  }, [knowledge, skills]);

  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useWorkspaceResources(): WorkspaceResources {
  return useContext(ResourcesContext);
}
