"use client";

/**
 * Client-side fetch wrappers for the skills REST endpoints. Mirrors
 * the knowledge `client/api.ts` shape — error envelope, X-Workspace-Id
 * header passthrough, JSON-only request/response.
 */

import type { ResolvedSkill, Skill, SkillFile } from "@/features/skills/types";

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
  const headers: Record<string, string> = {};
  if (opts.workspaceId) headers["x-workspace-id"] = opts.workspaceId;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.expectedUpdatedAt) headers["x-updated-at"] = opts.expectedUpdatedAt;
  const res = await fetch(path, {
    headers,
    method: opts.method ?? "GET",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  if (res.status === 204) return undefined as unknown as T;
  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // Empty / non-JSON body — leave defaults.
    }
    throw new SkillApiError(res.status, code, message);
  }
  return (await res.json()) as T;
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

export async function deleteSkill(
  slug: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(`/api/skills/${enc(slug)}`, {
    method: "DELETE",
    workspaceId,
  });
}

// ─── Skill files ────────────────────────────────────────────────────

export async function listSkillFiles(
  slug: string,
  workspaceId?: string
): Promise<SkillFile[]> {
  const data = await request<{ files: SkillFile[] }>(
    `/api/skills/${enc(slug)}/files`,
    { workspaceId }
  );
  return data.files;
}

export async function readSkillFile(
  slug: string,
  fileName: string,
  workspaceId?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    { workspaceId }
  );
  return data.file;
}

export async function createSkillFile(
  slug: string,
  input: { name: string; body?: string },
  workspaceId?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files`,
    { method: "POST", body: input, workspaceId }
  );
  return data.file;
}

export async function writeSkillFile(
  slug: string,
  fileName: string,
  body: string,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    { method: "PUT", body: { body }, workspaceId, expectedUpdatedAt }
  );
  return data.file;
}

export async function renameSkillFile(
  slug: string,
  currentName: string,
  newName: string,
  workspaceId?: string
): Promise<SkillFile> {
  const data = await request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(currentName)}`,
    { method: "PATCH", body: { name: newName }, workspaceId }
  );
  return data.file;
}

export async function deleteSkillFile(
  slug: string,
  fileName: string,
  workspaceId?: string
): Promise<void> {
  await request<void>(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    { method: "DELETE", workspaceId }
  );
}
