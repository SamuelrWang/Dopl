import { supabaseAdmin } from "./admin";
import { callerScopedClient } from "./caller-client";
import type { CallerScope } from "./caller-scope";
import { generatePublicId } from "@/shared/lib/id/public-id";

/**
 * The live half of every RLS redteam suite: tenants, roles, teams and grant rows. It runs only with
 * `RLS_REDTEAM_LIVE=1` against a loopback stack (CI's `rls-redteam` job, after `supabase db reset`);
 * the SQL scan proves a rule is written, only this proves what Postgres admits (F-523).
 * Local run: `supabase start && supabase db reset`, then the four `NEXT_PUBLIC_SUPABASE_*` /
 * `SUPABASE_*` env vars from `supabase status` and `RLS_REDTEAM_LIVE=1 npx vitest run <suite>`.
 * ⚠ Every fixture row is written as the service role: a fixture shaped by the fence under test
 * would pass by having no rows.
 */

/** Loopback only: it writes rows and auth users, and cannot tell staging from local. */
export const liveRedteamEnabled =
  process.env.RLS_REDTEAM_LIVE === "1" &&
  /(localhost|127\.0\.0\.1)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

/** Not any real container: the lock axis, which no policy may read as membership (`caller-scope.ts`). */
const FOREIGN_CONTAINER = "00000000-0000-4000-8000-000000000000";

/**
 * The two credential shapes a policy must tell apart: `shared` is the M-10 axis
 * (`credential-audience.ts › isSharedCredential`); the container lock rides both, so a case can
 * prove the lock alone changes no row's visibility.
 */
export function scopeFor(userId: string, shared = false): CallerScope {
  return {
    userId,
    sharedCredential: shared,
    credentialWorkspaceId: FOREIGN_CONTAINER,
    // No policy reads `source` (a TS-side fence); `null` keeps the fixture on the human lane.
    source: null,
  };
}

const admin = () => supabaseAdmin();

/** Unique across parallel workers: suites mint the same tags in the same millisecond. */
const uniq = () =>
  `${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`;

export async function makeUser(tag: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email: `rls-redteam-${tag}-${uniq()}@example.test`,
    password: `redteam-${tag}-${uniq()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  return data.user.id;
}

export async function deleteUsers(ids: Array<string | null>): Promise<void> {
  for (const id of ids) if (id) await admin().auth.admin.deleteUser(id);
}

/** A workspace with its owner already an ACTIVE member. */
export async function makeWorkspace(ownerId: string): Promise<string> {
  const { data, error } = await admin()
    .from("workspaces")
    // `public_id` is NOT NULL with no default; the app mints it.
    .insert({
      owner_id: ownerId,
      name: "RLS redteam",
      slug: `rls-redteam-${uniq()}`,
      public_id: generatePublicId(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no workspace");
  const workspaceId = data.id as string;
  await addMember(workspaceId, ownerId, "owner");
  return workspaceId;
}

export async function deleteWorkspace(id: string | null): Promise<void> {
  if (id) await admin().from("workspaces").delete().eq("id", id);
}

/** `guest` is a role: the guest floor is `is_current_workspace_member(ws,'viewer')` failing by rank. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer" | "guest"
): Promise<void> {
  const { error } = await admin()
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role, status: "active" });
  if (error) throw error;
}

/** A team with `userId` in it. Returns the team id. */
export async function makeTeam(workspaceId: string, userId: string): Promise<string> {
  const { data, error } = await admin()
    .from("teams")
    .insert({ workspace_id: workspaceId, name: `redteam-${uniq()}` })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no team");
  const teamId = data.id as string;
  const member = await admin()
    .from("team_members")
    .insert({ workspace_id: workspaceId, team_id: teamId, user_id: userId });
  if (member.error) throw member.error;
  return teamId;
}

/**
 * A real `skills` row: `resource_grants.resource_id` has no FK, but `enforce_resource_grant()`
 * resolves the resource and raises when it does not exist.
 */
export async function makeSkill(workspaceId: string, createdBy: string): Promise<string> {
  const tag = uniq();
  const { data, error } = await admin()
    .from("skills")
    .insert({
      workspace_id: workspaceId,
      slug: `redteam-skill-${tag}`,
      name: "RLS redteam skill",
      description: "fixture",
      when_to_use: "fixture",
      connectors: [],
      status: "draft",
      last_edited_source: "user",
      public_id: `rtskill${tag}`.slice(0, 24),
      visibility: "private",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no skill");
  return data.id as string;
}

/**
 * One `resource_grants` row. `scopeType` is a parameter so a case can flip a team grant to
 * `'container'` and watch the row disappear (F-468).
 */
export interface GrantRef {
  workspaceId: string;
  scopeType: "team" | "container" | "channel";
  scopeId: string;
  resourceType: "knowledge_base" | "skill" | "chat" | "agent_identity";
  resourceId: string;
}

export async function grantToScope(
  args: GrantRef & {
    createdBy: string;
    /** `container`/`team` take `read | edit`, `channel` takes `agent_only | visible` (the CHECK enforces it). */
    level?: "read" | "edit" | "agent_only" | "visible";
  }
): Promise<void> {
  const { error } = await admin().from("resource_grants").insert({
    workspace_id: args.workspaceId,
    scope_type: args.scopeType,
    scope_id: args.scopeId,
    resource_type: args.resourceType,
    resource_id: args.resourceId,
    level: args.level ?? "read",
    created_by: args.createdBy,
  });
  if (error) throw error;
}

/** Take the grant back: a grant arm is only proved when revoking it removes the reach. */
export async function revokeFromScope(ref: GrantRef): Promise<void> {
  const { error } = await admin()
    .from("resource_grants")
    .delete()
    .match({
      workspace_id: ref.workspaceId,
      scope_type: ref.scopeType,
      scope_id: ref.scopeId,
      resource_type: ref.resourceType,
      resource_id: ref.resourceId,
    });
  if (error) throw error;
}

/** Ids of the rows `userId` can actually SELECT from `table` in `workspaceId`. */
export async function readableIds(
  userId: string,
  table: string,
  workspaceId: string,
  opts: { shared?: boolean; idColumn?: string } = {}
): Promise<string[]> {
  // Not every table has an `id` (`resource_grants` has a composite key); any NOT NULL column counts.
  const column = opts.idColumn ?? "id";
  const { data, error } = await callerScopedClient(scopeFor(userId, opts.shared ?? false))
    .from(table)
    .select(column)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  // A dynamic `.select(column)` types rows as `GenericStringError[]`, hence `as unknown` first.
  return ((data ?? []) as unknown as Array<Record<string, string>>).map((r) => r[column]);
}
