import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  AgentWriteDisabledError,
  ChannelGrantInvalidError,
  ChannelGrantReadOnlyError,
  EntryNotFoundError,
  FolderCycleError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseSlugConflictError,
  KnowledgePathConflictError,
  KnowledgeStaleVersionError,
  PathTraversalError,
  ScopeChangeForbiddenError,
  TeamScopeForbiddenError,
  WorkspaceKeyPrivateVisibilityError,
} from "./errors";

/** Domain error → `HttpError`. `null` for anything unrecognized, so callers
 *  fall through to the generic 500 path. */
export function mapKnowledgeError(err: unknown): HttpError | null {
  if (err instanceof KnowledgeBaseNotFoundError) {
    return new HttpError(404, "KNOWLEDGE_BASE_NOT_FOUND", err.message);
  }
  if (err instanceof FolderNotFoundError) {
    return new HttpError(404, "KNOWLEDGE_FOLDER_NOT_FOUND", err.message);
  }
  if (err instanceof EntryNotFoundError) {
    return new HttpError(404, "KNOWLEDGE_ENTRY_NOT_FOUND", err.message);
  }
  if (err instanceof AgentWriteDisabledError) {
    return new HttpError(403, "AGENT_WRITE_DISABLED", err.message);
  }
  if (err instanceof FolderCycleError) {
    return new HttpError(409, "KNOWLEDGE_FOLDER_CYCLE", err.message);
  }
  if (err instanceof KnowledgeBaseMismatchError) {
    return new HttpError(400, "KNOWLEDGE_BASE_MISMATCH", err.message);
  }
  if (err instanceof KnowledgeBaseSlugConflictError) {
    return new HttpError(409, "KNOWLEDGE_BASE_SLUG_CONFLICT", err.message);
  }
  if (err instanceof PathTraversalError) {
    return new HttpError(404, "KNOWLEDGE_PATH_NOT_FOUND", err.message);
  }
  if (err instanceof KnowledgePathConflictError) {
    return new HttpError(409, "KNOWLEDGE_PATH_CONFLICT", err.message);
  }
  if (err instanceof KnowledgeStaleVersionError) {
    return new HttpError(412, "KNOWLEDGE_STALE_VERSION", err.message, {
      expected: err.expected,
      actual: err.actual,
    });
  }
  if (err instanceof WorkspaceKeyPrivateVisibilityError) {
    return new HttpError(403, "WORKSPACE_KEY_PRIVATE_VISIBILITY", err.message);
  }
  if (err instanceof TeamScopeForbiddenError) {
    return new HttpError(403, "TEAM_SCOPE_FORBIDDEN", err.message);
  }
  if (err instanceof ScopeChangeForbiddenError) {
    return new HttpError(403, "SCOPE_CHANGE_FORBIDDEN", err.message);
  }
  // The grant trigger's RAISE, already stripped of the two workspace ids.
  if (err instanceof ChannelGrantInvalidError) {
    return new HttpError(400, "CHANNEL_GRANT_INVALID", err.message);
  }
  // The channel lane's read-only grant — the ONE 4xx there that is not a 404;
  // see the error class for why concealment has already stopped mattering.
  if (err instanceof ChannelGrantReadOnlyError) {
    return new HttpError(403, "CHANNEL_GRANT_READ_ONLY", err.message);
  }
  return null;
}
