"use client";

/**
 * STAGING STUB of `src/features/knowledge/client/realtime.ts`. No Supabase channel: the staging
 * store is the only writer and every write already invalidates the query it changed.
 */
export function useKnowledgeRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  void workspaceId;
  void onChange;
}
