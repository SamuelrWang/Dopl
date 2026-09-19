import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { ContainerPublishUnacknowledgedError } from "@/features/workspaces/server/shared-publish";
// The changelog's two domain errors are delegated, not restated:
// `revisions/server/http-mapping.ts` is the one statement, so there is only one
// place a 404 could become a 403.
import { mapRevisionError } from "@/features/revisions/server/http-mapping";
import {
  AgentWriteDisabledError,
  ChannelGrantInvalidError,
  EntryNotFoundError,
  FolderCycleError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseSlugConflictError,
  KnowledgePathConflictError,
  KnowledgeSectionAmbiguousError,
  KnowledgeStaleVersionError,
  KnowledgeTargetVanishedError,
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
  const revision = mapRevisionError(err);
  if (revision) return revision;
  if (err instanceof AgentWriteDisabledError) {
    return new HttpError(403, "AGENT_WRITE_DISABLED", err.message);
  }
  if (err instanceof FolderCycleError) {
    return new HttpError(409, "KNOWLEDGE_FOLDER_CYCLE", err.message);
  }
  if (err instanceof KnowledgeBaseMismatchError) {
    // 500, not 400 (2026-09-03, F-664): a mismatch that reaches a RESPONSE is
    // never something the caller did — the id lane catches this error as control
    // flow (`service-bases.ts › loadVisibleBase`), so what is left is a row whose
    // tenancy disagrees with its parent's.
    // The ids go to the LOG and not to the body: naming a workspace the caller
    // cannot see would make the refusal an oracle.
    console.error(
      "[knowledge] tenancy mismatch — a row disagrees with its parent's workspace:",
      {
        subject: err.subject,
        rowWorkspaceId: err.rowWorkspaceId,
        contextWorkspaceId: err.contextWorkspaceId,
      }
    );
    return new HttpError(500, "KNOWLEDGE_BASE_MISMATCH", err.message);
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
  if (err instanceof KnowledgeSectionAmbiguousError) {
    return new HttpError(409, "KNOWLEDGE_SECTION_AMBIGUOUS", err.message, {
      heading: err.heading,
      lines: err.lines,
    });
  }
  // S40 — 409 and NOT 412: no version mismatched, the row is gone. A 412 here
  // sent the caller to `read_file` for a version that cannot exist.
  if (err instanceof KnowledgeTargetVanishedError) {
    return new HttpError(409, "KNOWLEDGE_TARGET_VANISHED", err.message, {
      path: err.path,
    });
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
  // R-18 (2026-09-17): `CHANNEL_GRANT_READ_ONLY` (403) left this mapper with the
  // channel knowledge lane — nothing can throw it now.
  // G16 — 400, not 403: the caller is allowed to do this, the REQUEST is
  // incomplete. One error class, one code, two feature mappers.
  if (err instanceof ContainerPublishUnacknowledgedError) {
    return new HttpError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED", err.message);
  }
  return null;
}
