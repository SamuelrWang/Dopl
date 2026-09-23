import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import {
  grantedResourceIds,
  type GrantedResourceIds,
} from "@/shared/tenancy/resource-grant-reach";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Role } from "@/features/workspaces/types";
import {
  effectiveResourceAccess,
  listEffectiveAccess,
  requireEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import {
  AgentWriteDisabledError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
} from "./errors";
import * as repo from "./repository";

/**
 * Gates and helpers shared by the knowledge service modules. The repository bypasses RLS, so every
 * row read must filter by `ctx.workspaceId` (or chase the row up to a base and verify scope).
 */

// ─── Context construction ───────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** Whose reach the credential inherits; `null` = nobody. Required: no safe default (F-336). */
  credentialSubjectUserId: string | null;
  sessionId?: string | null;
}

/**
 * Auth result → `KnowledgeContext`; an agent token makes the source "agent".
 * `sessionId` is forgeable: it may only narrow an already-fenced channel set, never grant.
 */
export function buildKnowledgeContext(auth: AuthLike): KnowledgeContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    credentialSubjectUserId: auth.credentialSubjectUserId,
    sessionId: auth.sessionId ?? null,
  };
}

// ─── Visibility gates ───────────────────────────────────────────────

/**
 * Row filter and 404 gate: public → yes; shared credential → never private (F-336: it stands for no
 * person); else owner or grant. The grant arm sits below the shared-credential refusal (F-604) and is
 * `dopl_grant_admits()`'s twin. Mirrored in `canSeeChat`, `canSeeSkill`, `canSeeIdentity`, `canSeeBaseRow`.
 */
export function canSeeBase(
  ctx: KnowledgeContext,
  base: KnowledgeBase,
  granted: GrantedResourceIds
): boolean {
  if (base.visibility === "public") return true;
  if (isSharedCredential(ctx)) return false;
  return base.createdBy === ctx.userId || granted.has(base.id);
}

/** Rows the grant arm could still change, so public and own rows skip the grant read. */
export function needsGrantArm(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): boolean {
  return (
    base.visibility !== "public" &&
    !isSharedCredential(ctx) &&
    base.createdBy !== ctx.userId
  );
}

/** {@link grantedResourceIds} for this resource type, narrowed by {@link needsGrantArm}. */
export function baseGrantsFor(
  ctx: KnowledgeContext,
  bases: readonly KnowledgeBase[]
): Promise<GrantedResourceIds> {
  return grantedResourceIds(
    ctx.userId,
    "knowledge_base",
    bases.filter((b) => needsGrantArm(ctx, b)).map((b) => b.id)
  );
}

/** Single-base read gate; a teams-mode base is 404 outside every granted team. */
export async function assertBaseVisible(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  if (!canSeeBase(ctx, base, await baseGrantsFor(ctx, [base]))) {
    throw new KnowledgeBaseNotFoundError(base.id);
  }
  if (base.accessMode !== "teams") return;
  const level = await effectiveResourceAccess(
    ctx.userId,
    ctx.workspaceId,
    "knowledge_base",
    base.id,
    { role: ctx.role }
  );
  if (level === null) throw new KnowledgeBaseNotFoundError(base.id);
}

/** Drops teams-mode bases the caller can't read, in one batch query. */
export async function filterTeamVisibleBases(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<KnowledgeBase[]> {
  if (!bases.some((b) => b.accessMode === "teams")) return bases;
  const acc = await listEffectiveAccess(ctx.workspaceId, ctx.userId, {
    role: ctx.role,
  });
  if (!acc) return [];
  return bases.filter(
    (b) => resolveLevel(acc, "knowledge_base", b.id, b.accessMode) !== null
  );
}

// ─── Write enforcement ──────────────────────────────────────────────

/** KB write gate for every source; team grants / role defaults decide `edit`. */
export async function assertBaseWritable(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  // On writes too, not just deletes (F-10b): team "edit" must not let an agent write a read-only base.
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
  await requireEffectiveAccess(
    ctx.userId,
    ctx.workspaceId,
    "knowledge_base",
    base.id,
    "edit",
    { role: ctx.role }
  );
}

/** Deletes honor `agent_write_enabled=false` for agents like content writes do (F-10). */
export function assertAgentCanDelete(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): void {
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(
      base.id,
      "This knowledge base is read-only to agents (agent_write_enabled=false) — delete it from the Dopl web UI."
    );
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────

export async function listSlugs(workspaceId: string): Promise<string[]> {
  return repo.listBaseSlugsForWorkspace(workspaceId);
}

export function deriveSlug(input: string, taken: string[]): string {
  return slugify(input, "knowledge-base", taken);
}

/** The ids ride the error for the server log: how a child row stranded on an old tenancy surfaces (F-664). */
export function assertSameWorkspace(
  rowWorkspaceId: string,
  ctxWorkspaceId: string,
  description: string
): void {
  if (rowWorkspaceId !== ctxWorkspaceId) {
    throw new KnowledgeBaseMismatchError(
      `${description} belongs to a different workspace`,
      rowWorkspaceId,
      ctxWorkspaceId,
      description
    );
  }
}

export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}
