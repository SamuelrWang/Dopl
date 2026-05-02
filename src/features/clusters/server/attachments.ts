import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import { HttpError } from "@/shared/lib/http-error";
import type { ClusterScope } from "./service";

// Domain types — what consumers (route handlers, MCP renderer) see.
//
// `entries_index` on a KB is a small list of {title, slug, folder_path} so
// the agent can decide whether to read a specific entry without loading
// every body. The full body is fetched on demand via the per-entry endpoint
// in Phase 7.

export interface ClusterAttachedKnowledgeBase {
  knowledge_base_id: string;
  slug: string;
  name: string;
  description: string | null;
  agent_write_enabled: boolean;
  added_at: string;
  entries_index: Array<{
    entry_id: string;
    title: string;
    folder_path: string | null;
  }>;
}

export interface ClusterAttachedSkill {
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "draft";
  when_to_use: string;
  body: string;
  added_at: string;
}

/** Per-entry payload returned by readClusterKnowledgeEntry. */
export interface ClusterKnowledgeEntryRead {
  entry_id: string;
  knowledge_base_slug: string;
  title: string;
  body: string;
  folder_path: string | null;
  updated_at: string;
}

/** Full skill (skill row + every file body) returned by readClusterSkill. */
export interface ClusterSkillFilesRead {
  skill_slug: string;
  name: string;
  description: string;
  when_to_use: string;
  status: "active" | "draft";
  files: Array<{ name: string; body: string }>;
}

// ── Internal helpers ─────────────────────────────────────────────────

async function resolveClusterId(
  slug: string,
  scope: ClusterScope
): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id")
    .eq("slug", slug)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "CLUSTER_NOT_FOUND", `Cluster not found: ${slug}`);
  return data.id;
}

/**
 * Verify the KB is in this workspace AND, if the caller is an agent,
 * that the per-KB `agent_write_enabled` toggle permits the mutation.
 * Cluster attach/detach are metadata operations on the KB's
 * cluster-membership; we treat them as writes for gating purposes so
 * an agent can't change cluster context without the user's consent.
 */
async function assertKbWritable(
  knowledgeBaseId: string,
  scope: ClusterScope
): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, agent_write_enabled")
    .eq("id", knowledgeBaseId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(
      404,
      "KNOWLEDGE_BASE_NOT_FOUND",
      "Knowledge base not found in this workspace"
    );
  }
  if (scope.source === "agent" && !data.agent_write_enabled) {
    throw new HttpError(
      403,
      "AGENT_WRITE_DISABLED",
      "agent_write_enabled is off for this knowledge base"
    );
  }
}

async function assertSkillWritable(
  skillId: string,
  scope: ClusterScope
): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select("id, agent_write_enabled")
    .eq("id", skillId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(
      404,
      "SKILL_NOT_FOUND",
      "Skill not found in this workspace"
    );
  }
  if (scope.source === "agent" && !data.agent_write_enabled) {
    throw new HttpError(
      403,
      "AGENT_WRITE_DISABLED",
      "agent_write_enabled is off for this skill"
    );
  }
}

// ── Knowledge-base attachments ───────────────────────────────────────

export async function attachKnowledgeBase(
  clusterSlug: string,
  knowledgeBaseId: string,
  scope: ClusterScope
): Promise<ClusterAttachedKnowledgeBase> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  await assertKbWritable(knowledgeBaseId, scope);
  const db = supabaseAdmin();
  const { error } = await db
    .from("cluster_knowledge_bases")
    .upsert(
      {
        cluster_id: clusterId,
        knowledge_base_id: knowledgeBaseId,
        workspace_id: scope.workspaceId,
        added_by_user_id: scope.userId,
      },
      { onConflict: "cluster_id,knowledge_base_id", ignoreDuplicates: false }
    );
  if (error) throw error;
  const list = await listAttachedKnowledgeBasesById(clusterId, scope);
  const just = list.find((k) => k.knowledge_base_id === knowledgeBaseId);
  if (!just) throw new Error("Attach succeeded but follow-up read failed");
  return just;
}

