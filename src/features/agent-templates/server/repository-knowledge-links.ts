import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";

/**
 * Raw I/O for the KNOWLEDGE-BASE ATTACHMENTS on an agent template — the third
 * section of `repository.ts`, lifted into a sibling when that file reached the
 * 500-line cap (F-562, 2026-09-02). `repository.ts` re-exports every name here,
 * so no caller moved; this is the move `knowledge/server/repository.ts` already
 * made, where the named file is a barrel over five.
 *
 * ⚠ **IT IS A SECTION, NOT A LAYER.** The same two-client rule `repository.ts`
 * states in its header holds unchanged: a read that answers *what may this
 * caller see* takes `readClient()`, a write stays on `supabaseAdmin()` until RLS
 * plan phase 4. Read that header before adding a function here.
 */

export async function listKnowledgeLinksForTemplates(
  workspaceId: string,
  templateIds: string[]
): Promise<Array<{ templateId: string; knowledgeBaseId: string }>> {
  if (templateIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("agent_template_knowledge_bases")
    .select("template_id, knowledge_base_id")
    .eq("workspace_id", workspaceId)
    .in("template_id", templateIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ template_id: string; knowledge_base_id: string }>
  ).map((r) => ({
    templateId: r.template_id,
    knowledgeBaseId: r.knowledge_base_id,
  }));
}

/** REPLACE-SET, same argument as `replaceTeamLinks`. */
export async function replaceKnowledgeLinks(
  workspaceId: string,
  templateId: string,
  knowledgeBaseIds: string[],
  addedBy: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const del = await db
    .from("agent_template_knowledge_bases")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("template_id", templateId);
  if (del.error) throw del.error;
  if (knowledgeBaseIds.length === 0) return;
  const { error } = await db.from("agent_template_knowledge_bases").insert(
    [...new Set(knowledgeBaseIds)].map((knowledgeBaseId) => ({
      template_id: templateId,
      knowledge_base_id: knowledgeBaseId,
      workspace_id: workspaceId,
      added_by_user_id: addedBy,
    }))
  );
  if (error) throw error;
}

/**
 * The visibility facts needed to decide whether the CALLER may attach or see a
 * KB. ⚠ Read from `knowledge_bases` HERE rather than imported from
 * `features/knowledge`, mirroring `skills/server/repository.ts ›
 * listWorkspaceKnowledgeBases` — the same cross-feature-dependency argument.
 * The PREDICATE over these fields lives in `service-shared.ts › canSeeBaseRow`,
 * which is where the knowledge feature's `canSeeBase` rule is mirrored.
 * Soft-deleted bases are EXCLUDED: an attachment to a trashed base is an
 * attachment to nothing.
 */
export interface KnowledgeBaseAccessRow {
  id: string;
  name: string;
  visibility: "public" | "private";
  accessMode: "workspace" | "teams";
  createdBy: string | null;
}

export async function listKnowledgeBaseAccessRows(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeBaseAccessRow[]> {
  if (ids.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, name, visibility, access_mode, created_by")
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      name: string;
      visibility: "public" | "private";
      access_mode: "workspace" | "teams";
      created_by: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    accessMode: r.access_mode,
    createdBy: r.created_by,
  }));
}

/**
 * Teams granted on a set of knowledge bases. ⚠ THIS ONE READS ANOTHER FEATURE'S
 * SLICE of `resource_grants`, because mirroring the knowledge access predicate
 * means reading the rows that predicate reads. It is a READ of a fixed
 * `resource_type`, and this file never writes there.
 *
 * ⚠ The two lanes now share ONE TABLE (`20260914120000`) where they used to
 * share only a shape, so the `resource_type` term stopped being a narrowing and
 * became the fence: without it this would answer "which teams reach this KB"
 * with the template links three functions above.
 */
export async function listKnowledgeBaseTeamGrants(
  workspaceId: string,
  knowledgeBaseIds: string[]
): Promise<Array<{ knowledgeBaseId: string; teamId: string }>> {
  if (knowledgeBaseIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id, scope_id")
    .match({
      workspace_id: workspaceId,
      scope_type: "team",
      resource_type: "knowledge_base",
    })
    .in("resource_id", knowledgeBaseIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ resource_id: string; scope_id: string }>
  ).map((r) => ({ knowledgeBaseId: r.resource_id, teamId: r.scope_id }));
}
