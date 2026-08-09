"use client";

/**
 * Client-side fetch wrappers for the skills REST endpoints. Mirrors
 * the knowledge `client/api.ts` shape — error envelope, X-Workspace-Id
 * header passthrough, JSON-only request/response.
 */

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  ResolvedSkill,
  Skill,
  SkillEvent,
  SkillFile,
  SkillVersion,
} from "@/features/skills/types";

export class SkillApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SkillApiError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOpts {
  workspaceId?: string;
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /**
   * Optimistic-concurrency precondition. When set, the server
   * compares against the row's current `updated_at` and returns 412
   * `SKILL_STALE_VERSION` on mismatch. Mirrors the knowledge feature.
   */
  expectedUpdatedAt?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      // Re-type onto the feature error — skill-view branches on
      // SkillApiError instances (e.g. 412 SKILL_STALE_VERSION).
      throw new SkillApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

const enc = encodeURIComponent;

// ─── Skill CRUD ─────────────────────────────────────────────────────

export async function fetchSkills(workspaceId?: string): Promise<Skill[]> {
  const data = await request<{ skills: Skill[] }>("/api/skills", { workspaceId });
  return data.skills;
}

export async function fetchSkill(
  slug: string,
  workspaceId?: string
): Promise<ResolvedSkill> {
  return request<ResolvedSkill>(`/api/skills/${enc(slug)}`, { workspaceId });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string | null;
  slug?: string;
  status?: "active" | "draft";
  agentWriteEnabled?: boolean;
  folder?: string | null;
  body?: string;
}

export async function createSkill(
  input: CreateSkillInput,
  workspaceId?: string
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  return request<{ skill: Skill; primaryFile: SkillFile }>("/api/skills", {
    method: "POST",
    body: input,
    workspaceId,
  });
}

export interface UpdateSkillPatch {
  name?: string;
  description?: string;
  whenToUse?: string;
  whenNotToUse?: string | null;
  slug?: string;
  status?: "active" | "draft";
  agentWriteEnabled?: boolean;
  /** Organizing folder label. Empty → unfiled (null). */
  folder?: string | null;
  /** Full three-way sharing — owner or workspace admin only. */
  visibility?: "public" | "private";
  accessMode?: "workspace" | "teams";
  /** Teams granted read access; only with visibility 'public' + accessMode 'teams'. */
  teamIds?: string[];
}

export async function updateSkill(
  slug: string,
  patch: UpdateSkillPatch,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<Skill> {
  const data = await request<{ skill: Skill }>(`/api/skills/${enc(slug)}`, {
    method: "PATCH",
    body: patch,
    workspaceId,
    expectedUpdatedAt,
  });
  return data.skill;
}

// ─── Skill body (the single SKILL.md) ───────────────────────────────

export async function readSkillBody(
  slug: string,
  workspaceId?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/body`,
    { workspaceId }
  );
  return data.file;
}

export interface WriteSkillBodyResult {
  file: SkillFile;
  /**
   * The skill row's `updated_at` after the write — the metadata-CAS clock,
   * distinct from `file.updatedAt` (the body clock). A body save bumps it
   * (touch trigger), so thread it as the precondition for the next metadata
   * (name/folder/sharing) PATCH or that PATCH would false-412 (F-038 D10).
   */
  skillUpdatedAt: string;
}

export async function writeSkillBody(
  slug: string,
  body: string,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<WriteSkillBodyResult> {
  const data = await request<{ file: SkillFile; skillUpdatedAt: string }>(
    `/api/skills/${enc(slug)}/body`,
    { method: "PUT", body: { body }, workspaceId, expectedUpdatedAt }
  );
  return { file: data.file, skillUpdatedAt: data.skillUpdatedAt };
}

// ─── History (versions + audit timeline) ────────────────────────────

export interface SkillHistoryPayload {
  versions: SkillVersion[];
  events: SkillEvent[];
}

export async function fetchSkillHistory(
  slug: string,
  workspaceId?: string
): Promise<SkillHistoryPayload> {
  return request<SkillHistoryPayload>(
    `/api/skills/${enc(slug)}/history`,
    { workspaceId }
  );
}

export async function fetchSkillVersion(
  versionId: string,
  workspaceId?: string
): Promise<SkillVersion & { body: string }> {
  const data = await request<{ version: SkillVersion & { body: string } }>(
    `/api/skills/versions/${enc(versionId)}`,
    { workspaceId }
  );
  return data.version;
}

export async function restoreSkillVersion(
  versionId: string,
  workspaceId?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/versions/${enc(versionId)}/restore`,
    { method: "POST", workspaceId }
  );
  return data.file;
}

// ─── Delete ─────────────────────────────────────────────────────────

/**
 * PERMANENT delete — the soft-delete removal (§2b) turned the server route
 * into a hard delete, so there is no trash and no restore behind this. Every
 * call site must be gated by a `ConfirmDialog` first.
 */
export async function deleteSkill(
  slug: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(`/api/skills/${enc(slug)}`, {
    method: "DELETE",
    workspaceId,
  });
}

// ─── Duplicate ──────────────────────────────────────────────────────

export async function duplicateSkill(
  slug: string,
  workspaceId?: string
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  return request<{ skill: Skill; primaryFile: SkillFile }>(
    `/api/skills/${enc(slug)}/duplicate`,
    { method: "POST", workspaceId }
  );
}
