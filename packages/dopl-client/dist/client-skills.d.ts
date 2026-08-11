/**
 * Skill method group — link 8 of the chain documented in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `skills.ts`; no HTTP
 * here.
 *
 * Read paths are unrestricted; write paths are gated server-side by the
 * per-skill `agent_write_enabled` toggle for API-key (agent) callers. Skills
 * are single-file: one SKILL.md procedure body.
 */
import { ChannelMethods } from "./client-channels.js";
import type { CreateSkillInput, UpdateSkillPatch as SkillUpdatePatch } from "./skills.js";
import type { ResolvedSkill, Skill, SkillFile, SkillWriteFileResult } from "./skill-types.js";
export declare class SkillMethods extends ChannelMethods {
    listSkills(): Promise<Skill[]>;
    getSkill(slug: string): Promise<ResolvedSkill>;
    createSkill(input: CreateSkillInput): Promise<{
        skill: Skill;
        primaryFile: SkillFile;
    }>;
    updateSkill(slug: string, patch: SkillUpdatePatch): Promise<Skill>;
    deleteSkill(slug: string): Promise<void>;
    readSkillBody(slug: string): Promise<SkillFile>;
    writeSkillBody(slug: string, body: string, expectedVersion?: string | null): Promise<SkillWriteFileResult>;
}
