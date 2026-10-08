import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";

/**
 * **AN ID-ADDRESSED RESOURCE NAMES ITS OWN CONTAINER** (2026-10-08). `withWorkspaceAuth`'s
 * `workspaceFromParams` resolvers, one per id family. A request that omits `X-Workspace-Id` resolves
 * to the caller's HOME space; for a resource that lives elsewhere that was a silent "not found"
 * (every decision card outside the home space). Each resolver answers the resource's container ONLY
 * when the caller is an active member of it, else `null` (falls through to home exactly as before),
 * so it reveals nothing about an id the caller cannot reach. An explicit header or key lock still
 * wins: these are consulted only when nothing was named.
 *
 * ⚠ EVERY dynamic-segment route on `withWorkspaceAuth` must pass one of these or `noDerivation`
 * (`workspace-derivation-coverage.test.ts`), so a new route cannot quietly reopen the bug.
 */
export type WorkspaceFromParams = (params: Record<string, string> | undefined, userId: string) => Promise<string | null>;

async function activeMember(workspaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** The container of the `table` row whose `id` is route param `param`, if the caller is a member of it. */
export function rowWorkspace(table: string, param: string): WorkspaceFromParams {
  return async (params, userId) => {
    const id = params?.[param];
    if (!id || !isUuid(id)) return null;
    const { data, error } = await supabaseAdmin().from(table).select("workspace_id").eq("id", id).maybeSingle();
    if (error) throw error;
    const workspaceId = (data as { workspace_id?: string | null } | null)?.workspace_id ?? null;
    return workspaceId && (await activeMember(workspaceId, userId)) ? workspaceId : null;
  };
}

/** An explicit "this id does not name one container" (e.g. a slug unique per workspace only). */
export function noDerivation(reason: string): WorkspaceFromParams {
  void reason; // documentation at the call site; the coverage test requires it to be non-empty
  return async () => null;
}

/** One resolver per id family. Add the family here and pass it at the route. */
export const deriveWorkspace = {
  agentIdentity: rowWorkspace("agent_identities", "identityId"),
  agentDirection: rowWorkspace("channel_agent_directions", "directionId"),
  consent: rowWorkspace("channel_consent_requests", "id"),
  launchDirective: rowWorkspace("channel_launch_directives", "directiveId"),
  chat: rowWorkspace("chats", "chatId"),
  chatFolder: rowWorkspace("chat_folders", "folderId"),
  knowledgeBase: rowWorkspace("knowledge_bases", "baseId"),
  knowledgeEntry: rowWorkspace("knowledge_entries", "entryId"),
  knowledgeFolder: rowWorkspace("knowledge_folders", "folderId"),
  ontology: rowWorkspace("ontologies", "ontologyId"),
  ontologyObject: rowWorkspace("ontology_objects", "objectId"),
  skillVersion: rowWorkspace("skill_versions", "versionId"),
} as const;
