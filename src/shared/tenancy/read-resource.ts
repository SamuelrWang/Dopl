import "server-only";
import type { Role } from "@/features/workspaces/types";
import {
  resolveResource,
  type ResourceCaller,
  type ResourceType,
} from "./resolve-resource";

/**
 * 🔒 **FOLLOWING THE ADDRESS — the composition every id-resolving read is, and
 * the one place it is written** (B2, 2026-09-02).
 *
 * `resolve-resource.ts` answers WHERE an id lives. This answers what a read then
 * DOES about it: try the container the caller was authorised in, and only on a
 * miss ask the resolver and re-run **the caller's own read** in the container the
 * id named.
 *
 * ⚠ **IT EXISTS BECAUSE FOUR FEATURES WERE ABOUT TO WRITE THE SAME TWELVE
 * LINES.** A12 shipped them once, by hand, in
 * `agent-templates/server/service-reads.ts › readTemplateById`; B2 adds knowledge
 * bases, skills and chats. Four hand copies of a tenancy dance is precisely the
 * shape **F-278** is filed against (*"the copy is the one that will not
 * notice"*) — and the half a copy gets wrong is always the same half, the
 * `containerRole` on the re-based context.
 *
 * ── 🔒 WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 * ⚠ **IT IS NOT A FENCE AND IT READS NOTHING.** Both fences belong to somebody
 * else: the resolver's four clauses decide what may be NAMED, and `load` — the
 * feature's own visibility-checked read — decides what may be SEEN. This module
 * only refuses to invent a third answer between them.
 *
 * ⚠ **`load` MUST BE THE SAME READ IN BOTH CONTAINERS**, which is why it is one
 * callback and not two. A read that applied a narrower matrix on the "elsewhere"
 * lane would make the same row answer two ways depending on which door the
 * caller came through — the confusion this whole slice removes.
 *
 * ⚠ **READS ONLY. `workspace=` IS STILL THE KEY ON A WRITE** (INVARIANTS §T35):
 * a PATCH that followed an id across a tenancy boundary is a ruling nobody has
 * made, so every feature keeps its workspace-keyed gate for writes and composes
 * this for the read door alone.
 */

/**
 * What a re-based read needs of its caller: the fence's inputs, plus the
 * container it is currently reading in and the caller's role there.
 *
 * ⚠ STRUCTURAL ON PURPOSE — `AgentTemplateContext`, `KnowledgeContext`,
 * `SkillContext` and `ChatContext` all satisfy it already, with no import and no
 * shared base type. Four features sharing a mechanic must not become four
 * features sharing a context.
 */
export interface ContainerScopedCaller extends ResourceCaller {
  workspaceId: string;
  role: Role | null;
}

/**
 * A row, and **the context it was actually read in**.
 *
 * ⚠ **THE CONTEXT IS RETURNED BECAUSE THE READ IS RARELY ONE QUERY.** A skill
 * has a body and its references; a chat has its messages and its container's
 * retention window; a base has entries. Every one of those is workspace-keyed,
 * and a caller that composed them against the ORIGINAL context after following
 * an id would read the row from one container and its contents from another.
 */
export interface ContainerRead<Ctx, T> {
  ctx: Ctx;
  value: T;
}

/**
 * 🔒 **READ ONE ROW BY ID, WHEREVER THE CALLER MAY NAME IT.** `null` = the
 * single 404 every caller already throws: no such row, not visible to you, or
 * outside your reach — one answer, deliberately.
 *
 * ⚠ IT COSTS ONE EXTRA READ **ONLY ON A MISS IN THIS TENANCY**, plus the
 * resolver's two. A row that is where it was asked for is byte-identical to
 * before, and pays nothing.
 */
export async function readResourceById<Ctx extends ContainerScopedCaller, T>(
  ctx: Ctx,
  type: ResourceType,
  id: string,
  load: (ctx: Ctx, id: string) => Promise<T | null>
): Promise<ContainerRead<Ctx, T> | null> {
  const here = await load(ctx, id);
  if (here) return { ctx, value: here };
  const resolved = await resolveResource(ctx, type, id);
  // ⚠ Resolving back into the tenancy that just missed means the caller's own
  // matrix refused it — re-reading there would spend a query to say so again.
  if (!resolved || resolved.containerId === ctx.workspaceId) return null;
  const there: Ctx = {
    ...ctx,
    workspaceId: resolved.containerId,
    // ⚠ THE CALLER'S REAL ROLE IN THE CONTAINER THE ID NAMED, never a guess.
    // `null` here would silently drop the rows that role can see — a
    // team-scoped attachment, an admin's sharing set — on the id lane only.
    role: resolved.containerRole,
  };
  const value = await load(there, id);
  return value ? { ctx: there, value } : null;
}
