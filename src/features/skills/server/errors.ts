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
  constructor(slug: string, message?: string) {
    super(
      message ??
        `Agent writes are disabled for skill "${slug}". Toggle the per-skill setting to enable.`
    );
    this.name = "SkillAgentWriteDisabledError";
  }
}

/**
 * Thrown when a permanent-delete (purge) targets a skill that is not in
 * the trash (`deleted_at IS NULL`). Purge only hard-deletes soft-deleted
 * skills — a live skill must be trashed first. Maps to 400.
 */
export class SkillNotTrashedError extends Error {
  readonly code = "SKILL_NOT_TRASHED";
  constructor(identifier: string) {
    super(
      `Cannot permanently delete skill ${identifier} — it is not in the trash. Move it to the trash first.`
    );
    this.name = "SkillNotTrashedError";
  }
}

export class SkillFileNotFoundError extends Error {
  readonly code = "SKILL_FILE_NOT_FOUND";
  constructor(skillSlug: string, fileName: string) {
    super(`File "${fileName}" not found in skill "${skillSlug}"`);
    this.name = "SkillFileNotFoundError";
  }
}

/**
 * Thrown when a PATCH/PUT carries an `expectedUpdatedAt` precondition
 * that doesn't match the row's current `updated_at`. Maps to 412 — the
 * client should refetch and surface a conflict resolution UI rather
 * than silently overwriting the parallel writer's content.
 */
export class SkillStaleVersionError extends Error {
  readonly code = "SKILL_STALE_VERSION";
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `Stale write rejected — row was modified at ${actual} but the request expected ${expected}. Refetch and retry.`
    );
    this.name = "SkillStaleVersionError";
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Thrown when a workspace-scoped API key tries to create a private
 * skill. Mirrors `WorkspaceKeyPrivateVisibilityError` in the
 * knowledge feature — see that doc for the rationale (Audit B6).
 */
export class WorkspaceKeyPrivateSkillError extends Error {
  readonly code = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
  constructor() {
    super(
      "Workspace-scoped API keys cannot create or own private skills. " +
        "Use a personal API key (from Account Settings → Keys) for private items."
    );
    this.name = "WorkspaceKeyPrivateSkillError";
  }
}
