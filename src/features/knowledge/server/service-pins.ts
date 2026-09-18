import "server-only";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { getEntry } from "./service-entries";

/**
 * Pinned startup context (T81) — the workspace's curated launch reading list. A
 * pinned base or entry is auto-included in `service-startup-context.ts ›
 * getStartupContext`, which the desktop reads when it starts an agent session.
 *
 * A pin is a WORKSPACE-WIDE fact, not a per-user favourite — the difference
 * from `service-stars.ts`. Nothing here takes a user id as an argument; both the
 * user and the workspace come off `KnowledgeContext`.
 *
 * It is patchable where the shelf is not: a shelf move is a TENANCY question
 * (since slice B15, literally a `workspace_id` move) so the shelf stays
 * create-only (F-342; Samuel's ruling Q8, 2026-08-28), while a pin changes no
 * audience and no visibility. Hence two idempotent verbs and deliberate absence
 * from `../schema.ts › KnowledgeBaseUpdateSchema` and
 * `repository-bases.ts › UpdateBasePatch` — a PATCH arm would be a second door
 * onto one write.
 *
 * The SERVICE is the fence, not RLS: every read below runs on the service-role
 * client, which bypasses row-level security (INVARIANTS §2). What refuses is
 * `service-bases.ts › getBaseById`.
 */

/**
 * Which of `bases` are pinned — the fold behind
 * `GET /api/knowledge/bases › pinnedBaseIds`. One query for N bases.
 *
 * Takes the POST-VISIBILITY base list: the id set IS the fence. It applies no
 * visibility of its own and must never be handed a wider set — the array is
 * always a SUBSET of the ids in the same response.
 */
export async function listPinnedBaseIds(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<string[]> {
  if (bases.length === 0) return [];
  const visible = new Set(bases.map((b) => b.id));
  const pinned = await repo.listPinnedBaseIds(ctx.workspaceId, [...visible]);
  // Belt and braces over the `in` filter, the same guard the star and shelf
  // folds keep: an id outside the visible set means the filter was ignored.
  return pinned.filter((id) => visible.has(id));
}

/**
 * Pin or unpin a whole base. Idempotent in BOTH directions — the write states the
 * end state, never a delta.
 *
 * Gated on `getBaseById` in BOTH directions: a pin is the workspace's row, not
 * the caller's, so an unpin is as much a write to shared state as a pin. It also
 * keeps `pinned: false` from being an existence probe — wrong workspace, hidden
 * by visibility, and outside an agent's audience ceiling are ONE 404.
 */
export async function pinBase(
  ctx: KnowledgeContext,
  baseId: string,
  pinned: boolean
): Promise<void> {
  const base = await getBaseById(ctx, baseId);
  await repo.setBasePinned(ctx.workspaceId, base.id, pinned);
}

/**
 * Pin or unpin ONE entry, so a single document can join the launch context
 * without its whole base coming with it.
 *
 * It chases the entry up to its base by COMPOSING
 * `service-entries.ts › getEntry` rather than restating that walk, so a gate
 * added to the foundational lookup reaches this write for free.
 */
export async function pinEntry(
  ctx: KnowledgeContext,
  entryId: string,
  pinned: boolean
): Promise<void> {
  const entry = await getEntry(ctx, entryId);
  await repo.setEntryPinned(ctx.workspaceId, entry.id, pinned);
}
