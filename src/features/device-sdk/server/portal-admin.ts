import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { ApiKeyKind, Environment } from "../types";
import {
  canActOn,
  canAssignRole,
  canManageKeys,
  type PortalOrg,
  type PortalProject,
  type PortalRole,
} from "../portal/scope";
import { mintApiKey, revokeApiKey, type MintedKey } from "./keys";
import { getKeyProject, listPortalOrgs, listPortalProjects } from "./portal";

/**
 * DEVELOPER PORTAL SELF-SERVE WRITES (P3, Plans/Dopl SDK Split › §6, §9). Service role, server only.
 * Org + first project, more projects, members and invites, key create and revoke.
 *
 * ⚠ REACH IS THE W1.3 FENCE, NOT RLS: every write first resolves the caller's orgs/projects through
 * `portal.ts › listPortalOrgs` / `listPortalProjects` (the one place a user id becomes reach), and
 * a target the caller cannot see answers 404, the same as one that does not exist.
 * ⚠ ROLES ONLY GO DOWN: an actor grants only a role strictly below their own and acts only on a
 * member strictly below them (`portal/scope.ts › canAssignRole`, `canActOn`). The org's
 * `owner_user_id` is never removed and never re-roled.
 * Invites live in `portal-invites.ts`.
 */

export const MAX_OWNED_ORGS = 5;
export const MAX_PROJECTS_PER_ORG = 20;
/** Live (not revoked, not expired) keys per project and env. */
export const MAX_ACTIVE_KEYS = 10;

const NAME_MAX = 120;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

function cleanName(value: unknown, what: string): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (name.length < 1 || name.length > NAME_MAX) {
    throw new HttpError(400, "BAD_REQUEST", `${what} must be 1 to ${NAME_MAX} characters`);
  }
  return name;
}

export function normalizeEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 320 || !EMAIL.test(email)) throw new HttpError(400, "BAD_REQUEST", "Enter a valid email address");
  return email;
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);

/** The caller's org with their role, or 404. */
export async function requireOrg(userId: string, orgId: string): Promise<PortalOrg> {
  const org = (await listPortalOrgs(userId)).find((o) => o.id === orgId);
  if (!org) throw notFound("Org");
  return org;
}

/** The caller's project with their role, or 404. */
export async function requireProject(userId: string, projectId: string): Promise<PortalProject> {
  const project = (await listPortalProjects(userId)).find((p) => p.id === projectId);
  if (!project) throw notFound("Project");
  return project;
}

export function dbError(op: string, error: { message: string }): Error {
  return new Error(`${op} failed: ${error.message}`);
}

// ─── Orgs and projects ────────────────────────────────────────────────────────────────────────

/**
 * Signup's second step: a new org owned by the caller, with its first project, so the portal has
 * something to show. Not one transaction: if the project insert fails, the org is deleted again.
 */
export async function createOrgWithProject(
  userId: string,
  input: { orgName: unknown; projectName: unknown }
): Promise<{ orgId: string; projectId: string }> {
  const orgName = cleanName(input.orgName, "Org name");
  const projectName = cleanName(input.projectName, "Project name");
  const db = supabaseAdmin();

  const owned = await db.from("dev_orgs").select("id", { count: "exact", head: true }).eq("owner_user_id", userId);
  if (owned.error) throw dbError("createOrgWithProject", owned.error);
  if ((owned.count ?? 0) >= MAX_OWNED_ORGS) {
    throw new HttpError(409, "ORG_LIMIT", `An account can own at most ${MAX_OWNED_ORGS} orgs`);
  }

  const org = await db.from("dev_orgs").insert({ name: orgName, owner_user_id: userId }).select("id").single();
  if (org.error || !org.data) throw dbError("createOrgWithProject", org.error ?? { message: "no row" });
  const orgId = (org.data as { id: string }).id;

  const project = await db.from("dev_projects").insert({ org_id: orgId, name: projectName }).select("id").single();
  if (project.error || !project.data) {
    // Compensate: never leave an org the portal cannot open (no project to pick).
    const { error: undoErr } = await db.from("dev_orgs").delete().eq("id", orgId).eq("owner_user_id", userId);
    if (undoErr) console.error(`[portal-admin] could not remove half-created org ${orgId}: ${undoErr.message}`);
    throw dbError("createOrgWithProject", project.error ?? { message: "no row" });
  }
  return { orgId, projectId: (project.data as { id: string }).id };
}

