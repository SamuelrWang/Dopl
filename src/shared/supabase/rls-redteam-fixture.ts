import { supabaseAdmin } from "./admin";
import { callerScopedClient } from "./caller-client";
import type { CallerScope } from "./caller-scope";
import { generatePublicId } from "@/shared/lib/id/public-id";

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
    // ⚠ These cases drive POLICIES, and no policy reads `source` — it is a
    // TS-side reach fence. `null` keeps the fixture on the human lane, which is
    // the one every red-team case means to impersonate.
    source: null,
  };
}

const admin = () => supabaseAdmin();

/**
 * A uniqueness suffix that survives PARALLELISM.
 *
 * ⚠ **`Date.now()` ALONE IS NOT UNIQUE HERE.** Vitest runs these five suites in
 * separate workers at the same time, and they all mint the same handful of tags
 * — "owner", "outsider" — so two files entering `beforeAll` within the same
 * millisecond asked GoTrue for the SAME email and got
 * `Database error creating new user` (a unique violation, reported as a generic
 * 500). Each suite passed alone and three of five failed together, which is
 * exactly how this reads in CI. The random half is what makes the key a key.
 */
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
    // ⚠ `public_id` IS NOT NULL AND HAS NO DEFAULT — the app mints it
    // (`workspaces/server/repository.ts` calls `generatePublicId()` at both
    // insert sites). Omitting it here made all five live redteam suites die in
    // this one shared line, which nobody had seen because THIS JOB HAD NEVER
    // RUN: the duplicate `20260901120000` version killed the replay before the
    // suites started.
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
 * A real `skills` row, because a grant needs one.
 *
 * ⚠ **`resource_grants.resource_id` HAS NO FOREIGN KEY, AND THAT IS NOT THE SAME
 * AS "THE RESOURCE NEED NOT EXIST".** `enforce_resource_grant()`
 * (`20260914120000`, shipped in this same wave) resolves the resource to find
 * its container and raises `resource_grants: skill <id> does not exist` when it
 * cannot. The resource-grants suite used to pass a TEAM id as a skill id on the
 * strength of the missing FK; it 23514'd on the first live run (2026-09-03).
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
 * One `resource_grants` row. ⚠ `scopeType` IS A PARAMETER so a case can flip a
 * team grant to `'container'` and watch the row disappear: without the
 * `scope_type` term in `dopl_teams_mode_visible()`, a channel or container grant
 * on the same resource would answer a workspace-wide read (F-468).
 */
export interface GrantRef {
  workspaceId: string;
  scopeType: "team" | "container" | "channel";
  scopeId: string;
  resourceType: "knowledge_base" | "skill" | "chat" | "agent_template";
  resourceId: string;
}

export async function grantToScope(
  args: GrantRef & {
    createdBy: string;
    /**
     * ⚠ **TWO VOCABULARIES, ONE COLUMN, AND THE CHECK KNOWS WHICH**
     * (`20260914120000`): `container`/`team` take `read | edit`, `channel` takes
     * `agent_only | visible`. The default is the team/container one because
     * that is what every case predating 2026-09-02 wanted; a CHANNEL case must
     * name its level, and naming the wrong one is a `23514` rather than a
     * silently mis-scoped row.
     */
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

/**
 * Take the grant back. ⚠ **THE REVOKE CASE IS HALF THE EVIDENCE** — a policy
 * that admits a granted row proves nothing about the grant unless removing the
 * row removes the reach, which is the difference between "the arm works" and
 * "the arm is `true`".
 */
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
  // ⚠ **NOT EVERY TABLE HAS AN `id`.** `resource_grants` is keyed by the
  // composite `(scope_type, scope_id, resource_type, resource_id)` — asking it
  // for `id` is a PostgREST 42703, not an empty read, and it took the three
  // grant-visibility cases down on this suite's first live run (2026-09-03).
  // The column is only ever counted, so any NOT NULL column of the row does.
  const column = opts.idColumn ?? "id";
  const { data, error } = await callerScopedClient(scopeFor(userId, opts.shared ?? false))
    .from(table)
    .select(column)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  // ⚠ `as unknown` first: a dynamic `.select(column)` widens PostgREST's row
  // type to `GenericStringError[]`, which does not overlap a plain record.
  return ((data ?? []) as unknown as Array<Record<string, string>>).map((r) => r[column]);
}
