"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspaceResource } from "../types";

interface WorkspaceResources {
  knowledge: WorkspaceResource[];
  skills: WorkspaceResource[];
  nameOf: (id: string) => string | null;
}

const EMPTY: WorkspaceResources = { knowledge: [], skills: [], nameOf: () => null };

const ResourcesContext = createContext<WorkspaceResources>(EMPTY);

/**
 * The knowledge bases and skills the caller can reference from
 * ontology attributes. Both endpoints already enforce visibility
 * server-side, so whatever arrives here is what the caller may see —
 * the pickers never filter for security themselves.
 */
export function OntologyResourcesProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [knowledge, setKnowledge] = useState<WorkspaceResource[]>([]);
  const [skills, setSkills] = useState<WorkspaceResource[]>([]);

  useEffect(() => {
    let cancelled = false;
    const headers = { "x-workspace-id": workspaceId };

    fetch("/api/knowledge/bases", { headers })
      .then((r) => (r.ok ? r.json() : { bases: [] }))
      .then((body: { bases?: Array<{ id: string; name: string; visibility: string }> }) => {
        if (cancelled) return;
        setKnowledge(
          (body.bases ?? []).map((b) => ({
            id: b.id,
            name: b.name,
            scope: b.visibility === "private" ? "Private" : "Workspace",
            accessible: true,
          }))
        );
      })
      .catch(() => undefined);

    fetch("/api/skills", { headers })
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((body: { skills?: Array<{ id: string; name: string; visibility: string }> }) => {
        if (cancelled) return;
        setSkills(
          (body.skills ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            scope: s.visibility === "private" ? "Private" : "Workspace",
            accessible: true,
          }))
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const value = useMemo<WorkspaceResources>(() => {
    const byId = new Map<string, string>();
    for (const r of [...knowledge, ...skills]) byId.set(r.id, r.name);
    return { knowledge, skills, nameOf: (id) => byId.get(id) ?? null };
  }, [knowledge, skills]);

  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useWorkspaceResources(): WorkspaceResources {
  return useContext(ResourcesContext);
}
