import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import {
  grantedResourceIds,
  NO_GRANTS,
  type GrantedResourceIds,
} from "@/shared/tenancy/resource-grant-reach";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type {
  AgentIdentity,
  AgentIdentityContext,
  IdentityField,
  IdentityKnowledgeBaseRef,
} from "../types";
import * as repo from "./repository";
import type { KnowledgeBaseAccessRow } from "./repository";

/**
 * Cross-cutting gates: context, the `canSeeIdentity` matrix and its batch precompute, the sharing-set
 * filter, and the mirrored knowledge access predicate the attach gate uses.
 */

// ─── Context ────────────────────────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** Whose reach the credential inherits; `null` = nobody. Required: no safe default (F-336). */
  credentialSubjectUserId: string | null;
}

export function buildAgentIdentityContext(
  auth: AuthLike
): AgentIdentityContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    credentialSubjectUserId: auth.credentialSubjectUserId,
  };
}

/** Postgres `text` cannot store U+0000; strip it from every written string. */
export function stripNullBytes<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? value.replace(/\u0000/g, "") : value) as T;
}

export function isWorkspaceAdmin(ctx: AgentIdentityContext): boolean {
  return ctx.role !== null && meetsMinRole(ctx.role, "admin");
}

// ─── Write normalizers ──────────────────────────────────────────────────

