import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  AgentTemplateNotFoundError,
  TemplateKnowledgeBaseNotFoundError,
  TemplateTeamNotGrantableError,
  TemplateWriteForbiddenError,
  WorkspaceKeyPrivateTemplateError,
} from "./errors";

/** Agent-template domain errors → `HttpError`. Null for anything
 *  unrecognized, so the caller falls through to a generic 500 — same contract
 *  as `mapSkillError` / `mapKnowledgeError`. */
export function mapAgentTemplateError(err: unknown): HttpError | null {
  if (err instanceof AgentTemplateNotFoundError) {
    return new HttpError(404, "AGENT_TEMPLATE_NOT_FOUND", err.message);
  }
  if (err instanceof TemplateKnowledgeBaseNotFoundError) {
    // ⚠ 404, not 403 — see the error class: a distinguishable "forbidden" here
    // would turn the attach endpoint into an existence oracle for private KBs.
    return new HttpError(404, "KNOWLEDGE_BASE_NOT_FOUND", err.message, {
      knowledgeBaseIds: err.missingIds,
    });
  }
  if (err instanceof TemplateTeamNotGrantableError) {
    return new HttpError(403, "RESOURCE_ACCESS_DENIED", err.message);
  }
  if (err instanceof TemplateWriteForbiddenError) {
    return new HttpError(403, "RESOURCE_ACCESS_DENIED", err.message);
  }
  if (err instanceof WorkspaceKeyPrivateTemplateError) {
    return new HttpError(403, "WORKSPACE_KEY_PRIVATE_VISIBILITY", err.message);
  }
  return null;
}
