/**
 * Skill method group — link 10 and LAST of the chain documented in
 * `client-base.ts`; `DoplClient` in `client.ts` extends this one. Pure
 * delegation to `skills.ts`; no HTTP here.
 *
 * Read paths are unrestricted; write paths are gated server-side by the
 * per-skill `agent_write_enabled` toggle for API-key (agent) callers. Skills
 * are single-file: one SKILL.md procedure body.
 */

import { ChannelMethods } from "./client-channels.js";
import * as skills from "./skills.js";
import type {
  CreateSkillInput,
  UpdateSkillPatch as SkillUpdatePatch,
} from "./skills.js";
import type {
  ResolvedSkill,
  Skill,
  SkillFile,
  SkillWriteFileResult,
} from "./skill-types.js";

export class SkillMethods extends ChannelMethods {
  listSkills(): Promise<Skill[]> {
    return skills.listSkills(this.transport);
  }

  getSkill(slug: string): Promise<ResolvedSkill> {
    return skills.getSkill(this.transport, slug);
  }

  createSkill(
    input: CreateSkillInput
  ): Promise<{ skill: Skill; primaryFile: SkillFile }> {
    return skills.createSkill(this.transport, input);
  }

  updateSkill(slug: string, patch: SkillUpdatePatch): Promise<Skill> {
    return skills.updateSkill(this.transport, slug, patch);
  }

  deleteSkill(slug: string): Promise<void> {
    return skills.deleteSkill(this.transport, slug);
  }

  readSkillBody(slug: string): Promise<SkillFile> {
    return skills.readSkillBody(this.transport, slug);
  }

  writeSkillBody(
    slug: string,
    body: string,
    expectedVersion?: string | null
  ): Promise<SkillWriteFileResult> {
    return skills.writeSkillBody(this.transport, slug, body, expectedVersion);
  }
}
