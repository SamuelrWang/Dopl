/**
 * Skills methods for `DoplClient`.
 *
 * Read paths (`listSkills`, `getSkill`) are surfaced to all callers.
 * Write paths (`createSkill`, `updateSkill`, `deleteSkill`, body write)
 * are gated server-side by the per-skill `agent_write_enabled` toggle
 * for API-key (agent) callers; session callers bypass that check.
 *
 * Skills are single-file: the one SKILL.md body is read/written via
 * `readSkillBody` / `writeSkillBody`.
 */

import type { DoplTransport } from "./transport.js";
import { DoplApiError } from "./errors.js";
import type {
  ResolvedSkill,
  Skill,
  SkillFile,
  SkillStatus,
  SkillWriteFileResult,
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
  /** Optional organizing folder label. Empty/omitted = unfiled. */
  folder?: string | null;
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
  /** Organizing folder label. Empty → unfiled. */
  folder?: string | null;
  /** Two-way sharing (owner or workspace admin only). Team-mode
   *  scoping (accessMode 'teams' + teamIds) is web-UI-managed. */
  visibility?: "public" | "private";
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

// ─── Body read / write (the single SKILL.md) ────────────────────────

export async function readSkillBody(
  t: DoplTransport,
  slug: string
): Promise<SkillFile> {
  const data = await t.request<{ file: SkillFile }>(
    `/api/skills/${enc(slug)}/body`,
    { toolName: "skill_read" }
  );
  return data.file;
}

export async function writeSkillBody(
  t: DoplTransport,
  slug: string,
  body: string,
  expectedVersion?: string | null
): Promise<SkillWriteFileResult> {
  // Optimistic concurrency, tri-state on `expectedVersion`:
  //   - string    → atomic CAS against it (412 on mismatch).
  //   - undefined  → strict default: if the skill body already exists,
  //                  refuse (412) — the caller must read first and pass
  //                  the Version it actually saw. The old read-at-write
  //                  "auto-guard" only proved nothing changed in the
  //                  microseconds before the PUT; it silently clobbered
  //                  anything written after the caller's real read.
  //   - null       → force: blind overwrite, no precondition.
  let version: string | undefined;
  if (expectedVersion === null) {
    version = undefined;
  } else if (expectedVersion === undefined) {
    let exists = false;
    try {
      await readSkillBody(t, slug);
      exists = true;
    } catch (e) {
      if (!(e instanceof DoplApiError) || e.status !== 404) throw e;
    }
    if (exists) {
      throw new DoplApiError(
        412,
        JSON.stringify({
          error: {
            code: "EXPECTED_VERSION_REQUIRED",
            message:
              "This skill already has a body. Read it first and pass its Version as expected_version (or force to overwrite).",
          },
        })
      );
    }
  } else {
    version = expectedVersion;
  }
  const data = await t.request<SkillWriteFileResult>(
    `/api/skills/${enc(slug)}/body`,
    {
      method: "PUT",
      body: { body },
      toolName: "skill_write",
      customHeaders: version ? { "X-Updated-At": version } : undefined,
    }
  );
  return data;
}
