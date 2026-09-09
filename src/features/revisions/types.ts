/**
 * REVISIONS — the shared history primitive (2026-09-09, the CHANGELOG lane).
 *
 * ONE append-only row per WRITE OPERATION against one resource, carrying the
 * POST-WRITE snapshot. Knowledge uses it today; ontology's HubSpot-style
 * per-field history (part 2, owed — `docs/REFACTOR-FINDINGS.md`) uses the same
 * table, the same actor model and the same reads, and differs only in what its
 * {@link RevisionPayload} carries.
 *
 * ⚠ NOTHING HERE STORES A DIFF. A diff is computed at read time from two
 * snapshots (`../lib/diff.ts`), so it can never disagree with the body it claims
 * to describe.
 */

/** Every resource family that keeps a history. ⚠ PINNED AGAINST THE MIGRATION'S
 *  `CHECK` by `../schema-sql.test.ts` — a value added on one side only is a row
 *  the other side cannot file or cannot read. */
export const REVISION_RESOURCE_TYPES = [
  "knowledge_base",
  "knowledge_folder",
  "knowledge_entry",
  "ontology_cluster",
  "ontology_object",
] as const;

export type RevisionResourceType = (typeof REVISION_RESOURCE_TYPES)[number];

/**
 * The WRITE that produced the row, not the shape of the change.
 *
 *   `create`       — the resource came into being.
 *   `edit`         — its whole body/content was written.
 *   `section_edit` — one `##` section was replaced (`write_file(section=)`).
 *   `rename`       — its title/name changed and nothing else.
 *   `move`         — its parent/folder changed.
 *   `delete`       — permanent removal. The snapshot is the LAST state, which is
 *                    the only place it survives (knowledge deletes are hard).
 *   `restore`      — a prior revision's snapshot written back through the
 *                    resource's own service. ⚠ A NEW ROW, never a rewrite.
 *
 * ⚠ PINNED AGAINST THE MIGRATION'S `CHECK` by `../schema-sql.test.ts`.
 */
export const REVISION_OPS = [
  "create",
  "edit",
  "section_edit",
  "rename",
  "move",
  "delete",
  "restore",
] as const;

export type RevisionOp = (typeof REVISION_OPS)[number];

export type RevisionActorKind = "user" | "agent";

/**
 * WHO wrote it.
 *
 * ⚠ `agentSessionId` IS AN ATTRIBUTION HINT AND NEVER AN AUTHORIZATION SIGNAL
 * (`shared/auth/session-header.ts`): it is the desktop's slot key, forgeable,
 * read only to GROUP an agent session's writes in the changelog. Nothing grants
 * on it and no policy reads it.
 */
export interface RevisionActor {
  /** `null` only when the account was deleted (`ON DELETE SET NULL`). */
  userId: string | null;
  kind: RevisionActorKind;
  agentSessionId: string | null;
}

/**
 * The post-write snapshot. TWO SHAPES, ONE COLUMN, and `resourceType` says
 * which — never read one without reading the other first.
 *
 * KNOWLEDGE (`knowledge_*`): `{body, title, path}` — the document as it stood
 * after the write. `body` is absent on a base/folder revision, which has none.
 *
 * ONTOLOGY (`ontology_*`, part 2): `{field, before, after}` — the per-field
 * history a HubSpot-shaped timeline renders.
 */
export interface RevisionPayload {
  body?: string | null;
  title?: string | null;
  /** Slash path within the base, as the write addressed it. */
  path?: string | null;
  field?: string;
  before?: unknown;
  after?: unknown;
}

export interface Revision {
  id: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  /** The RESOURCE's container, never the actor's. */
  workspaceId: string;
  actor: RevisionActor;
  op: RevisionOp;
  /** A short human sentence when the write had one to give ("Restored the
   *  version from 8 Sep"), else `null`. Never generated from the payload — the
   *  renderer derives its own line from `op`. */
  summary: string | null;
  payload: RevisionPayload;
  /** SHA-256 of the snapshot's content — "did this write change anything",
   *  answerable without hauling two bodies. */
  contentHash: string;
  createdAt: string;
  /**
   * ⚠ EQUALS {@link Revision.createdAt} ON EVERY SEALED ROW. It moves only
   * inside the HUMAN COALESCING WINDOW — see
   * `server/service.ts › recordRevision`. A row whose two stamps differ is one a
   * person kept typing into.
   */
  updatedAt: string;
}

/** One day's rows, newest day first, newest row first within the day.
 *  `day` is a `YYYY-MM-DD` UTC date key — see `server/service.ts › groupByDay`
 *  for why it is UTC and not the reader's zone. */
export interface RevisionDay {
  day: string;
  revisions: Revision[];
}

/** A page of history, newest first. `nextCursor === null` = last page. */
export interface RevisionPage {
  revisions: Revision[];
  nextCursor: string | null;
}

/** The resource a history read is ABOUT. */
export interface RevisionResourceRef {
  resourceType: RevisionResourceType;
  resourceId: string;
}
