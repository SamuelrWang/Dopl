"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { GraphState } from "../graph-state";
import type { WorkspaceResource } from "../types";

interface WorkspaceResources {
  workspaceId: string;
  knowledge: WorkspaceResource[];
  skills: WorkspaceResource[];
  nameOf: (id: string) => string | null;
}

const EMPTY: WorkspaceResources = {
  workspaceId: "",
  knowledge: [],
  skills: [],
  nameOf: () => null,
};

const ResourcesContext = createContext<WorkspaceResources>(EMPTY);

/** Endpoint cap on `?ids=` — mirror it so we never send an over-limit request. */
const MAX_ENTRY_IDS = 100;

interface ResourceRow {
  id: string;
  name: string;
  visibility: string;
}

interface EntryRef {
  id: string;
  title: string;
  baseId: string;
  baseName: string;
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
const selectEntries = (body: { entries: EntryRef[] }) => body.entries;

/**
 * Knowledge bases + skills referenceable from ontology attributes (ref pickers
 * and name resolution). Knowledge attributes may hold whole-base ids OR base
 * ENTRY ids (MCP `set_attribute kind="knowledge"` accepts both); base ids
 * resolve from the bases list, entry ids batch-resolve through
 * `GET /api/knowledge/entries?ids=` — one query, no per-row waterfall.
 *
 * ⚠ All three endpoints enforce visibility SERVER-side; the pickers never
 * filter for security themselves.
 */
export function OntologyResourcesProvider({
  workspaceId,
  graph,
  children,
}: {
  workspaceId: string;
  graph: GraphState;
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

  const baseNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of knowledge ?? []) m.set(r.id, r.name);
    return m;
  }, [knowledge]);

  // Knowledge-attribute ids that aren't known bases are entry ids to resolve.
  // Sorted for a stable query key; capped at the endpoint limit.
  const entryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of Object.values(graph.objects)) {
      for (const attr of obj.attributes) {
        if (attr.value.kind !== "knowledge") continue;
        for (const id of attr.value.value) {
          if (!baseNames.has(id)) ids.add(id);
        }
      }
    }
    return [...ids].sort().slice(0, MAX_ENTRY_IDS);
  }, [graph, baseNames]);

  // ⚠ Query key moves whenever the picked id-set changes; keepPreviousData
  // stops existing chips flashing back to "Unavailable" mid-refetch.
  const entriesQuery = useApiQuery("/api/knowledge/entries", {
    workspaceId,
    query: entryIds.length > 0 ? { ids: entryIds.join(",") } : undefined,
    enabled: entryIds.length > 0,
    keepPreviousData: true,
    select: selectEntries,
  });
  const resolvedEntries = entriesQuery.data;

  const value = useMemo<WorkspaceResources>(() => {
    const k = knowledge ?? [];
    const s = skills ?? [];
    const byId = new Map<string, string>();
    for (const r of [...k, ...s]) byId.set(r.id, r.name);
    const entryNames = new Map<string, string>();
    for (const e of resolvedEntries ?? []) {
      entryNames.set(e.id, `${e.baseName} / ${e.title}`);
    }
    return {
      workspaceId,
      knowledge: k,
      skills: s,
      nameOf: (id) => byId.get(id) ?? entryNames.get(id) ?? null,
    };
  }, [workspaceId, knowledge, skills, resolvedEntries]);

  return <ResourcesContext.Provider value={value}>{children}</ResourcesContext.Provider>;
}

export function useWorkspaceResources(): WorkspaceResources {
  return useContext(ResourcesContext);
}
