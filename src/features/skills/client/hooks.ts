"use client";

/**
 * Client-side hooks for the skills feature, backed by TanStack Query
 * (ENGINEERING §7). Return shape keeps the original `Result<T>`
 * contract — the frozen canvas panels consume `{ data, status, error,
 * refetch }` — with `SkillApiError` typing intact. Data is kept while
 * a same-key refetch is in flight (no flicker) and scoped per
 * workspace key (no cross-workspace leak).
 */

import { useQuery } from "@tanstack/react-query";
import type { Skill } from "@/features/skills/types";
import { SkillApiError, fetchSkills } from "./api";

export type SkillFetchStatus = "idle" | "loading" | "success" | "error";

interface Result<T> {
  data: T | null;
  error: SkillApiError | null;
  status: SkillFetchStatus;
  refetch: () => void;
}

function toApiError(err: unknown): SkillApiError {
  if (err instanceof SkillApiError) return err;
  return new SkillApiError(
    500,
    "INTERNAL_ERROR",
    err instanceof Error ? err.message : "Unknown error"
  );
}

export function useSkills(workspaceId?: string): Result<Skill[]> {
  const query = useQuery({
    queryKey: ["skills", workspaceId ?? "default"],
    queryFn: () =>
      fetchSkills(workspaceId).catch((err: unknown) =>
        Promise.reject(toApiError(err))
      ),
  });

  // Data wins over error: a failed background refetch must not blank an
  // already-rendered list into the error state.
  const status: SkillFetchStatus =
    query.data !== undefined ? "success" : query.error ? "error" : "loading";

  return {
    data: query.data ?? null,
    error: query.error ? toApiError(query.error) : null,
    status,
    refetch: query.refetch,
  };
}
