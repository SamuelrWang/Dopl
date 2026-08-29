import "server-only";

/** Agent-template domain errors, mapped to `HttpError` at the route boundary
 *  via `mapAgentTemplateError`. Same shape as `skills/server/errors.ts`. */

export class AgentTemplateNotFoundError extends Error {
  readonly code = "AGENT_TEMPLATE_NOT_FOUND";
  constructor(identifier: string) {
    super(`Agent template not found: ${identifier}`);
    this.name = "AgentTemplateNotFoundError";
  }
}

/**
 * A KB id in the attach set is not visible to the CALLER.
 *
 * ⚠ 404-SHAPED ON PURPOSE, and this is a security choice rather than an
 * ergonomic one: "you may not attach this" and "no such base" must be the same
 * answer, or the endpoint becomes an existence oracle for other people's
 * private knowledge bases — probe ids, read the difference between the two
 * error codes. `KnowledgeBaseNotFoundError` makes the same trade.
 */
export class TemplateKnowledgeBaseNotFoundError extends Error {
  readonly code = "KNOWLEDGE_BASE_NOT_FOUND";
  readonly missingIds: string[];
  constructor(missingIds: string[]) {
    super(
      missingIds.length === 1
        ? `Knowledge base not found: ${missingIds[0]}`
        : `Knowledge bases not found: ${missingIds.join(", ")}`
    );
    this.name = "TemplateKnowledgeBaseNotFoundError";
    this.missingIds = missingIds;
  }
}

/** A team id in the share set is not a team of this workspace, or (for a
 *  non-admin owner) not one the caller belongs to. */
export class TemplateTeamNotGrantableError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "TemplateTeamNotGrantableError";
  }
}

/** Write attempted by someone who is neither the creator nor a workspace
 *  admin. ⚠ Only ever thrown for a template the caller CAN SEE — an invisible
 *  one 404s first, so this never confirms existence. */
export class TemplateWriteForbiddenError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(action: string) {
    super(`Only the template's creator or a workspace admin can ${action} it`);
    this.name = "TemplateWriteForbiddenError";
  }
}

/**
 * A create asked for the /home SHELF (`homeScoped: true`) without standing
 * where that shelf is. → 403.
 *
 * 🔒 REFUSE, NEVER DOWNGRADE — the sibling of
 * `features/knowledge/server/errors.ts › HomeScopeForbiddenError`, and for the
 * same reason: quietly creating on the other shelf produces a template the
 * surface that created it cannot find, with no error anywhere.
 *
 * ⚠ The `reason` names a property of the REQUEST (not private, not the home
 * workspace, shared credential) and never the id or name of a workspace the
 * caller may not know about.
 */
export class TemplateHomeScopeForbiddenError extends Error {
  readonly code = "TEMPLATE_HOME_SCOPE_FORBIDDEN";
  constructor(reason: string) {
    super(`This agent cannot be created on your home shelf — ${reason}.`);
    this.name = "TemplateHomeScopeForbiddenError";
  }
}

/**
 * Workspace-scoped API key tried to create or own a private template. Mirrors
 * `WorkspaceKeyPrivateSkillError` — such a key may be shared between humans, so
 * it must not be able to mint content only "it" can see.
 */
export class WorkspaceKeyPrivateTemplateError extends Error {
  readonly code = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
  constructor() {
    super(
      "Workspace-scoped API keys cannot create or own private agent templates. " +
        "Use a personal API key (from Account Settings → Keys) for private items."
    );
    this.name = "WorkspaceKeyPrivateTemplateError";
  }
}
