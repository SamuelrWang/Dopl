import "server-only";
import { createHash } from "node:crypto";
import type {
  Revision,
  RevisionActor,
  RevisionOp,
  RevisionPage,
  RevisionPayload,
  RevisionResourceType,
} from "../types";
import { RevisionNotFoundError, RevisionNotRestorableError } from "./errors";
import { isRestorable } from "../lib/restorable";
import * as repo from "./repository";
import { canSeeRevision, type RevisionReach } from "./service-shared";
import { REVISION_PAGE_LIMIT, REVISION_PAGE_MAX } from "../constants";

/**
 * THE HISTORY PRIMITIVE'S BUSINESS LAYER — recording, paging, day-grouping and
 * restore, for every resource family that keeps a changelog.
 *
 * ⚠ **IT KNOWS NOTHING ABOUT KNOWLEDGE OR ONTOLOGY, AND THAT IS THE POINT.**
 * Callers hand it a `resourceType`, an already-gated resource and their own
 * REACH (`./service-shared.ts`); it never resolves a base, a cluster or a
 * visibility rule of its own. A second feature joins by adding an arm to the
 * SQL `CASE` and a caller that resolves its own reach — not by editing this
 * file.
 */

// ⚠ THE TWO PAGE NUMBERS LIVE IN `../constants.ts`, not here: `../schema.ts` is
// client-reachable and this module is `server-only`.
export { REVISION_PAGE_LIMIT, REVISION_PAGE_MAX } from "../constants";

/**
 * 🔒 **THE HUMAN COALESCING WINDOW — THE SEAL RULE, STATED ONCE.**
 *
 * A person typing into an entry produces one autosave `PATCH
 * /api/knowledge/entries/{id}` every few seconds. Recording each one would make
 * the changelog a keystroke log wearing the word "revision", which is exactly
 * the thing Samuel's 2026-09-09 design refuses ("it doesn't make sense to track
 * every tiny letter change"). So consecutive HUMAN edits coalesce, and a
 * revision SEALS when the window passes.
 *
 * **THE RULE, AS IMPLEMENTED.** A new record REPLACES the resource's newest
 * revision — same row, new `payload`/`content_hash`, `updated_at` bumped,
 * `created_at` UNMOVED — when ALL FIVE hold:
 *
 *   1. the incoming actor kind is `user`;
 *   2. the incoming `op` is `edit`;
 *   3. the newest row's actor kind is `user` AND its `actor_user_id` is the
 *      SAME person;
 *   4. the newest row's `op` is `edit`;
 *   5. `now - newest.createdAt < ` {@link COALESCE_WINDOW_MS}.
 *
 * Otherwise a NEW ROW STARTS. So the window closes on all four of the things
 * that should close it: five minutes of wall clock, a different person, a
 * different KIND of write (a rename, a move, a delete), and — the one that
 * matters most — **an AGENT write, which never coalesces in either direction**.
 * An agent's writes are already one per OPERATION (a `write_file` is a decision,
 * not a keystroke), and an agent write arriving mid-window closes the person's
 * row rather than joining it: two authors must never share one row.
 *
 * ⚠ **`created_at` NEVER MOVES**, so the row keeps the moment the person
 * STARTED and the window cannot be extended indefinitely by continuing to type —
 * five minutes after the first keystroke, the next save seals and opens a new
 * row. Measuring from `updated_at` instead would make one long session a single
 * revision, which is the failure from the other side.
 *
 * ⚠ **THIS IS THE ONE EXCEPTION TO APPEND-ONLY** and it is why `updated_at`
 * exists on the table at all. Nothing else ever rewrites a revision, and a
 * SEALED row (`createdAt === updatedAt`, or any row outside its window) is
 * immutable. Restore is a NEW ROW, never a rewrite — see {@link restoreRevision}.
 */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 🔒 **AND IT APPLIES TO KNOWLEDGE ONLY — THE SEAL RULE DOES NOT TRANSFER TO
 * ONTOLOGY (2026-09-09, part 2; `docs/REFACTOR-FINDINGS.md › F-686` point 3).**
 *
 * The window joins consecutive `op:"edit"` writes to ONE RESOURCE. An ontology
 * revision is one CHANGED FIELD of a resource, so a save that touched two
 * fields records two `edit` rows against the same object within milliseconds —
 * and coalescing would REPLACE the first field's row with the second field's
 * payload. One field's history would silently become another's.
 *
 * ⚠ **THE FIX IS THE FAMILY, NOT A CALLER FLAG.** Keying the window on
 * `(resource, field)` was the other option F-686 named; it is rejected because a
 * field change is ALREADY ATOMIC — nobody types a `pill` value one keystroke per
 * request — so a window would buy nothing and cost a rule with two arms. A
 * caller-supplied `coalesce: false` was rejected for the same reason a gate
 * beside a write is: the one caller that forgets it corrupts a timeline, and the
 * failure is silent.
 */
const COALESCING_RESOURCE_TYPES: ReadonlySet<RevisionResourceType> = new Set([
  "knowledge_base",
  "knowledge_folder",
  "knowledge_entry",
]);

