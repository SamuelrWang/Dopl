/**
 * Skills methods for `DoplClient`.
 *
 * Reads are open to all callers. Writes are gated server-side by the per-skill
 * `agent_write_enabled` toggle for API-key (agent) callers; session callers
 * bypass that check.
 *
 * Skills are single-file: one SKILL.md body via `readSkillBody` /
 * `writeSkillBody`.
 */
import type { DoplTransport } from "./transport.js";
import type { ResolvedSkill, Skill, SkillFile, SkillStatus, SkillWriteFileResult } from "./skill-types.js";
export declare function listSkills(t: DoplTransport): Promise<Skill[]>;
export declare function getSkill(t: DoplTransport, slug: string): Promise<ResolvedSkill>;
export interface CreateSkillInput {
    name: string;
    description: string;
    whenToUse: string;
    whenNotToUse?: string | null;
    slug?: string;
    status?: SkillStatus;
    agentWriteEnabled?: boolean;
    /** Organizing folder label. Empty/omitted = unfiled. */
    folder?: string | null;
    body?: string;
}
export declare function createSkill(t: DoplTransport, input: CreateSkillInput): Promise<{
    skill: Skill;
    primaryFile: SkillFile;
}>;
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
    /** Owner or workspace admin only. Team-mode scoping (accessMode 'teams' +
     *  teamIds) is web-UI-managed. */
    visibility?: "public" | "private";
}
export declare function updateSkill(t: DoplTransport, slug: string, patch: UpdateSkillPatch): Promise<Skill>;
export declare function deleteSkill(t: DoplTransport, slug: string): Promise<void>;
export declare function readSkillBody(t: DoplTransport, slug: string): Promise<SkillFile>;
export declare function writeSkillBody(t: DoplTransport, slug: string, body: string, expectedVersion?: string | null): Promise<SkillWriteFileResult>;
