import "server-only";

/** Skills domain errors, mapped to HttpError at the route boundary via
 *  `mapSkillError`. */

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

export class SkillFileNotFoundError extends Error {
  readonly code = "SKILL_FILE_NOT_FOUND";
  constructor(skillSlug: string, fileName: string) {
    super(`File "${fileName}" not found in skill "${skillSlug}"`);
    this.name = "SkillFileNotFoundError";
  }
}

/** `expectedUpdatedAt` precondition didn't match the row's `updated_at`.
 *  Maps to 412 — ⚠ the client must refetch and surface a conflict UI, never
 *  silently overwrite the parallel writer. */
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

/** Workspace-scoped API key tried to create a private skill. Mirrors
 *  `WorkspaceKeyPrivateVisibilityError` in the knowledge feature. */
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
