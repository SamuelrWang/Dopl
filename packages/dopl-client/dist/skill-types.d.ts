/**
 * Domain types for skills exposed over the Dopl API.
 *
 * ⚠ Mirrors `src/features/skills/types.ts` — hand-synced. On drift, the API
 * responses are the source of truth.
 */
export type SkillStatus = "active" | "draft";
export type SkillWriteSource = "user" | "agent";
/**
 * Skills use the full three-way model: private (owner only), public+workspace
 * (everyone), public+teams (granted teams). Fully re-scopable by the owner or a
 * workspace admin.
 */
export type SkillVisibility = "public" | "private";
export type SkillAccessMode = "workspace" | "teams";
export type SkillProvider = "slack" | "google-drive" | "gmail" | "notion" | "github";
export interface SkillConnector {
    provider: SkillProvider;
    name: string;
    status: "connected" | "available";
    meta?: string;
    usedFor: string;
}
export interface Skill {
    id: string;
    workspaceId: string;
    slug: string;
    publicId: string;
    name: string;
    description: string;
    whenToUse: string;
    whenNotToUse: string | null;
    connectors: SkillConnector[];
    status: SkillStatus;
    agentWriteEnabled: boolean;
    visibility: SkillVisibility;
    accessMode: SkillAccessMode;
    /** Organizing folder label; null = unfiled. */
    folder: string | null;
    /** Populated only for owners/admins on teams-mode skills. */
    grantedTeamIds: string[];
    createdBy: string | null;
    lastEditedBy: string | null;
    lastEditedSource: SkillWriteSource;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
/** The `SKILL.md` procedure body. Skills are single-file: exactly one active. */
export interface SkillFile {
    id: string;
    workspaceId: string;
    skillId: string;
    name: string;
    body: string;
    position: number;
    createdBy: string | null;
    lastEditedBy: string | null;
    lastEditedSource: SkillWriteSource;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
export interface SkillWriteFileResult {
    file: SkillFile;
}
export interface ResolvedSkillReference {
    kind: "kb" | "connector";
    slug?: string;
    provider?: string;
    field?: string;
    label: string;
    available: boolean;
}
export interface ResolvedSkill {
    skill: Skill;
    files: SkillFile[];
    references: ResolvedSkillReference[];
}
