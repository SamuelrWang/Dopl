import "server-only";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import * as repo from "./repository";
import { getBaseById } from "./service-bases";
import { getEntry } from "./service-entries";

/**
 * PINNED STARTUP CONTEXT (T81) — the workspace's curated launch reading list.
 * A pinned base or entry is auto-included in `service-startup-context.ts ›
 * getStartupContext`, which the desktop reads when it starts an agent session.
 *
 * 🔒 ⚠ A PIN IS A WORKSPACE-WIDE FACT, NOT A PER-USER FAVOURITE, and that is
 * the whole difference from `service-stars.ts`. A star belongs to one person and
 * lives in a join table on `auth.users`; a pin says what THIS WORKSPACE'S agents
 * start every session with, so it is a boolean on the row and two members see
 * the same answer. **Nothing in this module takes a user id as an argument** —
 * that is the star module's rule kept for a different reason: not because the
 * row is personal, but because no request shape may name a workspace either.
 * Both come off `KnowledgeContext`.
 *
 * ⚠ IT IS PATCHABLE WHERE `home_scoped` IS NOT, AND THE ASYMMETRY IS DELIBERATE.
 * A shelf move is a TENANCY question — which workspace a row belongs to and who
 * can therefore reach it — so `home_scoped` is create-only (F-342; Samuel's
 * ruling Q8, 2026-08-28) and `knowledge-ops-write.ts › opUpdateBase` REFUSES a
 * `shelf` rather than dropping it. A pin changes no audience, no tenancy and no
 * visibility: it decides only whether an agent is HANDED content its caller
 * could already read. So it gets two idempotent verbs of its own and is
 * deliberately absent from `../schema.ts › KnowledgeBaseUpdateSchema` and
 * `repository-bases.ts › UpdateBasePatch` — a PATCH arm would be a second door
 * onto one write, with a second gate to keep in step.
 *
 * 🔒 ⚠ THE SERVICE IS THE FENCE, NOT RLS. Every read below runs on the
 * service-role client, which bypasses row-level security (INVARIANTS §2), so
 * `knowledge_bases_member_select` evaluates for nobody here. What refuses is
 * `service-bases.ts › getBaseById` — the foundational lookup that composes M-10
 * visibility, the teams gate AND the agent audience ceiling in one answer.
 */

/**
 * Which of `bases` are pinned — the fold behind
 * `GET /api/knowledge/bases › pinnedBaseIds`. One query for N bases.
 *
 * ⚠ Takes the POST-VISIBILITY base list: the id set IS the fence, the contract
 * `service-stars.ts › listStarredBaseIds` states and
 * `service-bases.ts › listHomeScopedBaseIds` repeats. It applies no visibility
 * of its own and must never be handed a wider set — the array is always a
 * SUBSET of the ids in the same response, so a consumer can index straight into
 * the list it was given.
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
 * Pin or unpin a whole base. Idempotent in BOTH directions — the write states
 * the end state, never a delta.
 *
 * 🔒 GATED ON `getBaseById` IN BOTH DIRECTIONS, and the symmetry is the
 * decision. `service-stars.ts › unstarBase` is deliberately UNgated because a
 * member must always be able to drop their OWN row; a pin is not the caller's
 * row, it is the workspace's, so an unpin is as much a write to shared state as
 * a pin. Refusing both the same way also keeps `pinned: false` from being an
 * existence probe: a base in another workspace, one the private/teams gate
 * hides, and one outside a locked agent's audience ceiling are ONE answer
 * (404, `KnowledgeBaseNotFoundError`).
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
 * 🔒 IT CHASES THE ENTRY UP TO ITS BASE, and it does so by COMPOSING
 * `service-entries.ts › getEntry` rather than restating that walk. That
 * function already answers `getBaseById`'s two gates as a 404 about the ENTRY
 * (fixed 2026-08-26 — the hole where any workspace viewer could read an entry
 * inside a private base), and composing it means a gate added to the
 * foundational lookup reaches this write for free. ⚠ A gate one caller has to
 * remember is not a gate: that is the lesson `service-bases.ts`'s docblock
 * records, and re-deriving the walk here is exactly how it was learned.
 */
export async function pinEntry(
  ctx: KnowledgeContext,
  entryId: string,
  pinned: boolean
): Promise<void> {
  const entry = await getEntry(ctx, entryId);
  await repo.setEntryPinned(ctx.workspaceId, entry.id, pinned);
}