// ─── Actor ──────────────────────────────────────────────────────────

/**
 * The two context shapes that reach this feature, and the ONE fact both carry.
 *
 * `shared/auth/with-workspace-auth.ts › WorkspaceAuthContext` has
 * `agentTokenId`; `knowledge/types.ts › KnowledgeContext` has already derived
 * the same fact into `source`. Either is accepted so no caller has to rebuild a
 * context to record a revision.
 */
export interface RevisionActorContext {
  userId: string;
  agentTokenId?: string | null;
  source?: "user" | "agent";
  /** `X-Dopl-Session-Id`, verbatim. ⚠ ATTRIBUTION ONLY — forgeable, never an
   *  authorization signal (`shared/auth/session-header.ts`). */
  sessionId?: string | null;
}

/**
 * ⚠ `source` WINS WHEN PRESENT, because it is the same derivation made one layer
 * up (`service-shared.ts › buildKnowledgeContext`) and two answers to "is this an
 * agent" is how they come to differ.
 *
 * ⚠ `agentSessionId` IS RECORDED FOR AGENTS ONLY. A human on the desktop sends
 * the same header, and stamping it into a column called `agent_session_id` would
 * label a person's edit as an agent's in every renderer that groups by it.
 */
export function deriveActor(ctx: RevisionActorContext): RevisionActor {
  const kind = ctx.source ?? (ctx.agentTokenId ? "agent" : "user");
  return {
    userId: ctx.userId,
    kind,
    agentSessionId: kind === "agent" ? (ctx.sessionId ?? null) : null,
  };
}

// ─── Record ─────────────────────────────────────────────────────────

export interface RecordRevisionInput {
  resourceType: RevisionResourceType;
  resourceId: string;
  /** The RESOURCE's container, never the actor's. */
  workspaceId: string;
  op: RevisionOp;
  /** POST-WRITE snapshot — see `../types.ts › RevisionPayload`. */
  payload: RevisionPayload;
  summary?: string | null;
}

/** SHA-256 over the snapshot with STABLE key order, so two equal payloads hash
 *  equal regardless of how their object literal was written. */
