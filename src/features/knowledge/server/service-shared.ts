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
 * Cross-cutting gates + helpers shared by the per-domain service modules.
 *
 * `./repository.ts` bypasses RLS via the service-role client, so every method
 * reaching a row MUST filter by `ctx.workspaceId` (or chase the row up to a base
 * and verify scope) or workspaces leak into each other.
 */

// ─── Context construction ───────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  Required — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
  sessionId?: string | null;
}

/**
 * `withWorkspaceAuth` (or MCP equivalent) result → `KnowledgeContext`. Source
 * derives from API-key presence: session = user, API key = agent. The key's
 * workspace lock is forwarded so the service can enforce M-10 visibility.
 *
 * `sessionId` is forwarded VERBATIM and is the one forgeable field here. It
 * exists for `service-audience.ts › narrowToSessionChannel`, which may only use
 * it to NARROW an already-fenced channel set — nothing may grant on it.
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
 * M-10 visibility. Public → always; private → owner-only; private via a SHARED
 * credential → NEVER. Used as row filter (`listBases`) AND 404 gate
 * (`getBaseById` / `getBaseBySlug` / `getBaseByPublicId`).
 *
 * Arm 2 asks `isSharedCredential`, not "is there a workspace lock?", and the
 * difference is F-336 (fixed 2026-08-27, Samuel's ruling): the lock decides
 * WHICH WORKSPACE, layer A decides WHICH BASE WITHIN IT, and this predicate
 * decides only whether a credential stands for a person.
 *
 * Nothing here widens the container — `getBaseById`/`getBaseBySlug`/`listBases`
 * still run `resolveAgentAudience` after it.
 *
 * Mirrored, not imported, in four places: `chats › canSeeChat`,
 * `skills › canSeeSkill`, `agent-identities › canSeeIdentity` and
 * `agent-identities › canSeeBaseRow`. Splitting them is how the rule drifts.
 *
 * Arm 4 is the grant (F-604, 2026-09-02) and sits BELOW the shared-credential
 * refusal on purpose: a grant may only ever WIDEN, and a SHARED credential
 * stands for nobody, so it has no membership of the granted scope to read the
 * grant through. The set comes from
 * `shared/tenancy/resource-grant-reach.ts › grantedResourceIds`, whose SQL twin
 * `dopl_grant_admits()` is the policy's matching arm.
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

/**
 * Rows whose answer arm 4 could still CHANGE — the negation of arms 1-3.
 *
 * A deliberate mirror of the arms above, pinned as one by
 * `shared/tenancy/grant-read-arm.test.ts`. It buys the thing that matters on a
 * list path: a workspace of public rows, or a caller's own shelf, asks the grant
 * table NOTHING.
 */
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

/**
 * The grant set for a row set — {@link grantedResourceIds} bound to this
 * feature's resource type and narrowed by {@link needsGrantArm}, so no caller
 * has to remember either which string it is or which rows can still move.
 */
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

/** Single-base read gate: M-10 rules + team scoping. Teams-mode base is 404
 *  for members outside every granted team; admins and creator always pass. */
export async function assertBaseVisible(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  // ONE base, so the grant read is done here rather than pushed onto every
  // caller: the list paths batch it, and making callers precompute would be four
  // more places to forget it.
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

/** Drops teams-mode bases the caller can't read. One batch query regardless
 *  of base count; workspace-mode bases pass through. */
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

/**
 * KB write gate for EVERY source, web sessions included. Team grants are the
 * source of truth: owner/admin/creator pass; teams-mode members need an `edit`
 * grant; workspace-mode uses the role default (member → edit, viewer → read).
 * updateBase does NOT route here for `agentWriteEnabled` flips — it throws
 * `AgentWriteDisabledError` itself.
 */
export async function assertBaseWritable(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  // `agent_write_enabled=false` = read-only to AGENTS only; source="user"
  // unaffected. Must be checked on the WRITE path, not just deletes (F-10b):
  // team-access alone let an agent with team "edit" overwrite a read-only base.
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

/**
 * F-10 delete gate. `agent_write_enabled = false` is READ-ONLY to agents, so
 * base/folder/entry deletes honor the toggle like content writes do.
 * Only `ctx.source === "agent"` gated; human deletes always pass. Reuses
 * `AgentWriteDisabledError` → 403 AGENT_WRITE_DISABLED for shape parity.
 */
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

/**
 * The ids travel with the refusal (2026-09-03, F-664): the message says no more
 * than it did, but the two tenancies and the subject ride the error for the
 * server log, because this throw is how a child row stranded on an old tenancy
 * first announces itself.
 */
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
