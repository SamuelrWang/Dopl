import "server-only";

/** Agent-identity domain errors, mapped to `HttpError` at the route boundary
 *  via `mapAgentIdentityError`. Same shape as `skills/server/errors.ts`. */

/**
 * ⚠ ONE ERROR FOR "no such row" AND "not visible to you" — the 404-never-403
 * rule, so an id cannot be probed.
 *
 * ⚠ `elsewhere` IS THE ONE OPTIONAL FACT, AND IT DOES NOT REOPEN THAT (T35).
 * It is set only where the ref names an identity the CALLER could already list
 * for themselves — their own row, or a `workspace`-visible one, in a workspace
 * they are an active member of — that lives in a DIFFERENT tenancy than the one
 * asked in. `null` therefore still covers both original meanings, and a
 * stranger's private identity produces `null` in every workspace.
 * `service-resolve-ref.ts › classifyMissingIdentityRef` is the only producer.
 */
export class AgentIdentityNotFoundError extends Error {
  readonly code = "AGENT_IDENTITY_NOT_FOUND";
  constructor(
    identifier: string,
    readonly elsewhere: { name: string; label: string } | null = null
  ) {
    super(`Agent identity not found: ${identifier}`);
    this.name = "AgentIdentityNotFoundError";
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

/** A team id in the share set is not a team of this workspace, or (for a
 *  non-admin owner) not one the caller belongs to. */
export class IdentityTeamNotGrantableError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "IdentityTeamNotGrantableError";
  }
}

/** Write attempted by someone who is neither the creator nor a workspace
 *  admin. ⚠ Only ever thrown for an identity the caller CAN SEE — an invisible
 *  one 404s first, so this never confirms existence. */
export class IdentityWriteForbiddenError extends Error {
  readonly code = "RESOURCE_ACCESS_DENIED";
  constructor(action: string) {
    super(`Only the identity's creator or a workspace admin can ${action} it`);
    this.name = "IdentityWriteForbiddenError";
  }
}

/**
 * Workspace-scoped API key tried to create or own a private identity. Mirrors
 * `WorkspaceKeyPrivateSkillError` — such a key may be shared between humans, so
 * it must not be able to mint content only "it" can see.
 */
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
 * 🔒 **THE TEAM AXIS IS HUMAN-ONLY ON THE WRITE PATH** (2026-09-02, A8's server
 * half).
 *
 * A8 took `team` off the MCP enum, so `dopl_agent` refuses it in zod before any
 * round trip (`agent-shared.ts › VISIBILITY_ENUM_MESSAGE`). That is a fence on
 * ONE surface: the REST route's schema still accepts `visibility: "team"` and
 * `teamIds`, and an agent credential reaches that route directly. A rule enforced
 * only where the caller happens to enter is the prompt-only shape this wave
 * exists to remove.
 *
 * ⚠ **IT REFUSES THE CREDENTIAL, NOT THE VALUE.** `team` stays a legal
 * visibility for a human — B4 is the ruling that would take it out of the DB, and
 * it has not been taken. So the web UI's sharing panel is untouched and every
 * stored `team` row keeps working; what an agent may no longer do is CREATE or
 * MOVE a row into it. `knowledge/server/service-base-writes.ts` states the same
 * rule in one sentence for its own teams mode, and this is that sentence applied
 * to the second resource type that has the axis.
 *
 * ⚠ 403, not 400: the request is well-formed and the value is real. What is
 * missing is a human.
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

/**
 * `expectedUpdatedAt` precondition ≠ the row's `updated_at`. → 412; the caller
 * re-reads, reconciles and retries with the version it saw.
 *
 * ⚠ **WORDED AS THE KB LANE'S TWIN** (`knowledge/server/errors.ts ›
 * KnowledgeStaleVersionError`), deliberately: the two are one contract with two
 * nouns, and an agent that learned `expected_version` on `dopl_kb` must not have
 * to learn a second vocabulary to use it here.
 */
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
