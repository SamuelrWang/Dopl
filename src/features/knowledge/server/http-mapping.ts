import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  AgentWriteDisabledError,
  EntryNotFoundError,
  FolderCycleError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseSlugConflictError,
  KnowledgePathConflictError,
  KnowledgeStaleVersionError,
  PathTraversalError,
} from "./errors";

/**
 * Maps a knowledge-feature domain error to an `HttpError`. Returns
 * `null` for anything unrecognized so the caller can fall through to
 * the generic 500 path.
 */
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
  return null;
}