export function contentHashOf(payload: RevisionPayload): string {
  const stable = Object.keys(payload)
    .sort()
    .map((k) => [k, (payload as Record<string, unknown>)[k]] as const);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/**
 * Record ONE write. Answers the row that now holds it — a fresh append, or the
 * open human row this write coalesced into ({@link COALESCE_WINDOW_MS}).
 *
 * 🔒 ⚠ **AWAITED, AND ITS FAILURE IS THE CALLER'S.** Never `void`-ed, never
 * `catch`-and-continue: a lost revision is a lost audit, so a write whose
 * revision could not be recorded is reported as failed. Callers place this
 * INSIDE the same request, AFTER the write it records, and await it.
 */
export async function recordRevision(
  ctx: RevisionActorContext,
  input: RecordRevisionInput
): Promise<Revision> {
  const actor = deriveActor(ctx);
  const contentHash = contentHashOf(input.payload);
  const summary = input.summary ?? null;

  if (
    actor.kind === "user" &&
    input.op === "edit" &&
    COALESCING_RESOURCE_TYPES.has(input.resourceType)
  ) {
    const open = await findOpenHumanRevision(input, actor);
    if (open) {
      return repo.replaceRevisionSnapshot(
        open.id,
        {
          payload: input.payload as Record<string, unknown>,
          contentHash,
          // ⚠ The LATEST summary wins rather than being appended to: the row
          // describes the state it now holds, not the history of how it got there.
          summary: summary ?? open.summary,
        },
        new Date().toISOString()
      );
    }
  }

  return repo.appendRevision({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    workspaceId: input.workspaceId,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    agentSessionId: actor.agentSessionId,
    op: input.op,
    summary,
    payload: input.payload as Record<string, unknown>,
    contentHash,
  });
}

/** The five-clause test above, arms 3–5. Arms 1–2 are the caller's guard. */
async function findOpenHumanRevision(
  input: RecordRevisionInput,
  actor: RevisionActor
): Promise<Revision | null> {
  const latest = await repo.findLatestRevision(
    input.resourceType,
    input.resourceId
  );
  if (!latest) return null;
  if (latest.actor.kind !== "user") return null;
  if (latest.actor.userId !== actor.userId) return null;
  if (latest.op !== "edit") return null;
  const age = Date.now() - new Date(latest.createdAt).getTime();
  // ⚠ MEASURED FROM `createdAt`, NOT `updatedAt` — see COALESCE_WINDOW_MS.
  // ⚠ `< `, not `<=`: at exactly the window a new row starts, so the boundary
  // has one reading rather than two.
  return age < COALESCE_WINDOW_MS ? latest : null;
}

// ─── Read ───────────────────────────────────────────────────────────

/** Opaque keyset cursor. ⚠ It carries BOTH halves of the sort key; see
 *  `repository.ts › RevisionPageQuery`. */
export function encodeCursor(revision: Revision): string {
  return Buffer.from(`${revision.createdAt}|${revision.id}`, "utf8").toString(
    "base64url"
  );
}

export function decodeCursor(cursor: string): repo.RevisionCursor | null {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const at = raw.lastIndexOf("|");
  if (at <= 0) return null;
  return { createdAt: raw.slice(0, at), id: raw.slice(at + 1) };
}

export interface ListRevisionsOpts {
  cursor?: string | null;
  limit?: number;
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return REVISION_PAGE_LIMIT;
  return Math.min(limit, REVISION_PAGE_MAX);
}

/**
 * ONE resource's history, newest first.
 *
 * 🔒 THE CALLER HAS ALREADY GATED THE RESOURCE — `reach` is the proof, and every
 * row is re-checked against it ({@link canSeeRevision}) rather than trusted
 * because it came back from a query keyed on an id the caller supplied.
 */
export async function listRevisions(
  resource: { resourceType: RevisionResourceType; resourceId: string },
  reach: RevisionReach,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const limit = clampLimit(opts.limit);
  const before = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await repo.listRevisionsForResource(
    resource.resourceType,
    resource.resourceId,
    { limit: limit + 1, ...(before ? { before } : {}) }
  );
  return pageOf(rows, limit, reach);
}

/**
 * The ROLL-UP across a SET of resources — the base page's changelog.
 *
 * 🔒 ⚠ THE ID SET IS THE FENCE and `reach` is the belt: the caller resolved the
 * base's own entries and folders through the knowledge service, so a row that
 * came back naming anything else is dropped rather than rendered.
 */
export async function listRevisionsAcross(
  workspaceId: string,
  refs: ReadonlyArray<{ resourceType: RevisionResourceType; resourceId: string }>,
  reach: RevisionReach,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const limit = clampLimit(opts.limit);
  const before = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await repo.listRevisionsForResources(
    workspaceId,
    refs.map((r) => r.resourceId),
    { limit: limit + 1, ...(before ? { before } : {}) }
  );
  return pageOf(rows, limit, reach);
}

/**
 * ⚠ **THE CURSOR IS MINTED FROM THE LAST ROW THE QUERY RETURNED, BEFORE THE
 * REACH FILTER.** A page that filters down to nothing out of a full read is
 * still a page that did not reach the end — the same rule
 * `chats/server/repository.ts › listVisibleChats` states for its clip
 * (INVARIANTS §9). Minting it from the filtered list would stall paging on the
 * first page whose rows were all invisible.
 */
function pageOf(
  rows: Revision[],
  limit: number,
  reach: RevisionReach
): RevisionPage {
  const hasMore = rows.length > limit;
  const window = hasMore ? rows.slice(0, limit) : rows;
  const last = window[window.length - 1];
  return {
    revisions: window.filter((r) => canSeeRevision(r, reach)),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

// ⚠ THE DAY GROUPING LIVES IN `../lib/group.ts` — ONE implementation, because
// the RENDERER groups too (over every page loaded so far, not per page). It is
// re-exported here so a server caller reaches it through the service like every
// other name in this module.
export { groupByDay } from "../lib/group";

// ─── Restore ────────────────────────────────────────────────────────

/**
 * The sentence a restore's own revision carries, so every surface names the
 * source the same way. ⚠ The DATE is the source revision's, not today's.
 */
export function restoreSummary(source: Revision): string {
  return `Restored the version from ${new Date(source.createdAt)
    .toISOString()
    .slice(0, 10)}`;
}

/** Writes the snapshot back through the RESOURCE's own service. */
export type RevisionRestoreWriter = (source: Revision) => Promise<void>;

/**
 * 🔒 **RESTORE IS A NEW REVISION, NEVER A REWRITE.** Nothing here touches the
 * source row or any row between it and now: the snapshot is written back
 * THROUGH THE RESOURCE'S OWN SERVICE (`write`), which applies that resource's
 * gates, its storage accounting and its embedding refresh — and which records
 * the resulting revision itself, with `op: "restore"` and
 * {@link restoreSummary}. A restore that reached the repository would bypass
 * every one of those and leave a history with a hole in it.
 *
 * ⚠ **SO THIS FUNCTION WRITES NOTHING.** It resolves the source, fences it, and
 * hands it to the writer. That is the whole of it, and it is why `revisions`
 * does not import `knowledge`.
 *
 * 🔒 A revision the caller cannot see is `RevisionNotFoundError` — the same
 * answer an unknown id gets.
 */
export async function restoreRevision(
  revisionId: string,
  reach: RevisionReach,
  write: RevisionRestoreWriter
): Promise<Revision> {
  const source = await repo.findRevisionById(revisionId);
  if (!source || !canSeeRevision(source, reach)) {
    throw new RevisionNotFoundError(revisionId);
  }
  // ⚠ A snapshot with nothing to write back (a knowledge `move`, an ontology
  // association or `create` bundle) is refused rather than silently no-op-ed.
  // THE RULE IS STATED ONCE, in `../lib/restorable.ts`, because the RENDERER
  // asks the same question to decide whether to draw the button.
  if (!isRestorable(source)) {
    throw new RevisionNotRestorableError(revisionId);
  }
  await write(source);
  return source;
}
