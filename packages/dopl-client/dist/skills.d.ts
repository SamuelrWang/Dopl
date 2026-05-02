/**
 * Skills methods for `DoplClient`.
 *
 * Read paths (`listSkills`, `getSkill`) are surfaced to all callers.
 * Write paths (`createSkill`, `updateSkill`, `deleteSkill`, file CRUD)
 * are gated server-side by the per-skill `agent_write_enabled` toggle
 * for API-key (agent) callers; session callers bypass that check.
 */
import type { DoplTransport } from "./transport.js";
import type { ResolvedSkill, Skill, SkillFile, SkillStatus } from "./skill-types.js";
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
}
export declare function updateSkill(t: DoplTransport, slug: string, patch: UpdateSkillPatch): Promise<Skill>;
export declare function deleteSkill(t: DoplTransport, slug: string): Promise<void>;
export declare function listSkillFiles(t: DoplTransport, slug: string): Promise<SkillFile[]>;
export declare function readSkillFile(t: DoplTransport, slug: string, fileName: string): Promise<SkillFile>;
export declare function createSkillFile(t: DoplTransport, slug: string, input: {
    name: string;
    body?: string;
}): Promise<SkillFile>;
export declare function writeSkillFile(t: DoplTransport, slug: string, fileName: string, body: string): Promise<SkillFile>;
export declare function renameSkillFile(t: DoplTransport, slug: string, currentName: string, newName: string): Promise<SkillFile>;
export declare function deleteSkillFile(t: DoplTransport, slug: string, fileName: string): Promise<void>;
