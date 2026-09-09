"use client";

/**
 * Typed client wrappers for the changelog endpoints. Same conventions as
 * `knowledge/client/api.ts` — `workspaceId` becomes `X-Workspace-Id`, `!res.ok`
 * becomes an `ApiError` — reached through the SHARED `apiRequest` so the web
 * tree and the bundled SPA leave on the same wire.
 */
import { apiRequest } from "@/shared/api/api-client";
import type { KnowledgeEntry } from "@/features/knowledge/types";
import type { RevisionPage } from "../types";

export interface RevisionPageArgs {
  cursor?: string | null;
  limit?: number;
  workspaceId?: string;
}

function pageQuery(args: RevisionPageArgs) {
  return {
    cursor: args.cursor ?? undefined,
    limit: args.limit ?? undefined,
  };
}

/**
 * ⚠ **AN ABSENT `nextCursor` READS AS "LAST PAGE", NEVER AS "MORE"** (INVARIANTS
 * §8's stale-payload rule). A payload cached before this key existed, or an
 * older server, yields `null` — so the list stops offering to load more rather
 * than looping on a cursor it does not have. `revisions` gets the same treatment
 * for the same reason: an absent list is an EMPTY one, never a crash.
 */
function toPage(data: Partial<RevisionPage>): RevisionPage {
  return { revisions: data.revisions ?? [], nextCursor: data.nextCursor ?? null };
}

export async function fetchEntryRevisions(
  entryId: string,
  args: RevisionPageArgs = {}
): Promise<RevisionPage> {
  return toPage(
    await apiRequest<Partial<RevisionPage>>(
      `/api/knowledge/entries/${entryId}/revisions`,
      { workspaceId: args.workspaceId, query: pageQuery(args) }
    )
  );
}

export async function fetchBaseRevisions(
  baseId: string,
  args: RevisionPageArgs = {}
): Promise<RevisionPage> {
  return toPage(
    await apiRequest<Partial<RevisionPage>>(
      `/api/knowledge/bases/${baseId}/revisions`,
      { workspaceId: args.workspaceId, query: pageQuery(args) }
    )
  );
}

/** Write a prior snapshot back. Answers the entry as it now stands. */
export async function restoreEntryRevision(
  entryId: string,
  revisionId: string,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  const data = await apiRequest<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${entryId}/revisions/${revisionId}/restore`,
    { method: "POST", workspaceId }
  );
  return data.entry;
}
