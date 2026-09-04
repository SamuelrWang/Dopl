import "server-only";

/**
 * Domain errors thrown by the knowledge service. ⚠ Deliberately NOT `HttpError`
 * — the route boundary and MCP tool handlers each translate separately, so the
 * same service feeds both without HTTP semantics leaking into the domain.
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

/** `source: "agent"` mutating a base with `agent_write_enabled` off. → 403. */
export class AgentWriteDisabledError extends Error {
  readonly code = "AGENT_WRITE_DISABLED";
  constructor(baseId: string, message?: string) {
    super(
      message ??
        `Agent writes are disabled for knowledge base ${baseId}. ` +
          `Toggle the agent-write setting in the knowledge base settings to enable.`
    );
    this.name = "AgentWriteDisabledError";
  }
}

/** Non-owner, non-admin changing sharing scope (visibility / access mode /
 *  team grants). → 403. */
export class ScopeChangeForbiddenError extends Error {
  readonly code = "SCOPE_CHANGE_FORBIDDEN";
  constructor() {
    super(
      "Only the knowledge base owner or a workspace admin can change sharing settings."
    );
    this.name = "ScopeChangeForbiddenError";
  }
}

/**
 * Workspace-scoped API key (`api_keys.workspace_id IS NOT NULL`) creating a
 * private resource. Such keys are shared between humans, so a private resource
 * would either leak or be STRANDED — the same key can't read it back through
 * `canSeeBase`'s key-scope filter.
 */
export class WorkspaceKeyPrivateVisibilityError extends Error {
  readonly code = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
  constructor() {
    super(
      "Workspace-scoped API keys cannot create or own private resources. " +
        "Use a personal API key (from Account Settings → Keys) for private items."
    );
    this.name = "WorkspaceKeyPrivateVisibilityError";
  }
}

/**
 * The `enforce_channel_resource_grant()` trigger refused a (KB, channel) grant
 * — the KB, the channel and the grant row must all name the SAME workspace.
 * → 400.
 *
 * ⚠ IT IS A BACKSTOP THAT SHOULD BE UNREACHABLE, AND IT IS TRANSLATED ANYWAY.
 * The route fences the channel (`isChannelVisibleTo`) and the base
 * (`getBaseById`) against the caller's own workspace before the write, so a
 * mismatch means one of those fences moved. A raw `P0001` would surface as a
 * 500 and read as an outage; a 4xx says "refused", which is what happened.
 * ⚠ The trigger's own message is NOT forwarded — it names both workspace ids.
 */
export class ChannelGrantInvalidError extends Error {
  readonly code = "CHANNEL_GRANT_INVALID";
  constructor() {
    super(
      "A knowledge base can only be shared into channels in the same workspace."
    );
    this.name = "ChannelGrantInvalidError";
  }
}

/**
 * The channel lane's grant is at `visible` but `guest_write` is OFF — the
 * caller may READ this base through the channel and may not write it. → 403.
 *
 * ⚠ IT IS THE ONE REFUSAL ON THAT LANE THAT IS NOT A 404, AND THAT ASYMMETRY IS
 * DELIBERATE. Everything upstream of it — no membership, no grant, `agent_only`,
 * a dead base, another base's entry — answers NOT-FOUND, because the question
 * "does this exist" must not be answerable. By the time this throws the caller
 * has ALREADY been shown the entry by the very same grant, so there is nothing
 * left to conceal: a 404 here would only mean "the thing you are looking at is
 * not there".
 */
export class ChannelGrantReadOnlyError extends Error {
  readonly code = "CHANNEL_GRANT_READ_ONLY";
  constructor() {
    super(
      "This knowledge base is shared into the channel as read-only. Ask the owner to allow edits."
    );
    this.name = "ChannelGrantReadOnlyError";
  }
}

/** Non-admin granting a team they don't belong to. → 403. */
export class TeamScopeForbiddenError extends Error {
  readonly code = "TEAM_SCOPE_FORBIDDEN";
  constructor() {
    super("You can only share with teams you belong to.");
    this.name = "TeamScopeForbiddenError";
  }
}

