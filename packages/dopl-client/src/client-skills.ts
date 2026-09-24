/**
 * Skill method group — link 8 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `skills.ts`; no HTTP
 * here.
 *
 * Reads unrestricted; writes gated server-side by the per-skill
 * `agent_write_enabled` toggle for API-key (agent) callers.
 */

import { ChannelMethods } from "./client-channels.js";
import * as skills from "./skills.js";
import * as revisions from "./revisions.js";
import type { SkillHistory, SkillVersionMeta } from "./revisions.js";
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

  /** Body snapshots + structural events, newest first. */
  getSkillHistory(slug: string, opts: { limit?: number } = {}): Promise<SkillHistory> {
    return revisions.getSkillHistory(this.transport, slug, opts);
  }

  /** One snapshot with its full body. */
  getSkillVersion(versionId: string): Promise<SkillVersionMeta & { body: string }> {
    return revisions.getSkillVersion(this.transport, versionId);
  }

  /** Write a snapshot back as a NEW save, under the body's Version precondition (412 if stale). */
  restoreSkillVersion(versionId: string, expectedVersion: string): Promise<SkillFile> {
    return revisions.restoreSkillVersion(this.transport, versionId, expectedVersion);
  }
}