/** Empty / whitespace-only text becomes NULL — one "absent" spelling in the column. */
export function normalizeProse(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = stripNullBytes(value).trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeFieldsInput(
  fields: IdentityField[] | undefined
): IdentityField[] {
  if (!fields) return [];
  return fields.map((f) => ({
    key: stripNullBytes(f.key),
    value: stripNullBytes(f.value),
    ...(f.type ? { type: f.type } : {}),
  }));
}

// ─── Visibility ─────────────────────────────────────────────────────────

/** Precomputed sharing context for a row set — a fixed query count per request (cf. `SkillGrantCtx`). */
export interface IdentityShareCtx {
  /** Teams the caller belongs to. Fetched only when some row needs it. */
  myTeamIds: Set<string>;
  /** identityId → linked team ids. */
  byIdentity: Map<string, string[]>;
  /** Identity ids lent to a channel or container the caller is in (the grant arm, F-604). */
  grantedIds: GrantedResourceIds;
}

const EMPTY_SHARE_CTX: IdentityShareCtx = {
  myTeamIds: new Set(),
  byIdentity: new Map(),
  grantedIds: NO_GRANTS,
};

export async function shareCtxForIdentities(
  ctx: AgentIdentityContext,
  rows: AgentIdentity[]
): Promise<IdentityShareCtx> {
  const teamScoped = rows.filter((t) => t.visibility === "team");
  // The grant read runs even with no team-scoped row: a lent row is usually `private`.
  const grantedIds = await grantedResourceIds(
    ctx.userId,
    "agent_identity",
    rows.filter((t) => needsGrantArm(ctx, t)).map((t) => t.id)
  );
  if (teamScoped.length === 0) {
    return grantedIds === NO_GRANTS
      ? EMPTY_SHARE_CTX
      : { ...EMPTY_SHARE_CTX, grantedIds };
  }
  // Own rows need no membership lookup; a shared credential never gets one (F-336).
  const needsMembership = teamScoped.some((t) => t.createdBy !== ctx.userId);
  const [myTeams, links] = await Promise.all([
    needsMembership && !isSharedCredential(ctx)
      ? repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    repo.listTeamLinksForIdentities(
      ctx.workspaceId,
      teamScoped.map((t) => t.id)
    ),
  ]);
  const byIdentity = new Map<string, string[]>();
  for (const link of links) {
    byIdentity.set(link.identityId, [
      ...(byIdentity.get(link.identityId) ?? []),
      link.teamId,
    ]);
  }
  return { myTeamIds: new Set(myTeams), byIdentity, grantedIds };
}

/**
 * Rows whose answer the grant arm could still change (the negation of arms 1-3) — twin of
 * `knowledge/server/service-shared.ts › needsGrantArm`, pinned by `shared/tenancy/grant-read-arm.test.ts`.
 */
export function needsGrantArm(
  ctx: AgentIdentityContext,
  identity: AgentIdentity
): boolean {
  return (
    identity.visibility !== "workspace" &&
    !isSharedCredential(ctx) &&
    identity.createdBy !== ctx.userId
  );
}

/**
 * The visibility matrix. Arm order is load-bearing and must match SQL
 * `can_current_user_read_agent_identity` (INVARIANTS §5A):
 *   1. `workspace` → every member   2. shared credential → nothing more (M-10)   3. creator
 *   4. a grant into a scope the caller is in (F-604)   5. `private` → nobody else, admins included
 *   6. workspace admin (on `team`)   7. `team` + a shared team.
 */
export function canSeeIdentity(
  ctx: AgentIdentityContext,
  identity: AgentIdentity,
  share: IdentityShareCtx
): boolean {
  if (identity.visibility === "workspace") return true;
  if (isSharedCredential(ctx)) return false;
  if (identity.createdBy !== null && identity.createdBy === ctx.userId) {
    return true;
  }
  // Above the `private` refusal (a lent row is private), below the shared-credential one.
  if (share.grantedIds.has(identity.id)) return true;
  if (identity.visibility === "private") return false;
  if (isWorkspaceAdmin(ctx)) return true;
  const linked = share.byIdentity.get(identity.id) ?? [];
  return linked.some((teamId) => share.myTeamIds.has(teamId));
}

/** The team set is shown to the creator and admins only — org-chart facts otherwise (cf. `withGrantSet`). */
export function withSharingSet(
  ctx: AgentIdentityContext,
  identity: AgentIdentity,
  share: IdentityShareCtx
): AgentIdentity {
  if (identity.visibility !== "team") return { ...identity, teamIds: [] };
  const maySee =
    (identity.createdBy !== null && identity.createdBy === ctx.userId) ||
    isWorkspaceAdmin(ctx);
  if (!maySee) return { ...identity, teamIds: [] };
  return { ...identity, teamIds: share.byIdentity.get(identity.id) ?? [] };
}

// ─── Knowledge-base access (the attach gate's predicate) ────────────────

/**
 * Hand mirror of knowledge's `canSeeBase` (§1; SQL twin `dopl_knowledge_base_readable()`, F-278):
 *   public → any member · private → creator or a grant (never a shared credential) ·
 *   teams mode → creator, workspace admin, or a granted team.
 */
export function canSeeBaseRow(
  ctx: AgentIdentityContext,
  base: KnowledgeBaseAccessRow,
  grantedTeamsByBase: Map<string, string[]>,
  myTeamIds: Set<string>,
  granted: GrantedResourceIds
): boolean {
  const mine = base.createdBy !== null && base.createdBy === ctx.userId;
  if (base.visibility === "private") {
    if (isSharedCredential(ctx)) return false;
    if (mine) return true;
    if (!granted.has(base.id)) return false;
  }
  if (base.accessMode !== "teams") return true;
  if (mine) return true;
  if (isWorkspaceAdmin(ctx)) return true;
  if (isSharedCredential(ctx)) return false;
  const teams = grantedTeamsByBase.get(base.id) ?? [];
  return teams.some((teamId) => myTeamIds.has(teamId));
}

/** A visible base plus its two card facts; service-internal (the DTO's shape stays `{id, name}`). */
export interface VisibleKnowledgeBase extends IdentityKnowledgeBaseRef {
  slug: string;
  description: string | null;
}

/**
 * KB ids → the bases the caller can read. One predicate for the attach gate (a drop is a 404) and the
 * read path (a drop is omitted), so an attach never permits what a read hides. Fixed query count.
 */
export async function resolveVisibleKnowledgeBases(
  ctx: AgentIdentityContext,
  ids: string[]
): Promise<VisibleKnowledgeBase[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const bases = await repo.listKnowledgeBaseAccessRows(ctx.workspaceId, unique);
  if (bases.length === 0) return [];
  // Only a private base the caller did not create can still be admitted by a grant.
  const grantable = bases.filter(
    (b) =>
      b.visibility === "private" &&
      !isSharedCredential(ctx) &&
      b.createdBy !== ctx.userId
  );
  const grantableIds = new Set(grantable.map((b) => b.id));
  const teamScoped = bases.filter(
    (b) =>
      b.accessMode === "teams" &&
      (b.visibility !== "private" || grantableIds.has(b.id))
  );
  const needsTeams =
    teamScoped.length > 0 &&
    !isSharedCredential(ctx) &&
    !isWorkspaceAdmin(ctx) &&
    teamScoped.some((b) => b.createdBy !== ctx.userId);
  const [grants, myTeams, granted] = await Promise.all([
    needsTeams
      ? repo.listKnowledgeBaseTeamGrants(
          ctx.workspaceId,
          teamScoped.map((b) => b.id)
        )
      : Promise.resolve([]),
    needsTeams
      ? repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    grantedResourceIds(ctx.userId, "knowledge_base", [...grantableIds]),
  ]);
  const grantedTeamsByBase = new Map<string, string[]>();
  for (const g of grants) {
    grantedTeamsByBase.set(g.knowledgeBaseId, [
      ...(grantedTeamsByBase.get(g.knowledgeBaseId) ?? []),
      g.teamId,
    ]);
  }
  const myTeamIds = new Set(myTeams);
  return bases
    .filter((b) => canSeeBaseRow(ctx, b, grantedTeamsByBase, myTeamIds, granted))
    // The card fields are optional on the row; never let `undefined` reach the wire.
    .map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug ?? "",
      description: b.description ?? null,
    }));
}
