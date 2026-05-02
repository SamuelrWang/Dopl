import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  SkillAgentWriteDisabledError,
  SkillFileConflictError,
  SkillFileNameInvalidError,
  SkillFileNotFoundError,
  SkillNotFoundError,
  SkillPrimaryFileImmutableError,
  SkillSlugConflictError,
  SkillStaleVersionError,
} from "./errors";

/**
 * Translates skills domain errors to HttpError. Returns null for
 * unrecognized errors so the caller falls through to a generic 500.
 */
export function mapSkillError(err: unknown): HttpError | null {
  if (err instanceof SkillNotFoundError) {
    return new HttpError(404, "SKILL_NOT_FOUND", err.message);
  }
  if (err instanceof SkillFileNotFoundError) {
    return new HttpError(404, "SKILL_FILE_NOT_FOUND", err.message);
  }
  if (err instanceof SkillAgentWriteDisabledError) {
    return new HttpError(403, "SKILL_AGENT_WRITE_DISABLED", err.message);
  }
  if (err instanceof SkillSlugConflictError) {
    return new HttpError(409, "SKILL_SLUG_CONFLICT", err.message);
  }
  if (err instanceof SkillFileConflictError) {
    return new HttpError(409, "SKILL_FILE_CONFLICT", err.message);
  }
  if (err instanceof SkillFileNameInvalidError) {
    return new HttpError(400, "SKILL_FILE_NAME_INVALID", err.message);
  }
  if (err instanceof SkillPrimaryFileImmutableError) {
    return new HttpError(409, "SKILL_PRIMARY_FILE_IMMUTABLE", err.message);
  }
  if (err instanceof SkillStaleVersionError) {
    return new HttpError(412, "SKILL_STALE_VERSION", err.message, {
      expected: err.expected,
      actual: err.actual,
    });
  }
  return null;
}