/**
 * Folder move creating an A→B→…→A cycle. DB trigger
 * `prevent_knowledge_folder_cycle` is the safety net; service pre-checks via
 * `listFolderAncestors` so users get this instead of a Postgres `23514`.
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
 * A row whose tenancy disagrees with the context reading it.
 *
 * ⚠ **IT IS TWO DIFFERENT EVENTS WEARING ONE NAME, AND THE SECOND IS A BUG.**
 * On the id lane it is CONTROL FLOW — `service-bases.ts › loadVisibleBase`
 * catches it to mean "not in this container, follow the id" — and it is not
 * logged, because a follow is the normal path. Anything that reaches a RESPONSE
 * is the other kind: a child row left on a tenancy its parent no longer has
 * (F-664), which is a server invariant violation and not a caller's mistake.
 *
 * ⚠ **SO IT CARRIES THE TWO IDS.** Until 2026-09-03 it carried a sentence
 * ("entry belongs to a different workspace") and the mapper answered 400 with
 * it, so the one thing an operator needed — WHICH row and WHICH two tenancies —
 * existed nowhere, and the class of defect was undiagnosable from logs alone.
 * ⚠ The ids are for the SERVER LOG (`http-mapping.ts`); the client still gets
 * the sentence, because naming a workspace the caller cannot see is an oracle.
 */
export class KnowledgeBaseMismatchError extends Error {
  readonly code = "KNOWLEDGE_BASE_MISMATCH";
  constructor(
    message: string,
    /** The row's own `workspace_id`. */
    readonly rowWorkspaceId: string | null = null,
    /** The tenancy the read was running in. */
    readonly contextWorkspaceId: string | null = null,
    /** What the row is, and its id where the caller supplied one. */
    readonly subject: string | null = null
  ) {
    super(message);
    this.name = "KnowledgeBaseMismatchError";
  }
}

/** Base slug collides with an existing (or recently soft-deleted) slug in the
 *  workspace. → 409. */
export class KnowledgeBaseSlugConflictError extends Error {
  readonly code = "KNOWLEDGE_BASE_SLUG_CONFLICT";
  constructor(slug: string) {
    super(`Knowledge base slug already in use in this workspace: ${slug}`);
    this.name = "KnowledgeBaseSlugConflictError";
  }
}

/** Non-final path segment doesn't resolve to an active folder (asked
 *  `a/b/c.md`, no folder `a/b`). → 404. */
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

/** Collision with the unique partial index — folders (kb, parent, name),
 *  entries (kb, folder, title), active rows only. → 409. */
export class KnowledgePathConflictError extends Error {
  readonly code = "KNOWLEDGE_PATH_CONFLICT";
  constructor(path: string) {
    super(`A folder or entry already exists at "${path}".`);
    this.name = "KnowledgePathConflictError";
  }
}

/**
 * Write pushing a base past its plan's per-base storage cap.
 *
 * ⚠ PLAN GATE, not a validation error — does NOT go through `mapKnowledgeError`
 * / the nested envelope. `toKnowledgeErrorResponse` emits the flat
 * `{ error, message, upgrade_url }` envelope at 403, matching the ontology
 * object cap (`api/ontology/objects/route.ts`) because `@dopl/client` and every
 * MCP agent behind it already parse exactly that.
 *
 * FREEZE, NEVER DELETE: only GROWTH throws. Reads, deletes, moves, renames and
 * shrinking edits stay allowed while over cap.
 */
export class KnowledgeStorageLimitError extends Error {
  readonly code = "kb_storage_full";
  readonly baseId: string;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly deltaBytes: number;
  constructor(
    baseId: string,
    usedBytes: number,
    limitBytes: number,
    deltaBytes: number,
    message: string
  ) {
    super(message);
    this.name = "KnowledgeStorageLimitError";
    this.baseId = baseId;
    this.usedBytes = usedBytes;
    this.limitBytes = limitBytes;
    this.deltaBytes = deltaBytes;
  }
}

/** `expectedUpdatedAt` precondition ≠ row's `updated_at`. → 412; client
 *  refetches and retries. Prevents silent two-tab overwrites. */
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

/**
 * A `section=` argument that names TWO headings in one entry. → 409; the caller
 * disambiguates or edits the whole body.
 *
 * ⚠ **A REFUSAL RATHER THAN A FIRST-MATCH, AND ONLY ON THE WRITE PATH IT IS
 * FATAL.** A read can hand back both positions and let the agent choose; a
 * write that picked one would overwrite a section the caller did not name, and
 * there is no trash to recover it from. The positions travel in `details` so
 * the answer carries its own remedy.
 */
export class KnowledgeSectionAmbiguousError extends Error {
  readonly code = "KNOWLEDGE_SECTION_AMBIGUOUS";
  readonly heading: string;
  readonly lines: number[];
  constructor(heading: string, lines: number[]) {
    super(
      `"${heading}" names ${lines.length} headings in this entry (lines ${lines.join(", ")}) — rename one, or write the whole body.`
    );
    this.name = "KnowledgeSectionAmbiguousError";
    this.heading = heading;
    this.lines = lines;
  }
}
