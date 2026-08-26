import "server-only";
import type {
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeTreeSnapshot,
} from "../types";
import type { ChannelLaneEntryUpdateInput } from "../schema";
import { isUuid } from "@/shared/lib/id/uuid";
import { EntryNotFoundError, KnowledgeStaleVersionError } from "./errors";
import * as repo from "./repository";
import { scheduleEntryEmbedding } from "./embeddings";
import { assertStorageHeadroom, bodyBytes } from "./service-storage";
import {
  assertGrantVisible,
  assertGrantWritable,
  listVisibleChannelGrants,
  type ChannelKnowledgeContext,
} from "./service-channel-grants";

/**
 * THE GUEST READ LANE'S PAYLOADS (Home Knowledge Panels M2, plan §3) — what the
 * four `(route, method)` pairs under
 * `src/app/api/channels/[channelId]/knowledge/**` actually return once the
 * fences have passed. The FENCES themselves are two files away and that split is
 * the point:
 *
 *   fence 1  `withWorkspaceAuth(..., {minRole:"guest"})`   — the route
 *   fence 2  `loadVisibleChannel` + `membership !== null`  — `shared/api/channel-knowledge-lane.ts`
 *   fence 3  the grant row at `visible`                    — `service-channel-grants.ts`
 *   fence 4  base alive + same workspace                   — `service-channel-grants.ts`
 *
 * Every function here begins by calling fence 3+4 (`assertGrantVisible` /
 * `assertGrantWritable`) and does nothing before it. ⚠ THE ORDERING IS THE
 * CONTRACT: a read that touched `knowledge_folders`, `knowledge_entries` or
 * `knowledge_bases` first — even only to 404 faster — would answer "does this id
 * exist in this container" for a caller who is entitled to know about exactly
 * the bases the operator granted and nothing else.
 *
 * 🔒 §3.3: NOTHING HERE COMES FROM `service-shared.ts`'s GATE HALF, and nothing
 * here goes through `service-bases.ts › getBaseById`, `service-folders.ts ›
 * getBaseTree` or `service-entries.ts › getEntry` either — every one of those
 * composes the WORKSPACE audience gate, which refuses a guest outright
 * (`defaultLevelForRole("guest") === null`). The REPOSITORY readers are reused
 * verbatim; the composition above them is restated here against a different
 * gate. `grant-lane.test.ts` pins the absence.
 *
 * ⚠ THE SERVICE IS THE FENCE, NOT RLS. `repository-*.ts` runs on the
 * service-role client, which bypasses row-level security completely. The
 * `knowledge_entries` policies never fire for these calls; if a function here
 * returns a row, the row goes out.
 */

/** One granted base, with the grant that admitted it — `guestWrite` rides along
 *  so the surface can render a pen without a second round trip. */
export interface GrantedBase {
  base: KnowledgeBase;
  grant: ChannelResourceGrant;
}

/**
 * Every knowledge base granted onto this channel at `visible`, alive, and in
 * this workspace.
 *
 * ⚠ THE GRANT ROWS ARE THE QUERY, not a filter over a base list. There is no
 * "all bases in the workspace" read anywhere on this lane — the caller may be a
 * guest, for whom that list does not exist as a concept. Bases are fetched BY
 * ID, from ids the grant table named.
 *
 * ⚠ A grant whose base is DELETED or (impossibly, per the validity trigger)
 * foreign is silently dropped rather than reported. The KB hard-delete GC
 * trigger removes grants with their base, so a row surviving its base means the
 * two got out of step — and the fail-safe direction is a shorter list.
 */
export async function listGrantedBases(
  ctx: ChannelKnowledgeContext
): Promise<GrantedBase[]> {
  const grants = await listVisibleChannelGrants(ctx);
  const baseIds = Object.keys(grants);
  if (baseIds.length === 0) return [];
  // ⚠ `listBasesByIds` is workspace-filtered but INCLUDES deleted rows by
  // contract, so the `deletedAt` filter below is not belt-and-braces.
  const bases = await repo.listBasesByIds(ctx.workspaceId, baseIds);
  return bases
    .filter((b) => b.deletedAt === null && grants[b.id] !== undefined)
    .map((base) => ({ base, grant: grants[base.id]! }))
    .sort((a, b) => a.base.name.localeCompare(b.base.name));
}

/**
 * Base + folders + entry METADATA for one granted base — the same snapshot
 * `service-folders.ts › getBaseTree` composes, recomposed above the lane's gate
 * instead of the workspace one.
 *
 * ⚠ `includeBody: false`, exactly as the workspace tree does. A tree with bodies
 * is an export, and export is one of the ops §3.1 omitted from this lane BY
 * DECISION.
 *
 * ⚠ NO ENTRY PAGING, deliberately: the workspace route's paging is opt-in
 * (`?entryLimit=`) and its default branch is this same unbounded read, so the
 * lane is no wider than the surface it mirrors. If paging is ever added here it
 * is added to BOTH, or the two disagree about what a full snapshot is.
 */
export async function getGrantedBaseTree(
  ctx: ChannelKnowledgeContext,
  baseId: string
): Promise<KnowledgeTreeSnapshot> {
  const { base } = await assertGrantVisible(ctx, baseId);
  const [folders, entries] = await Promise.all([
    repo.listFoldersForBase(base.id, false),
    repo.listEntriesForBase(base.id, { includeBody: false, includeDeleted: false }),
  ]);
  return { base, folders, entries };
}

