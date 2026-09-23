import "server-only";

/** Agent-identity domain errors, mapped to `HttpError` by `http-mapping.ts › mapAgentIdentityError`. */

/** One error for "no such row" and "not visible to you" — 404, never 403, so an id cannot be probed. */
export class AgentIdentityNotFoundError extends Error {
  readonly code = "AGENT_IDENTITY_NOT_FOUND";
  constructor(identifier: string) {
    super(`Agent identity not found: ${identifier}`);
    this.name = "AgentIdentityNotFoundError";
  }
}

/**
 * A requested knowledge scope the caller cannot read. 404-shaped on purpose: "may not attach" and
 * "no such base" must be one answer, or the attach gate is an existence oracle for private bases.
 */
export class IdentityKnowledgeBaseNotFoundError extends Error {
  readonly code = "KNOWLEDGE_BASE_NOT_FOUND";
  readonly missingIds: string[];
  constructor(missingIds: string[]) {
    super(
      missingIds.length === 1
        ? `Knowledge base not found: ${missingIds[0]}`
        : `Knowledge bases not found: ${missingIds.join(", ")}`
    );
    this.name = "IdentityKnowledgeBaseNotFoundError";
    this.missingIds = missingIds;
  }
}

/** A team id is not a team of this workspace, or (for a non-admin owner) not one the caller is in. */
export class IdentityTeamNotGrantableError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "IdentityTeamNotGrantableError";
  }
}

/** Neither creator nor workspace admin. Only thrown for a visible row — the 404 fires first. */
export class IdentityWriteForbiddenError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(action: string) {
    super(`Only the identity's creator or a workspace admin can ${action} it`);
    this.name = "IdentityWriteForbiddenError";
  }
}

/** A shared credential may not create or own a private identity (it can pass between humans). */
export class WorkspaceKeyPrivateIdentityError extends Error {
  readonly code = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
  constructor() {
    super(
      "Workspace-scoped API keys cannot create or own private agent identities. " +
        "Use a personal API key (from Account Settings → Keys) for private items."
    );
    this.name = "WorkspaceKeyPrivateIdentityError";
  }
}

/**
 * An agent credential may not create or move a row into `team` (the REST schema
 * still accepts the value for humans). Refuses the credential, not the value — 403, not 400.
 */
export class IdentityTeamScopeAgentForbiddenError extends Error {
  readonly code = "IDENTITY_TEAM_SCOPE_AGENT_FORBIDDEN";
  constructor() {
    super(
      "Team-scoped sharing is a human-only setting — an agent cannot create or " +
        "move an agent identity into `visibility: \"team\"`. Use \"private\" or " +
        "\"workspace\", or ask your operator to set the team scope in the Dopl app."
    );
    this.name = "IdentityTeamScopeAgentForbiddenError";
  }
}

/** `expectedUpdatedAt` ≠ the row's `updated_at` → 412. Worded as `KnowledgeStaleVersionError`'s twin. */
export class IdentityStaleVersionError extends Error {
  readonly code = "AGENT_IDENTITY_STALE_VERSION";
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `Stale write rejected — row was modified at ${actual} but the request expected ${expected}. Refetch and retry.`
    );
    this.name = "IdentityStaleVersionError";
    this.expected = expected;
    this.actual = actual;
  }
}
