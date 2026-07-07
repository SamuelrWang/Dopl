import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { SkillContext, SkillEvent, SkillFileVersion } from "../types";

/**
 * Skill history — file-version snapshots + the structural audit timeline.
 *
 * Write API (called from service.ts mutation paths only):
 *   recordVersion(...)  — snapshot a file body after a content save
 *   recordEvent(...)    — log a structural change (create/rename/…)
 *
 * Both writers are BEST-EFFORT: a history failure must never fail the
 * user's save, so errors are logged loudly and swallowed. The read API
 * is strict (throws) — a broken history page should say so.
 *
 * Retention: newest VERSION_CAP snapshots per file; pruned inline after
 * each insert.
 */

const VERSION_CAP = 200;

// ─── Row mapping ─────────────────────────────────────────────────────

const VERSION_META_COLS =
  "id, workspace_id, skill_id, file_id, file_name, author_id, source, created_at, octet_length(body) as body_bytes";
const EVENT_COLS =
  "id, workspace_id, skill_id, file_id, type, detail, author_id, source, created_at";

interface VersionMetaRow {
  id: string;
  workspace_id: string;
  skill_id: string;
  file_id: string;
  file_name: string;
  author_id: string | null;
  source: "user" | "agent";
  created_at: string;
  body_bytes: number;
}

interface EventRow {
  id: string;
  workspace_id: string;
  skill_id: string;
  file_id: string | null;
  type: SkillEvent["type"];
  detail: Record<string, unknown>;
  author_id: string | null;
  source: "user" | "agent";
  created_at: string;
}

function mapVersionMeta(row: VersionMetaRow): SkillFileVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    fileId: row.file_id,
    fileName: row.file_name,
    authorId: row.author_id,
    source: row.source,
    createdAt: row.created_at,
    bodyBytes: row.body_bytes,
  };
}

function mapEvent(row: EventRow): SkillEvent {
  return {
    id: row.id,
    skillId: row.skill_id,
    fileId: row.file_id,
    type: row.type,
    detail: row.detail ?? {},
    authorId: row.author_id,
    source: row.source,
    createdAt: row.created_at,
  };
}

// ─── Writers (best-effort) ───────────────────────────────────────────

export interface RecordVersionArgs {
  ctx: SkillContext;
  skillId: string;
  fileId: string;
  fileName: string;
  body: string;
}

/** Snapshot a file body. Never throws — history must not break saves. */
export async function recordVersion(args: RecordVersionArgs): Promise<void> {
  const { ctx, skillId, fileId, fileName, body } = args;
  try {
    const db = supabaseAdmin();
    const { error } = await db.from("skill_file_versions").insert({
      workspace_id: ctx.workspaceId,
      skill_id: skillId,
      file_id: fileId,
      file_name: fileName,
      body,
      author_id: ctx.userId,
      source: ctx.source,
    });
    if (error) throw error;
    await pruneVersions(fileId);
  } catch (err) {
    console.error(
      `[skill-history] version snapshot failed (file ${fileId}):`,
      err
    );
  }
}

/** Log a structural change. Never throws — history must not break saves. */
export async function recordEvent(args: {
  ctx: SkillContext;
  skillId: string;
  type: SkillEvent["type"];
  fileId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { error } = await db.from("skill_events").insert({
      workspace_id: args.ctx.workspaceId,
      skill_id: args.skillId,
      file_id: args.fileId ?? null,
      type: args.type,
      detail: args.detail ?? {},
      author_id: args.ctx.userId,
      source: args.ctx.source,
    });
    if (error) throw error;
  } catch (err) {
    console.error(
      `[skill-history] event ${args.type} failed (skill ${args.skillId}):`,
      err
    );
  }
}

/** Keep the newest VERSION_CAP snapshots for a file. */
async function pruneVersions(fileId: string): Promise<void> {
  const db = supabaseAdmin();
  // Find the created_at of the oldest row we want to KEEP, then delete
  // everything strictly older. Two cheap indexed queries; runs inline
  // after each insert so the excess is never more than one row.
  const { data, error } = await db
    .from("skill_file_versions")
    .select("created_at")
    .eq("file_id", fileId)
    .order("created_at", { ascending: false })
    .range(VERSION_CAP - 1, VERSION_CAP - 1);
  if (error) throw error;
  const cutoff = (data as Array<{ created_at: string }> | null)?.[0]?.created_at;
  if (!cutoff) return;
  const { error: delError } = await db
    .from("skill_file_versions")
    .delete()
    .eq("file_id", fileId)
    .lt("created_at", cutoff);
  if (delError) throw delError;
}

// ─── Readers (strict) ────────────────────────────────────────────────

/** Version metadata (no bodies) + events for a skill, newest first. */
export async function listHistory(
  ctx: SkillContext,
  skillId: string,
  opts: { limit?: number } = {}
): Promise<{ versions: SkillFileVersion[]; events: SkillEvent[] }> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const db = supabaseAdmin();
  const [versionsRes, eventsRes] = await Promise.all([
    db
      .from("skill_file_versions")
      .select(VERSION_META_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("skill_id", skillId)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("skill_events")
      .select(EVENT_COLS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("skill_id", skillId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);
  if (versionsRes.error) throw versionsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  return {
    versions: ((versionsRes.data ?? []) as unknown as VersionMetaRow[]).map(
      mapVersionMeta
    ),
    events: ((eventsRes.data ?? []) as unknown as EventRow[]).map(mapEvent),
  };
}

/** One version with its full body. Workspace-scoped; null if not found. */
export async function findVersionWithBody(
  ctx: SkillContext,
  versionId: string
): Promise<(SkillFileVersion & { body: string }) | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skill_file_versions")
    .select(`${VERSION_META_COLS}, body`)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as VersionMetaRow & { body: string };
  return { ...mapVersionMeta(row), body: row.body };
}