/**
 * ONE entry, body included — and the id is CHASED UP TO ITS BASE before the
 * grant is consulted, which is the whole trick of an entry-addressed route on a
 * channel-scoped lane.
 *
 * ⚠ EVERY REFUSAL IS `EntryNotFoundError`, INCLUDING THE GRANT'S. The base gate
 * throws `KnowledgeBaseNotFoundError` (404 `KNOWLEDGE_BASE_NOT_FOUND`); letting
 * that code ride out here would separate "no such entry" from "that entry's base
 * is not shared with you", i.e. it would confirm the entry exists and name the
 * container's shape one uuid at a time. The two collapse into one answer.
 *
 * ⚠ The workspace check is on the ENTRY's own `workspace_id`, before the base
 * lookup: `findEntryById` takes no workspace id, so a cross-workspace entry id
 * would otherwise be chased into another tenant's base and refused for the wrong
 * reason (the same answer, but one query too late and one leak away from a
 * different one).
 */
export async function getGrantedEntry(
  ctx: ChannelKnowledgeContext,
  entryId: string
): Promise<KnowledgeEntry> {
  const { entry } = await resolveGrantedEntry(ctx, entryId, "read");
  return entry;
}

/**
 * Edit the body and/or title of one entry in a granted, guest-writable base
 * (§3.4). `{body?, title?, expectedVersion?}` and nothing else — no folder, no
 * position, no `entryType`, no create, no delete (Samuel's ruling 3: MVP guest
 * writes are edits to existing entries).
 *
 * ⚠ `lastEditedSource` IS THE LITERAL `"user"`, NOT `ctx.source`. The two agree
 * today only because {@link assertGrantWritable} refuses an agent outright; the
 * literal is what keeps them agreeing if that refusal is ever relaxed, and an
 * attribution line that reads "edited by an agent" on a lane no agent may write
 * would be a lie in the audit trail either way.
 *
 * ⚠ `expectedVersion` IS THE ENTRY'S `updatedAt`, and it arrives in the BODY
 * rather than in `X-Updated-At` (which is how the workspace PATCH takes it). The
 * lane is consumed by one client we ship, so the simpler shape wins; the CAS
 * semantics are identical, down to the 412 and the re-fetched actual version.
 */
export async function updateGrantedEntry(
  ctx: ChannelKnowledgeContext,
  entryId: string,
  input: ChannelLaneEntryUpdateInput
): Promise<KnowledgeEntry> {
  const { entry, base } = await resolveGrantedEntry(ctx, entryId, "write");
  const expected = input.expectedVersion;
  if (expected !== undefined && entry.updatedAt !== expected) {
    throw new KnowledgeStaleVersionError(expected, entry.updatedAt);
  }

  // The plan's per-KB storage cap, on the NET delta. It is a BILLING gate rather
  // than an audience gate — a guest filling the operator's base still spends the
  // operator's plan — and it fails open on an unreadable meter, as everywhere.
  if (input.body !== undefined) {
    await assertStorageHeadroom(
      ctx,
      base,
      bodyBytes(input.body) - bodyBytes(entry.body)
    );
  }

  const saved = await repo.updateEntryRow(
    entryId,
    {
      title: input.title,
      body: input.body,
      lastEditedBy: ctx.userId,
      lastEditedSource: "user",
    },
    expected
  );
  if (saved === null) {
    // CAS lost the race. Re-read through the SAME gate — the grant could have
    // been pulled in the meantime, and the loser of a race is not owed a row.
    const { entry: fresh } = await resolveGrantedEntry(ctx, entryId, "read");
    throw new KnowledgeStaleVersionError(expected!, fresh.updatedAt);
  }
  if (input.title !== undefined || input.body !== undefined) {
    scheduleEntryEmbedding(saved);
  }
  return saved;
}

/**
 * Entry → its base → the grant, in that order, with one answer for every miss.
 * Shared by the GET and the PUT so the two cannot drift on WHICH refusal comes
 * first; `mode` picks the gate, never the sequence.
 */
async function resolveGrantedEntry(
  ctx: ChannelKnowledgeContext,
  entryId: string,
  mode: "read" | "write"
): Promise<{ entry: KnowledgeEntry; base: KnowledgeBase }> {
  // Shape-checked before it reaches a `uuid =` filter (22P02 → 500 + a
  // `system_events` row per probe otherwise).
  if (!isUuid(entryId)) throw new EntryNotFoundError(entryId);
  const entry = await repo.findEntryById(entryId, false);
  if (entry === null || entry.workspaceId !== ctx.workspaceId) {
    throw new EntryNotFoundError(entryId);
  }
  const gate = mode === "write" ? assertGrantWritable : assertGrantVisible;
  let base: KnowledgeBase;
  try {
    ({ base } = await gate(ctx, entry.knowledgeBaseId));
  } catch (err) {
    // ⚠ ONLY the not-found half is rewritten. `ChannelGrantReadOnlyError` (403)
    // and the agent refusal are about a base the caller can already SEE, so
    // collapsing them into a 404 would hide a real answer behind a fake one.
    if (isBaseNotFound(err)) throw new EntryNotFoundError(entryId);
    throw err;
  }
  return { entry, base };
}

/** ⚠ Name-based rather than `instanceof`, so a second copy of the error module
 *  (two bundles, a mocked import) cannot turn a 404 into a 500. */
function isBaseNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "KnowledgeBaseNotFoundError" ||
      (err as { code?: string }).code === "KNOWLEDGE_BASE_NOT_FOUND")
  );
}