export async function detachKnowledgeBase(
  clusterSlug: string,
  knowledgeBaseId: string,
  scope: ClusterScope
): Promise<void> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  // Detach is gated by the same agent_write_enabled toggle as attach —
  // we don't want an agent to silently sever cluster context. Skip the
  // existence check (KB might be soft-deleted, in which case we still
  // want to clean up the orphan junction row); only enforce the agent
  // gate when the KB row is still readable.
  if (scope.source === "agent") {
    const db = supabaseAdmin();
    const { data } = await db
      .from("knowledge_bases")
      .select("agent_write_enabled")
      .eq("id", knowledgeBaseId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (data && !data.agent_write_enabled) {
      throw new HttpError(
        403,
        "AGENT_WRITE_DISABLED",
        "agent_write_enabled is off for this knowledge base"
      );
    }
  }
  const db = supabaseAdmin();
  const { error } = await db
    .from("cluster_knowledge_bases")
    .delete()
    .eq("cluster_id", clusterId)
    .eq("knowledge_base_id", knowledgeBaseId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

export async function listAttachedKnowledgeBases(
  clusterSlug: string,
  scope: ClusterScope
): Promise<ClusterAttachedKnowledgeBase[]> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  return listAttachedKnowledgeBasesById(clusterId, scope);
}

// Internal: lookup by id (skips re-resolving slug). Exposed inside this
// file for use by both attachKnowledgeBase and the cluster service's
// extended getCluster() flow.
export async function listAttachedKnowledgeBasesById(
  clusterId: string,
  scope: ClusterScope
): Promise<ClusterAttachedKnowledgeBase[]> {
  const db = supabaseAdmin();
  const { data: links, error } = await db
    .from("cluster_knowledge_bases")
    .select(
      `added_at,
       knowledge_base_id,
       knowledge_base:knowledge_bases!inner(
         id, slug, name, description, agent_write_enabled, deleted_at
       )`
    )
    .eq("cluster_id", clusterId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;

  type KbRel = {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    agent_write_enabled: boolean;
    deleted_at: string | null;
  };
  type RawRow = {
    added_at: string;
    knowledge_base_id: string;
    knowledge_base: KbRel | KbRel[] | null;
  };
  type Row = {
    added_at: string;
    knowledge_base_id: string;
    knowledge_base: KbRel | null;
  };
  const rawRows = (links as unknown as RawRow[] | null) ?? [];
  const rows: Row[] = rawRows.map((r) => ({
    added_at: r.added_at,
    knowledge_base_id: r.knowledge_base_id,
    knowledge_base: Array.isArray(r.knowledge_base)
      ? r.knowledge_base[0] ?? null
      : r.knowledge_base,
  }));
  const liveRows = rows.filter(
    (r) => r.knowledge_base && r.knowledge_base.deleted_at === null
  );

  if (liveRows.length === 0) return [];

  const kbIds = liveRows.map((r) => r.knowledge_base_id);

  // Folders join — used to compute folder_path for entries_index.
  const { data: folderRows, error: folderError } = await db
    .from("knowledge_folders")
    .select("id, name, parent_id, knowledge_base_id, deleted_at")
    .in("knowledge_base_id", kbIds)
    .is("deleted_at", null);
  if (folderError) throw folderError;
  const foldersById = new Map<
    string,
    { id: string; name: string; parent_id: string | null; knowledge_base_id: string }
  >();
  for (const f of folderRows || []) {
    foldersById.set(f.id, {
      id: f.id,
      name: f.name,
      parent_id: f.parent_id,
      knowledge_base_id: f.knowledge_base_id,
    });
  }

  function pathOfFolder(folderId: string | null): string | null {
    if (!folderId) return null;
    const segments: string[] = [];
    let cursor = folderId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const f = foldersById.get(cursor);
      if (!f) break;
      segments.unshift(f.name);
      if (!f.parent_id) break;
      cursor = f.parent_id;
    }
    return segments.length === 0 ? null : segments.join("/");
  }

  // Entries index — title + folder path only, no body. Capped per KB so the
  // payload stays bounded for clusters with very large bases.
  const ENTRIES_PER_KB_CAP = 200;
  const { data: entryRows, error: entryError } = await db
    .from("knowledge_entries")
    .select("id, title, folder_id, knowledge_base_id, deleted_at, position")
    .in("knowledge_base_id", kbIds)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .limit(ENTRIES_PER_KB_CAP * kbIds.length);
  if (entryError) throw entryError;

  const indexByKb = new Map<
    string,
    Array<{ entry_id: string; title: string; folder_path: string | null }>
  >();
  for (const e of entryRows || []) {
    const list = indexByKb.get(e.knowledge_base_id) ?? [];
    if (list.length >= ENTRIES_PER_KB_CAP) continue;
    list.push({
      entry_id: e.id,
      title: e.title,
      folder_path: pathOfFolder(e.folder_id),
    });
    indexByKb.set(e.knowledge_base_id, list);
  }

  return liveRows.map((r) => {
    const kb = r.knowledge_base!;
    return {
      knowledge_base_id: r.knowledge_base_id,
      slug: kb.slug,
      name: kb.name,
      description: kb.description,
      agent_write_enabled: kb.agent_write_enabled,
      added_at: r.added_at,
      entries_index: indexByKb.get(r.knowledge_base_id) ?? [],
    };
  });
}

// ── Skill attachments ────────────────────────────────────────────────

export async function attachSkill(
  clusterSlug: string,
  skillId: string,
  scope: ClusterScope
): Promise<ClusterAttachedSkill> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  await assertSkillWritable(skillId, scope);
  const db = supabaseAdmin();
  const { error } = await db
    .from("cluster_skills")
    .upsert(
      {
        cluster_id: clusterId,
        skill_id: skillId,
        workspace_id: scope.workspaceId,
        added_by_user_id: scope.userId,
      },
      { onConflict: "cluster_id,skill_id", ignoreDuplicates: false }
    );
  if (error) throw error;
  const list = await listAttachedSkillsById(clusterId, scope);
  const just = list.find((s) => s.skill_id === skillId);
  if (!just) throw new Error("Attach succeeded but follow-up read failed");
  return just;
}

