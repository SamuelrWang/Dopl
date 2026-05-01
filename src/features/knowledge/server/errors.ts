import "server-only";

/**
 * Feature-specific error classes thrown by the knowledge service.
 *
 * Per docs/ENGINEERING.md §12, the service throws domain errors, and
 * the route boundary (Item 2) translates them to `HttpError` for the
 * client. MCP tool handlers (Item 4) do their own translation. Keeping
 * these distinct from `HttpError` lets the same service feed both
 * surfaces without leaking HTTP semantics into the domain layer.
 */

export class KnowledgeBaseNotFoundError extends Error {
  readonly code = "KNOWLEDGE_BASE_NOT_FOUND";
  constructor(identifier: string) {
    super(`Knowledge base not found: ${identifier}`);
    this.name = "KnowledgeBaseNotFoundError";
  }
}

export class FolderNotFoundError extends Error {
  readonly code = "KNOWLEDGE_FOLDER_NOT_FOUND";
  constructor(identifier: string) {
    super(`Knowledge folder not found: ${identifier}`);
    this.name = "FolderNotFoundError";
  }
}

export class EntryNotFoundError extends Error {
  readonly code = "KNOWLEDGE_ENTRY_NOT_FOUND";
  constructor(identifier: string) {
    super(`Knowledge entry not found: ${identifier}`);
    this.name = "EntryNotFoundError";
  }
}

/**
 * Thrown when a `source: "agent"` caller tries to mutate a base whose
 * `agent_write_enabled` flag is off. Maps to HTTP 403 at the route
 * boundary.
 */
export class AgentWriteDisabledError extends Error {
  readonly code = "AGENT_WRITE_DISABLED";
  constructor(baseId: string) {
    super(
      `Agent writes are disabled for knowledge base ${baseId}. ` +
        `Toggle the agent-write setting in the knowledge base settings to enable.`
    );
    this.name = "AgentWriteDisabledError";
  }
}

/**
 * Thrown when a folder move would create an A→B→…→A cycle. The DB
 * trigger `prevent_knowledge_folder_cycle` is the safety net; the
 * service pre-checks via `listFolderAncestors` so the user gets this
 * clean error rather than a Postgres `23514`.
 */
export class FolderCycleError extends Error {
  readonly code = "KNOWLEDGE_FOLDER_CYCLE";
  constructor(folderId: string, candidateParentId: string) {
    super(
      `Cannot move folder ${folderId} under ${candidateParentId} — ` +
        `that would create a cycle.`
    );
    this.name = "FolderCycleError";
  }
}

/**
 * Thrown when an entry/folder being read or moved doesn't belong to
 * the knowledge base its parent claims. Defensive — should never fire
 * if RLS and FK constraints are intact, but guards against mis-routed
 * service calls.
 */
export class KnowledgeBaseMismatchError extends Error {
  readonly code = "KNOWLEDGE_BASE_MISMATCH";
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeBaseMismatchError";
  }
}

/**
 * Thrown when a base create or update would collide with an existing
 * (or recently soft-deleted) slug in the same workspace. Surfaces as
 * 409 at the HTTP layer.
 */
export class KnowledgeBaseSlugConflictError extends Error {
  readonly code = "KNOWLEDGE_BASE_SLUG_CONFLICT";
  constructor(slug: string) {
    super(`Knowledge base slug already in use in this workspace: ${slug}`);
    this.name = "KnowledgeBaseSlugConflictError";
  }
}

/**
 * Thrown by the path resolver when a non-final segment doesn't resolve
 * to an active folder (e.g. the user asked for `a/b/c.md` but folder
 * `a/b` doesn't exist). Maps to 404 at the HTTP layer.
 */
export class PathTraversalError extends Error {
  readonly code = "KNOWLEDGE_PATH_NOT_FOUND";
  readonly missingSegment: string;
  constructor(path: string, missingSegment: string) {
    super(
      `Path "${path}" does not exist: segment "${missingSegment}" not found.`
    );
    this.name = "PathTraversalError";
    this.missingSegment = missingSegment;
  }
}

/**
 * Thrown when a name/title collides with the unique partial index
 * (folders by (kb, parent, name) or entries by (kb, folder, title)
 * among active rows). Maps to 409.
 */
export class KnowledgePathConflictError extends Error {
  readonly code = "KNOWLEDGE_PATH_CONFLICT";
  constructor(path: string) {
    super(`A folder or entry already exists at "${path}".`);
    this.name = "KnowledgePathConflictError";
  }
}

/**
 * Thrown when a PATCH carries an `expectedUpdatedAt` precondition that
 * doesn't match the row's current `updated_at`. Maps to 412 — the
 * client should refetch and retry. Item 5.A.3 added this to prevent
 * silent two-tab overwrites.
 */
export class KnowledgeStaleVersionError extends Error {
  readonly code = "KNOWLEDGE_STALE_VERSION";
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `Stale write rejected — row was modified at ${actual} but the request expected ${expected}. Refetch and retry.`
    );
    this.name = "KnowledgeStaleVersionError";
    this.expected = expected;
    this.actual = actual;
  }
}
