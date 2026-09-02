import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { ContainerPublishUnacknowledgedError } from "@/features/workspaces/server/shared-publish";
import {
  SkillAgentWriteDisabledError,
  SkillFileNotFoundError,
  SkillNotFoundError,
  SkillSlugConflictError,
  SkillStaleVersionError,
  WorkspaceKeyPrivateSkillError,
} from "./errors";

/** Skills domain errors → HttpError. Null for unrecognized errors, so the
 *  caller falls through to a generic 500. */
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
  if (err instanceof SkillStaleVersionError) {
    return new HttpError(412, "SKILL_STALE_VERSION", err.message, {
      expected: err.expected,
      actual: err.actual,
    });
  }
  if (err instanceof WorkspaceKeyPrivateSkillError) {
    return new HttpError(403, "WORKSPACE_KEY_PRIVATE_VISIBILITY", err.message);
  }
  // 🔒 G16 — 400, not 403: the caller is ALLOWED to publish, the REQUEST is
  // incomplete. Same mapping as `knowledge/server/http-mapping.ts` and
  // `agent-templates/server/http-mapping.ts`, because one error class answering
  // three different statuses is how a remedy stops being actionable.
  if (err instanceof ContainerPublishUnacknowledgedError) {
    return new HttpError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED", err.message);
  }
  return null;
}
