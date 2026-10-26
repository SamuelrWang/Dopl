"use client";

/** STAGING STUB of `src/features/members/hooks/use-teams.ts`: the seeded teams, same shape. */
import { useEffect, useState } from "react";
import type { TeamView } from "@/features/teams/types";
import { knowledgeDb } from "../fake-store";

export function useTeams(workspaceSlug: string) {
  void workspaceSlug;
  // One tick of `loading`, as the real read has, so the pending branch renders too.
  const [teams, setTeams] = useState<TeamView[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTeams(knowledgeDb().teams.map((x) => ({ ...x }))), 120);
    return () => clearTimeout(t);
  }, []);
  return {
    teams,
    loading: teams === null,
    error: null as string | null,
    refresh: () => setTeams(knowledgeDb().teams.map((x) => ({ ...x }))),
  };
}
