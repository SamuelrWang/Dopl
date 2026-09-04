import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { ContainerPublishUnacknowledgedError } from "@/features/workspaces/server/shared-publish";
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
  KnowledgeSectionAmbiguousError,
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
    // 🔒 **500, NOT 400, AND IT CHANGED ON 2026-09-03 (F-664).** A mismatch that
    // reaches a RESPONSE is never something the caller did: the id lane catches
    // this error as control flow (`service-bases.ts › loadVisibleBase`), so what
    // is left is a row whose tenancy disagrees with its parent's — the state
    // `20260924120000_personal_container_child_rows.sql` repairs and
    // `check-tenancy-move-gate.ts` prevents. Answering 4xx told an operator the
    // request was malformed and put the incident in nobody's error budget.
    // ⚠ THE IDS GO TO THE LOG AND NOT TO THE BODY. Naming a workspace the caller
    // cannot see would make the refusal an oracle; the sentence is unchanged.
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
  // 🔒 G16 — 400, not 403: the caller is allowed to do this, the REQUEST is
  // incomplete. Shared with the knowledge lane (`knowledge/server/
  // http-mapping.ts`) — one error class, one code, two feature mappers.
  if (err instanceof ContainerPublishUnacknowledgedError) {
    return new HttpError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED", err.message);
  }
  return null;
}