/** Another project in an org. Owner or admin. */
export async function createProject(userId: string, orgId: string, input: { name: unknown }): Promise<{ projectId: string }> {
  const name = cleanName(input.name, "Project name");
  const org = await requireOrg(userId, orgId);
  if (!canManageKeys(org.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can create projects");
  const db = supabaseAdmin();
  const existing = await db.from("dev_projects").select("id", { count: "exact", head: true }).eq("org_id", org.id);
  if (existing.error) throw dbError("createProject", existing.error);
  if ((existing.count ?? 0) >= MAX_PROJECTS_PER_ORG) {
    throw new HttpError(409, "PROJECT_LIMIT", `An org can have at most ${MAX_PROJECTS_PER_ORG} projects`);
  }
  const { data, error } = await db.from("dev_projects").insert({ org_id: org.id, name }).select("id").single();
  if (error || !data) throw dbError("createProject", error ?? { message: "no row" });
  return { projectId: (data as { id: string }).id };
}

// ─── Members ──────────────────────────────────────────────────────────────────────────────────

export interface OrgMemberView {
  userId: string;
  email: string | null;
  role: PortalRole;
  /** The org's `owner_user_id`. */
  isOwner: boolean;
  joinedAt: string | null;
}

export async function emailOf(userId: string): Promise<{ email: string | null; confirmed: boolean }> {
  try {
    const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
    const user = data?.user as { email?: string | null; email_confirmed_at?: string | null } | null | undefined;
    return { email: user?.email ?? null, confirmed: Boolean(user?.email_confirmed_at) };
  } catch {
    return { email: null, confirmed: false };
  }
}

/** Everyone in the org: the owner first, then members by join time. Any role may read it. */
export async function listOrgMembers(userId: string, orgId: string): Promise<OrgMemberView[]> {
  const org = await requireOrg(userId, orgId);
  const { data, error } = await supabaseAdmin()
    .from("dev_org_members")
    .select("user_id, role, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });
  if (error) throw dbError("listOrgMembers", error);
  const members = ((data ?? []) as Array<{ user_id: string; role: string; created_at: string }>).filter(
    (m) => m.user_id !== org.ownerUserId && (m.role === "owner" || m.role === "admin" || m.role === "developer")
  );
  const people = [
    { userId: org.ownerUserId, role: "owner" as PortalRole, isOwner: true, joinedAt: null as string | null },
    ...members.map((m) => ({ userId: m.user_id, role: m.role as PortalRole, isOwner: false, joinedAt: m.created_at })),
  ];
  const emails = await Promise.all(people.map((p) => emailOf(p.userId)));
  return people.map((p, i) => ({ ...p, email: emails[i].email }));
}

export async function memberRole(orgId: string, targetUserId: string): Promise<PortalRole | null> {
  const { data, error } = await supabaseAdmin()
    .from("dev_org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) throw dbError("memberRole", error);
  const role = (data as { role: string } | null)?.role;
  return role === "owner" || role === "admin" || role === "developer" ? role : null;
}

/** Change a member's role. Only to a role below the actor's, only on a member below the actor. */
export async function changeMemberRole(
  userId: string,
  orgId: string,
  targetUserId: string,
  role: unknown
): Promise<void> {
  const org = await requireOrg(userId, orgId);
  if (targetUserId === org.ownerUserId) throw new HttpError(403, "FORBIDDEN", "The org owner's role cannot change");
  const current = await memberRole(org.id, targetUserId);
  if (!current) throw notFound("Member");
  if (!canActOn(org.role, current)) throw new HttpError(403, "FORBIDDEN", "You cannot change this member's role");
  if (typeof role !== "string" || !canAssignRole(org.role, role)) {
    throw new HttpError(403, "FORBIDDEN", "You cannot grant that role");
  }
  const { error } = await supabaseAdmin()
    .from("dev_org_members")
    .update({ role })
    .eq("org_id", org.id)
    .eq("user_id", targetUserId);
  if (error) throw dbError("changeMemberRole", error);
}

/** Remove a member, or leave the org yourself. The owner is never removed. */
export async function removeMember(userId: string, orgId: string, targetUserId: string): Promise<void> {
  const org = await requireOrg(userId, orgId);
  if (targetUserId === org.ownerUserId) throw new HttpError(403, "FORBIDDEN", "The org owner cannot be removed");
  const current = await memberRole(org.id, targetUserId);
  if (!current) throw notFound("Member");
  const leaving = targetUserId === userId;
  if (!leaving && !canActOn(org.role, current)) throw new HttpError(403, "FORBIDDEN", "You cannot remove this member");
  const { error } = await supabaseAdmin()
    .from("dev_org_members")
    .delete()
    .eq("org_id", org.id)
    .eq("user_id", targetUserId);
  if (error) throw dbError("removeMember", error);
}

// ─── Keys ─────────────────────────────────────────────────────────────────────────────────────

const ENVS: readonly Environment[] = ["test", "live"];
const KINDS: readonly ApiKeyKind[] = ["secret", "publishable"];

/**
 * Mint a key for a project the caller owns or admins. The raw key is returned ONCE. At most
 * `MAX_ACTIVE_KEYS` live keys per project and env.
 */
export async function createProjectKey(
  userId: string,
  projectId: string,
  input: { env: unknown; kind: unknown },
  now: Date = new Date()
): Promise<MintedKey> {
  if (!(ENVS as readonly unknown[]).includes(input.env)) throw new HttpError(400, "BAD_REQUEST", "env must be test or live");
  if (!(KINDS as readonly unknown[]).includes(input.kind)) {
    throw new HttpError(400, "BAD_REQUEST", "kind must be secret or publishable");
  }
  const env = input.env as Environment;
  const kind = input.kind as ApiKeyKind;
  const project = await requireProject(userId, projectId);
  if (!canManageKeys(project.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can create keys");

  const { data, error } = await supabaseAdmin()
    .from("dev_api_keys")
    .select("id, expires_at")
    .eq("project_id", project.id)
    .eq("env", env)
    .is("revoked_at", null);
  if (error) throw dbError("createProjectKey", error);
  const live = ((data ?? []) as Array<{ expires_at: string | null }>).filter(
    (k) => !k.expires_at || Date.parse(k.expires_at) > now.getTime()
  );
  if (live.length >= MAX_ACTIVE_KEYS) {
    throw new HttpError(409, "KEY_LIMIT", `A project can have at most ${MAX_ACTIVE_KEYS} active ${env} keys. Revoke one first.`);
  }
  return mintApiKey({ projectId: project.id, env, kind });
}

/** Revoke a key now. Owner or admin of its project; a key the caller cannot see is 404. */
export async function revokeProjectKey(userId: string, keyId: string): Promise<void> {
  const key = await getKeyProject(keyId);
  const project = key ? (await listPortalProjects(userId)).find((p) => p.id === key.projectId) : undefined;
  if (!key || !project) throw notFound("Key");
  if (!canManageKeys(project.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can revoke keys");
  if (key.revokedAt) throw new HttpError(409, "KEY_REVOKED", "This key is already revoked");
  const revoked = await revokeApiKey({ projectId: project.id, keyId });
  if (!revoked) throw new HttpError(409, "KEY_REVOKED", "This key is already revoked");
}
