import "server-only";
import {
  readResourceById,
  type ContainerRead,
} from "@/shared/tenancy/read-resource";
import type {
  AgentIdentity,
  AgentIdentityContext,
  ResolvedAgentIdentity,
  IdentityShelf,
} from "../types";
import { AgentIdentityNotFoundError } from "./errors";
import * as repo from "./repository";
import { decorateWithKnowledgeBases } from "./service-knowledge-decoration";
import {
  canSeeIdentity,
  shareCtxForIdentities,
  withSharingSet,
} from "./service-shared";

/**
 * Agent-identity reads. Every door answers an invisible row with the same 404, never 403.
 */

/**
 * Every identity the caller may see, name-ordered; the client groups by `visibility`.
 * `opts.shelf` narrows in the query (absent = both shelves) and is orthogonal to `canSeeIdentity`.
 */
export async function listIdentities(
  ctx: AgentIdentityContext,
  opts: { shelf?: IdentityShelf } = {}
): Promise<AgentIdentity[]> {
  const all = await repo.listIdentitiesForWorkspace(ctx.workspaceId, opts.shelf);
  if (all.length === 0) return [];
  const share = await shareCtxForIdentities(ctx, all);
  const visible = all
    .filter((t) => canSeeIdentity(ctx, t, share))
    .map((t) => withSharingSet(ctx, t, share));
  return decorateByContainer(ctx, visible);
}

/**
 * Decorate each row against its own container: a list spans the calling container and the caller's
 * personal one, and junction rows are filed under the row's container.
 * The foreign container is the caller's personal one, which holds no team rows, so `role: null` is inert.
 */
async function decorateByContainer(
  ctx: AgentIdentityContext,
  rows: AgentIdentity[]
): Promise<AgentIdentity[]> {
  const groups = new Map<string, AgentIdentity[]>();
  for (const row of rows) {
    groups.set(row.workspaceId, [...(groups.get(row.workspaceId) ?? []), row]);
  }
  const byId = new Map<string, AgentIdentity>();
  for (const [workspaceId, group] of groups) {
    const here =
      workspaceId === ctx.workspaceId ? ctx : { ...ctx, workspaceId, role: null };
    for (const row of await decorateWithKnowledgeBases(here, group)) byId.set(row.id, row);
  }
  return rows.map((row) => byId.get(row.id) ?? row);
}

/**
 * Which of `identities` (already through `canSeeIdentity`) sit in the caller's personal container —
 * the route's `homeScopedIdentityIds` label. Twin of `knowledge/server/service-bases.ts ›
 * listHomeScopedBaseIds`; the pair must move together.
 */
export async function listHomeScopedIdentityIds(
  ctx: AgentIdentityContext,
  identities: AgentIdentity[]
): Promise<string[]> {
  if (identities.length === 0) return [];
  const visible = new Set(identities.map((t) => t.id));
  const scoped = await repo.listHomeScopedIdentityIds(ctx.workspaceId, [
    ...visible,
  ]);
  return scoped.filter((id) => visible.has(id));
}

/** The in-container read, keyed to `ctx.workspaceId`; a cross-container id is a 404 here. */
export async function getIdentityById(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity> {
  const identity = await loadVisibleIdentity(ctx, id);
  if (!identity) throw new AgentIdentityNotFoundError(id);
  return identity;
}

/**
 * The id-resolving read: the id names its container (a contradicting `workspace=` is ignored), then
 * the matrix runs again there with the caller's real role (`shared/tenancy/read-resource.ts`).
 */
export async function readIdentityById(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity> {
  return (await readIdentityInContext(ctx, id)).value;
}

/**
 * {@link readIdentityById} plus the container it landed in — team links, knowledge links and the row
 * update are all workspace-keyed, so a follower must compose against the returned ctx.
 */
export async function readIdentityInContext(
  ctx: AgentIdentityContext,
  id: string
): Promise<ContainerRead<AgentIdentityContext, AgentIdentity>> {
  const hit = await readResourceById(
    ctx,
    "agent_identity",
    id,
    loadVisibleIdentity
  );
  if (!hit) throw new AgentIdentityNotFoundError(id);
  return hit;
}

/**
 * The write gate (twin of `knowledge/server/service-bases.ts › getBaseForWrite`): it authorises
 * nothing — the caller still runs `assertMayWrite` and the fences against the returned ctx.
 */
export async function getIdentityForWrite(
  ctx: AgentIdentityContext,
  id: string
): Promise<ContainerRead<AgentIdentityContext, AgentIdentity>> {
  return readIdentityInContext(ctx, id);
}

/** One row in one named container through the matrix, undecorated; `null` = not visible. */
export async function loadVisibleIdentityRow(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity | null> {
  const identity = await repo.findIdentityById(ctx.workspaceId, id);
  if (!identity) return null;
  const share = await shareCtxForIdentities(ctx, [identity]);
  return canSeeIdentity(ctx, identity, share) ? withSharingSet(ctx, identity, share) : null;
}

/** {@link loadVisibleIdentityRow} plus the viewer-filtered knowledge decoration. */
async function loadVisibleIdentity(
  ctx: AgentIdentityContext,
  id: string
): Promise<AgentIdentity | null> {
  const row = await loadVisibleIdentityRow(ctx, id);
  if (!row) return null;
  const [decorated] = await decorateWithKnowledgeBases(ctx, [row]);
  return decorated;
}

/**
 * The launch payload `GET …/resolve` returns: flattened, id-free, gated by the same matrix via
 * {@link readIdentityById}. Knowledge is viewer-filtered, so two callers may get different lists.
 * `authoredByCaller` is computed, never `createdBy` (the desktop picks its security header from it).
 */
export async function resolveIdentityForLaunch(
  ctx: AgentIdentityContext,
  id: string
): Promise<ResolvedAgentIdentity> {
  const identity = await readIdentityById(ctx, id);
  return {
    name: identity.name,
    instructions: identity.instructions,
    model: identity.model,
    runtime: identity.runtime ?? null,
    fields: identity.fields,
    knowledgeBases: identity.knowledgeBases,
    // Beside `knowledgeBases`, never instead: the desktop narrows this payload by allowlist.
    knowledge: identity.knowledge ?? [],
    // A count, never a location; `?? 0` because an undecorated row counted nothing.
    unreachableKnowledgeBaseCount: identity.unreachableKnowledgeBaseCount ?? 0,
    authoredByCaller:
      identity.createdBy !== null && identity.createdBy === ctx.userId,
  };
}
