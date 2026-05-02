"use client";

/**
 * Client-side hooks for the skills feature. Same `useEffect + fetch +
 * useState` pattern as `useKnowledgeBases` — see ENGINEERING.md
 * "Known debt" for the planned migration to a query library.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

function useFetch<T>(
  key: string | null | undefined,
  loader: () => Promise<T>
): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<SkillApiError | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loaderRef
      .current()
      .then((next) => {
        if (cancelled) return;
        setError(null);
        setData(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(toApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const status: SkillFetchStatus = !key
    ? "idle"
    : error
      ? "error"
      : data !== null
        ? "success"
        : "loading";
  return { data, error, status, refetch };
}

export function useSkills(workspaceId?: string): Result<Skill[]> {
  return useFetch<Skill[]>(workspaceId ?? "default", () =>
    fetchSkills(workspaceId)
  );
}
