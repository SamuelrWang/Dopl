"use client";

import { STAGING_PROFILE, STAGING_WORKSPACES } from "../settings-mock-data";

/**
 * STUB of `@/shared/hooks/use-api-query › useApiQuery` (and the desktop's `#/hooks/use-api-query`),
 * answering the GETs the staged settings panes make from fake data. Same call shape; `select` runs.
 */
const ANSWERS: Record<string, unknown> = {
  "/api/workspaces": { workspaces: STAGING_WORKSPACES },
  "/api/workspaces/me": { role: "owner", userId: "staging" },
  "/api/user/profile": STAGING_PROFILE,
};

export function useApiQuery<T, S = T>(
  path: string | null,
  opts: { select?: (body: T) => S; enabled?: boolean; workspaceId?: string } = {}
): { data: S | undefined; error: null; isError: false; isPending: boolean; refetch: () => Promise<void> } {
  const body = path && opts.enabled !== false ? (ANSWERS[path] as T | undefined) : undefined;
  const data = body === undefined ? undefined : opts.select ? opts.select(body) : (body as unknown as S);
  return { data, error: null, isError: false, isPending: data === undefined, refetch: async () => {} };
}

/**
 * STUB of `@/shared/api/api-client › apiRequest` for the staged panes' writes (profile save,
 * disconnect, remove, rename). Nothing leaves the page: it waits a beat and echoes the body.
 */
export async function apiRequest<T>(
  path: string,
  opts: { method?: string; body?: unknown; workspaceId?: string } = {}
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  // The rail's request-access gate (popups-staging): unrequested on open, requested after the press.
  if (path === "/api/user/workspace-access-request") return { requested: opts.method === "POST" } as T;
  if (opts.body && typeof opts.body === "object") return { ...STAGING_PROFILE, ...opts.body } as T;
  return {} as T;
}
