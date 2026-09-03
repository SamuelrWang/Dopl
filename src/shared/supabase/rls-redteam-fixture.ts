import { supabaseAdmin } from "./admin";
import { callerScopedClient } from "./caller-client";
import type { CallerScope } from "./caller-scope";

/**
 * THE LIVE HALF OF A REDTEAM SUITE, ONCE — the tenants, the roles, the teams and
 * the grant rows every RLS redteam case needs, so a per-table suite states only
 * what is different about its table.
 *
 * ⚠ SKIPPED-WITH-REASON ON THE AUTHORING MACHINE, and the reason is a
 * MEASUREMENT about that machine rather than a claim about the tree: Docker is
 * down (`docker info` fails), so `supabase start` cannot run and nothing here
 * has ever executed there.
 *
 * ⚠ **BUT NO LONGER IN CI (2026-09-02).** `ci.yml`'s `rls-redteam` job starts
 * the stack on an ubuntu runner, runs `supabase db reset` — which is the
 * migration replay INVARIANTS §12 has been recording as owed — and runs the five
 * suites with `RLS_REDTEAM_LIVE=1`. Until that job had run once, **every
 * behavioural case in this wave was green having never executed a statement**,
 * which is F-523's distinction: the SQL scan proves a rule is WRITTEN once, and
 * only a database says what a policy admits. Any doc that calls a redteam claim
 * "proved" must name which half proved it.
 *
 * To run a suite, against a LOCAL stack only:
 *
 *   supabase start && supabase db reset            # applies every migration
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>  SUPABASE_SERVICE_ROLE_KEY=<service> \
 *   SUPABASE_JWT_SECRET=<jwt secret from `supabase status`> \
 *   RLS_REDTEAM_LIVE=1 npx vitest run src/features/skills/server/rls-redteam.test.ts
 *
 * ⚠ IT WRITES ROWS AND AUTH USERS. Local only — {@link liveRedteamEnabled}
 * refuses a non-loopback Supabase URL, because the fixture cannot tell a staging
 * project from a local one and the cost of guessing wrong is other people's
 * data.
 *
 * 🔒 ⚠ EVERY FIXTURE ROW IS WRITTEN AS THE SERVICE ROLE, ON PURPOSE. A fixture
 * shaped by the fence it is testing proves nothing: if the policy under test
 * refused the INSERT, the suite would pass by having no rows.
 */

/** Loopback only, and only when the operator asked. */
export const liveRedteamEnabled =
  process.env.RLS_REDTEAM_LIVE === "1" &&
  /(localhost|127\.0\.0\.1)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

/** A container id that is not any real container — the LOCK axis, which no
 *  policy may read as a membership substitute (`caller-scope.ts`). */
const FOREIGN_CONTAINER = "00000000-0000-4000-8000-000000000000";

/**
 * The two credential shapes a policy must tell apart.
 * ⚠ `shared` is the M-10 axis (`credential-audience.ts › isSharedCredential`);
 * `credentialWorkspaceId` is the CONTAINER LOCK and is carried on BOTH so a case
 * can prove the lock changes no row's visibility on its own.
 */
export function scopeFor(userId: string, shared = false): CallerScope {
  return {
    userId,
    sharedCredential: shared,
    credentialWorkspaceId: FOREIGN_CONTAINER,
  };
}

const admin = () => supabaseAdmin();

export async function makeUser(tag: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email: `rls-redteam-${tag}-${Date.now()}@example.test`,
    password: `redteam-${tag}-${Date.now()}`,
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
    .insert({ owner_id: ownerId, name: "RLS redteam", slug: `rls-redteam-${Date.now()}` })
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

/** ⚠ `guest` is a ROLE, not a separate table: the guest floor every policy
 *  relies on is `is_current_workspace_member(ws,'viewer')` failing by RANK
 *  (`20260825140000_guest_role.sql`: guest = -1, viewer = 0). */
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
    .insert({ workspace_id: workspaceId, name: `redteam-${Date.now()}` })
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
 * One `resource_grants` row. ⚠ `scopeType` IS A PARAMETER so a case can flip a
 * team grant to `'container'` and watch the row disappear: without the
 * `scope_type` term in `dopl_teams_mode_visible()`, a channel or container grant
 * on the same resource would answer a workspace-wide read (F-468).
 */
export async function grantToScope(args: {
  workspaceId: string;
  scopeType: "team" | "container" | "channel";
  scopeId: string;
  resourceType: "knowledge_base" | "skill" | "chat" | "agent_template";
  resourceId: string;
  createdBy: string;
}): Promise<void> {
  const { error } = await admin().from("resource_grants").insert({
    workspace_id: args.workspaceId,
    scope_type: args.scopeType,
    scope_id: args.scopeId,
    resource_type: args.resourceType,
    resource_id: args.resourceId,
    level: "read",
    created_by: args.createdBy,
  });
  if (error) throw error;
}

/** Ids of the rows `userId` can actually SELECT from `table` in `workspaceId`. */
export async function readableIds(
  userId: string,
  table: string,
  workspaceId: string,
  opts: { shared?: boolean } = {}
): Promise<string[]> {
  const { data, error } = await callerScopedClient(scopeFor(userId, opts.shared ?? false))
    .from(table)
    .select("id")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}