export async function detachSkill(
  clusterSlug: string,
  skillId: string,
  scope: ClusterScope
): Promise<void> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  if (scope.source === "agent") {
    const db = supabaseAdmin();
    const { data } = await db
      .from("skills")
      .select("agent_write_enabled")
      .eq("id", skillId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (data && !data.agent_write_enabled) {
      throw new HttpError(
        403,
        "AGENT_WRITE_DISABLED",
        "agent_write_enabled is off for this skill"
      );
    }
  }
  const db = supabaseAdmin();
  const { error } = await db
    .from("cluster_skills")
    .delete()
    .eq("cluster_id", clusterId)
    .eq("skill_id", skillId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

export async function listAttachedSkills(
  clusterSlug: string,
  scope: ClusterScope
): Promise<ClusterAttachedSkill[]> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  return listAttachedSkillsById(clusterId, scope);
}

// ── Guarded per-entity reads (used by MCP tools) ─────────────────────

export async function readClusterKnowledgeEntry(
  clusterSlug: string,
  knowledgeBaseId: string,
  entryId: string,
  scope: ClusterScope
): Promise<ClusterKnowledgeEntryRead> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  const db = supabaseAdmin();

  // Verify the KB exists in workspace.
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, slug")
    .eq("id", knowledgeBaseId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (kbErr) throw kbErr;
  if (!kb) {
    throw new HttpError(
      404,
      "KNOWLEDGE_BASE_NOT_FOUND",
      "Knowledge base not found"
    );
  }

  // Attachment guard.
  const { data: attached, error: attachedErr } = await db
    .from("cluster_knowledge_bases")
    .select("knowledge_base_id")
    .eq("cluster_id", clusterId)
    .eq("knowledge_base_id", kb.id)
    .maybeSingle();
  if (attachedErr) throw attachedErr;
  if (!attached) {
    throw new HttpError(
      404,
      "KB_NOT_ATTACHED",
      "Knowledge base is not attached to this cluster"
    );
  }

  // Read entry.
  const { data: entry, error: entryErr } = await db
    .from("knowledge_entries")
    .select("id, knowledge_base_id, title, body, folder_id, updated_at, deleted_at")
    .eq("id", entryId)
    .eq("knowledge_base_id", kb.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (entryErr) throw entryErr;
  if (!entry) {
    throw new HttpError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }

  // Resolve folder path. Single round-trip for all folders in this KB
  // (typically dozens at most), then walk parents in memory.
  let folderPath: string | null = null;
  if (entry.folder_id) {
    const { data: folderRows, error: folderError } = await db
      .from("knowledge_folders")
      .select("id, name, parent_id")
      .eq("knowledge_base_id", kb.id)
      .is("deleted_at", null);
    if (folderError) throw folderError;
    const folderById = new Map<
      string,
      { name: string; parent_id: string | null }
    >();
    for (const f of folderRows ?? []) {
      folderById.set(f.id, { name: f.name, parent_id: f.parent_id });
    }
    const segments: string[] = [];
    let cursor: string | null = entry.folder_id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const f = folderById.get(cursor);
      if (!f) break;
      segments.unshift(f.name);
      cursor = f.parent_id;
    }
    folderPath = segments.length === 0 ? null : segments.join("/");
  }

  return {
    entry_id: entry.id,
    knowledge_base_slug: kb.slug,
    title: entry.title,
    body: entry.body,
    folder_path: folderPath,
    updated_at: entry.updated_at,
  };
}

export async function readClusterSkill(
  clusterSlug: string,
  skillId: string,
  scope: ClusterScope
): Promise<ClusterSkillFilesRead> {
  const clusterId = await resolveClusterId(clusterSlug, scope);
  const db = supabaseAdmin();

  const { data: skill, error: skillErr } = await db
    .from("skills")
    .select("id, slug, name, description, when_to_use, status, deleted_at")
    .eq("id", skillId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (skillErr) throw skillErr;
  if (!skill) {
    throw new HttpError(404, "SKILL_NOT_FOUND", "Skill not found");
  }

  const { data: attached, error: attachedErr } = await db
    .from("cluster_skills")
    .select("skill_id")
    .eq("cluster_id", clusterId)
    .eq("skill_id", skill.id)
    .maybeSingle();
  if (attachedErr) throw attachedErr;
  if (!attached) {
    throw new HttpError(
      404,
      "SKILL_NOT_ATTACHED",
      "Skill is not attached to this cluster"
    );
  }

  const { data: files, error: filesErr } = await db
    .from("skill_files")
    .select("name, body, position")
    .eq("skill_id", skill.id)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (filesErr) throw filesErr;

  return {
    skill_slug: skill.slug,
    name: skill.name,
    description: skill.description,
    when_to_use: skill.when_to_use,
    status: skill.status,
    files: (files ?? []).map((f) => ({ name: f.name, body: f.body })),
  };
}

export async function listAttachedSkillsById(
  clusterId: string,
  scope: ClusterScope
): Promise<ClusterAttachedSkill[]> {
  const db = supabaseAdmin();
  const { data: links, error } = await db
    .from("cluster_skills")
    .select(
      `added_at,
       skill_id,
       skill:skills!inner(
         id, slug, name, description, status, when_to_use, body, deleted_at
       )`
    )
    .eq("cluster_id", clusterId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;

  type SkillRel = {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: "active" | "draft";
    when_to_use: string;
    body: string;
    deleted_at: string | null;
  };
  type RawRow = {
    added_at: string;
    skill_id: string;
    skill: SkillRel | SkillRel[] | null;
  };
  const rawRows = (links as unknown as RawRow[] | null) ?? [];
  const rows = rawRows.map((r) => ({
    added_at: r.added_at,
    skill_id: r.skill_id,
    skill: Array.isArray(r.skill) ? r.skill[0] ?? null : r.skill,
  }));

  return rows
    .filter((r) => r.skill && r.skill.deleted_at === null)
    .map((r) => {
      const s = r.skill!;
      return {
        skill_id: r.skill_id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        status: s.status,
        when_to_use: s.when_to_use,
        body: s.body.slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD),
        added_at: r.added_at,
      };
    });
}
