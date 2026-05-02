import "server-only";

/**
 * Domain errors thrown by the skills service. Mapped to HttpError at
 * the route boundary via `mapSkillError`.
 */

export class SkillNotFoundError extends Error {
  readonly code = "SKILL_NOT_FOUND";
  constructor(identifier: string) {
    super(`Skill not found: ${identifier}`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillSlugConflictError extends Error {
  readonly code = "SKILL_SLUG_CONFLICT";
  constructor(slug: string) {
    super(`Skill slug already in use in this workspace: ${slug}`);
    this.name = "SkillSlugConflictError";
  }
}

export class SkillAgentWriteDisabledError extends Error {
  readonly code = "SKILL_AGENT_WRITE_DISABLED";
  constructor(slug: string) {
    super(
      `Agent writes are disabled for skill "${slug}". Toggle the per-skill setting to enable.`
    );
    this.name = "SkillAgentWriteDisabledError";
  }
}

export class SkillFileNotFoundError extends Error {
  readonly code = "SKILL_FILE_NOT_FOUND";
  constructor(skillSlug: string, fileName: string) {
    super(`File "${fileName}" not found in skill "${skillSlug}"`);
    this.name = "SkillFileNotFoundError";
  }
}

export class SkillFileConflictError extends Error {
  readonly code = "SKILL_FILE_CONFLICT";
  constructor(fileName: string) {
    super(`A file named "${fileName}" already exists in this skill`);
    this.name = "SkillFileConflictError";
  }
}

export class SkillFileNameInvalidError extends Error {
  readonly code = "SKILL_FILE_NAME_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "SkillFileNameInvalidError";
  }
}

/**
 * Thrown when a delete or rename would remove the canonical SKILL.md.
 * Every skill must keep its SKILL.md.
 */
export class SkillPrimaryFileImmutableError extends Error {
  readonly code = "SKILL_PRIMARY_FILE_IMMUTABLE";
  constructor(message = "SKILL.md cannot be deleted or renamed") {
    super(message);
    this.name = "SkillPrimaryFileImmutableError";
  }
}
