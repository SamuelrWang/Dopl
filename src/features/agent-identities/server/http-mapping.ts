import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { ContainerPublishUnacknowledgedError } from "@/features/workspaces/server/shared-publish";
import {
  AgentIdentityNotFoundError,
  IdentityKnowledgeBaseNotFoundError,
  IdentityStaleVersionError,
  IdentityTeamNotGrantableError,
  IdentityWriteForbiddenError,
  IdentityTeamScopeAgentForbiddenError,
  WorkspaceKeyPrivateIdentityError,
} from "./errors";

/** Agent-identity domain errors → `HttpError`; `null` for anything else (the caller's generic 500). */
export function mapAgentIdentityError(err: unknown): HttpError | null {
  if (err instanceof AgentIdentityNotFoundError) {
    // No `details`: a key's presence would itself be a fact about a row the caller may not see.
    return new HttpError(404, "AGENT_IDENTITY_NOT_FOUND", err.message);
  }
  if (err instanceof IdentityKnowledgeBaseNotFoundError) {
    // 404, never 403 — a distinguishable "forbidden" would be an existence oracle for private KBs.
    return new HttpError(404, "KNOWLEDGE_BASE_NOT_FOUND", err.message, {
      knowledgeBaseIds: err.missingIds,
    });
  }
  // Same `details` pair as the KB lane's 412 — the editor and `dopl_agent` read `actual`.
  if (err instanceof IdentityStaleVersionError) {
    return new HttpError(412, "AGENT_IDENTITY_STALE_VERSION", err.message, {
      expected: err.expected,
      actual: err.actual,
    });
  }
  if (err instanceof IdentityTeamNotGrantableError) {
    return new HttpError(403, "RESOURCE_ACCESS_DENIED", err.message);
  }
  if (err instanceof IdentityWriteForbiddenError) {
    return new HttpError(403, "RESOURCE_ACCESS_DENIED", err.message);
  }
  if (err instanceof WorkspaceKeyPrivateIdentityError) {
    return new HttpError(403, "WORKSPACE_KEY_PRIVATE_VISIBILITY", err.message);
  }
  if (err instanceof IdentityTeamScopeAgentForbiddenError) {
    return new HttpError(403, "IDENTITY_TEAM_SCOPE_AGENT_FORBIDDEN", err.message);
  }
  // G16: 400, not 403 — the caller may do this; the request is incomplete. Shared with knowledge.
  if (err instanceof ContainerPublishUnacknowledgedError) {
    return new HttpError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED", err.message);
  }
  return null;
}
