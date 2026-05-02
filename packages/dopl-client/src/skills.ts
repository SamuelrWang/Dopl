/**
 * Skills methods for `DoplClient`.
 *
 * Read paths (`listSkills`, `getSkill`) are surfaced to all callers.
 * Write paths (`createSkill`, `updateSkill`, `deleteSkill`, file CRUD)
 * are gated server-side by the per-skill `agent_write_enabled` toggle
 * for API-key (agent) callers; session callers bypass that check.
 */

import type { DoplTransport } from "./transport.js";
import type {
  ResolvedSkill,
  Skill,
  SkillFile,
  SkillStatus,
} from "./skill-types.js";

const enc = encodeURIComponent;

// ─── Read ───────────────────────────────────────────────────────────

export async function listSkills(t: DoplTransport): Promise<Skill[]> {
  const data = await t.request<{ skills: Skill[] }>("/api/skills", {
    toolName: "skill_list",
  });
  return data.skills;
}

export async function getSkill(
  t: DoplTransport,
  slug: string
): Promise<ResolvedSkill> {
  return t.request<ResolvedSkill>(`/api/skills/${enc(slug)}`, {
    toolName: "skill_get",
  });
}

// ─── Skill CRUD ─────────────────────────────────────────────────────

export interface CreateSkillInput {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string | null;
  slug?: string;
  status?: SkillStatus;
  agentWriteEnabled?: boolean;
  body?: string;
}

export async function createSkill(
  t: DoplTransport,
  input: CreateSkillInput
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  return t.request<{ skill: Skill; primaryFile: SkillFile }>("/api/skills", {
    method: "POST",
    body: input,
    toolName: "skill_create",
  });
}

export interface UpdateSkillPatch {
  name?: string;
  description?: string;
  whenToUse?: string;
  whenNotToUse?: string | null;
  slug?: string;
  status?: SkillStatus;
  agentWriteEnabled?: boolean;
}

export async function updateSkill(
  t: DoplTransport,
  slug: string,
  patch: UpdateSkillPatch
): Promise<Skill> {
  const data = await t.request<{ skill: Skill }>(`/api/skills/${enc(slug)}`, {
    method: "PATCH",
    body: patch,
    toolName: "skill_update",
  });
  return data.skill;
}

export async function deleteSkill(
  t: DoplTransport,
  slug: string
): Promise<void> {
  await t.requestNoContent(
    `/api/skills/${enc(slug)}`,
    "DELETE",
    "skill_delete"
  );
}

// ─── File CRUD ──────────────────────────────────────────────────────

export async function listSkillFiles(
  t: DoplTransport,
  slug: string
): Promise<SkillFile[]> {
  const data = await t.request<{ files: SkillFile[] }>(
    `/api/skills/${enc(slug)}/files`,
    { toolName: "skill_list_files" }
  );
  return data.files;
}

export async function readSkillFile(
  t: DoplTransport,
  slug: string,
  fileName: string
): Promise<SkillFile> {
  const data = await t.request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    { toolName: "skill_read_file" }
  );
  return data.file;
}

export async function createSkillFile(
  t: DoplTransport,
  slug: string,
  input: { name: string; body?: string }
): Promise<SkillFile> {
  const data = await t.request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files`,
    { method: "POST", body: input, toolName: "skill_create_file" }
  );
  return data.file;
}

export async function writeSkillFile(
  t: DoplTransport,
  slug: string,
  fileName: string,
  body: string
): Promise<SkillFile> {
  const data = await t.request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    { method: "PUT", body: { body }, toolName: "skill_write_file" }
  );
  return data.file;
}

export async function renameSkillFile(
  t: DoplTransport,
  slug: string,
  currentName: string,
  newName: string
): Promise<SkillFile> {
  const data = await t.request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/files/${enc(currentName)}`,
    { method: "PATCH", body: { name: newName }, toolName: "skill_rename_file" }
  );
  return data.file;
}

export async function deleteSkillFile(
  t: DoplTransport,
  slug: string,
  fileName: string
): Promise<void> {
  await t.requestNoContent(
    `/api/skills/${enc(slug)}/files/${enc(fileName)}`,
    "DELETE",
    "skill_delete_file"
  );
}
