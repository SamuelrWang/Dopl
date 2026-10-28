import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { DeviceEventRow, Environment } from "../types";
import {
  LOG_WINDOW_MS,
  logCursor,
  parseLogCursor,
  type LogFilters,
  type PortalProject,
  type PortalRole,
} from "../portal/scope";
import type { DevApiKeyRow } from "./keys";

/**
 * DEVELOPER PORTAL READS (W1.3, Plans/Dopl SDK Split › §6, §9). Service role, server only.
 *
 * Every `dev_*` table is service-role only (A1: RLS on, no policy, no grant to `authenticated`),
 * so the portal's pages read here and nowhere else. ⚠ THE CALLER'S REACH IS DECIDED HERE, NOT BY
 * RLS: `listPortalProjects` is the one place a user id becomes project ids, and every other read
 * takes those ids (or a single id the caller already checked against them) and filters on them.
 *
 * ⚠ BILLING / USAGE READS GO THROUGH `dev_billable_events` ONLY (W0.2): it is `dev_events` minus
 * internal orgs. LOG reads stay on `dev_events`, because a developer sees every call they made.
 */

const ROLES: readonly PortalRole[] = ["owner", "admin", "developer"];
const RANK: Record<PortalRole, number> = { owner: 3, admin: 2, developer: 1 };

const KEY_COLUMNS =
  "id, project_id, env, kind, prefix, scopes, created_at, last_used_at, revoked_at, expires_at";

/** Log page size. One more row is fetched to know whether an older page exists. */
export const LOG_PAGE_SIZE = 50;

/** The projects `userId` can see: orgs they own, plus orgs they are a member of. */
export async function listPortalProjects(userId: string): Promise<PortalProject[]> {
  const db = supabaseAdmin();
  const [owned, memberships] = await Promise.all([
    db.from("dev_orgs").select("id").eq("owner_user_id", userId),
    db.from("dev_org_members").select("org_id, role").eq("user_id", userId),
  ]);
  if (owned.error) throw new Error(`listPortalProjects failed: ${owned.error.message}`);
  if (memberships.error) throw new Error(`listPortalProjects failed: ${memberships.error.message}`);

  const roleByOrg = new Map<string, PortalRole>();
  const grant = (orgId: string, role: PortalRole) => {
    const had = roleByOrg.get(orgId);
    if (!had || RANK[role] > RANK[had]) roleByOrg.set(orgId, role);
  };
  for (const o of (owned.data ?? []) as Array<{ id: string }>) grant(o.id, "owner");
  for (const m of (memberships.data ?? []) as Array<{ org_id: string; role: string }>) {
    if ((ROLES as readonly string[]).includes(m.role)) grant(m.org_id, m.role as PortalRole);
  }
  const orgIds = [...roleByOrg.keys()];
  if (orgIds.length === 0) return [];

  const [orgs, projects] = await Promise.all([
    db.from("dev_orgs").select("id, name, internal").in("id", orgIds),
    db
      .from("dev_projects")
      .select("id, org_id, name, api_version, created_at")
      .in("org_id", orgIds)
      .order("created_at", { ascending: true }),
  ]);
  if (orgs.error) throw new Error(`listPortalProjects failed: ${orgs.error.message}`);
  if (projects.error) throw new Error(`listPortalProjects failed: ${projects.error.message}`);

  const orgById = new Map(
    ((orgs.data ?? []) as Array<{ id: string; name: string; internal: boolean | null }>).map((o) => [o.id, o])
  );
  const out: PortalProject[] = [];
  for (const p of (projects.data ?? []) as Array<{ id: string; org_id: string; name: string; api_version: string }>) {
    const org = orgById.get(p.org_id);
    const role = roleByOrg.get(p.org_id);
    if (!org || !role) continue;
    out.push({
      id: p.id,
      name: p.name,
      apiVersion: p.api_version,
      org: { id: org.id, name: org.name, internal: org.internal === true },
      role,
    });
  }
  // Customer orgs first, then internal ones; by org name, then project creation order.
  return out
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        Number(a.p.org.internal) - Number(b.p.org.internal) ||
        a.p.org.name.localeCompare(b.p.org.name) ||
        a.i - b.i
    )
    .map((x) => x.p);
}

/** Keys of one project and env, newest first. Never `key_hash`. */
export async function listProjectKeys(projectId: string, env: Environment): Promise<DevApiKeyRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("dev_api_keys")
    .select(KEY_COLUMNS)
    .eq("project_id", projectId)
    .eq("env", env)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listProjectKeys failed: ${error.message}`);
  return (data ?? []) as DevApiKeyRow[];
}

/**
 * The key's project and lifecycle, for the rotate route's checks. `null` when no such key.
 * Rotatable = not revoked, never rotated (`expires_at` unset); `keys.ts › rotateApiKey` re-checks
 * atomically, this read only lets the route answer the common refusals cleanly.
 */
export async function getKeyProject(
  keyId: string
): Promise<{ projectId: string; revokedAt: string | null; expiresAt: string | null } | null> {
  const { data, error } = await supabaseAdmin()
    .from("dev_api_keys")
    .select("id, project_id, revoked_at, expires_at")
    .eq("id", keyId)
    .maybeSingle();
  if (error) throw new Error(`getKeyProject failed: ${error.message}`);
  const row = data as { project_id: string; revoked_at: string | null; expires_at: string | null } | null;
  return row ? { projectId: row.project_id, revokedAt: row.revoked_at, expiresAt: row.expires_at } : null;
}

export interface LogPage {
  rows: DeviceEventRow[];
  /** `logCursor` of the last row when an older page exists, else null. */
  nextBefore: string | null;
}

/** One page of `dev_events` over the given projects and env, newest first. */
export async function queryPortalEvents(input: {
  projectIds: readonly string[];
  env: Environment;
  filters: LogFilters;
  now?: Date;
}): Promise<LogPage> {
  if (input.projectIds.length === 0) return { rows: [], nextBefore: null };
  const f = input.filters;
  const now = input.now ?? new Date();
  let q = supabaseAdmin()
    .from("dev_events")
    .select("*")
    .in("project_id", [...input.projectIds])
    .eq("env", input.env)
    .gte("ts", new Date(now.getTime() - LOG_WINDOW_MS[f.window]).toISOString());
  if (f.outcome) q = q.eq("outcome", f.outcome);
  if (f.deviceKind) q = q.eq("device_kind", f.deviceKind);
  if (f.capability) q = q.eq("capability", f.capability);
  if (f.intent) q = q.eq("intent", f.intent);
  if (f.route) q = q.eq("route_decision->>target", f.route);
  // Compound keyset `(ts, event_id) < cursor`. Both parts were validated (ISO + UUID) by
  // `parseLogCursor`, so neither can carry PostgREST `or` syntax.
  const cursor = parseLogCursor(f.before);
  if (cursor) q = q.or(`ts.lt.${cursor.ts},and(ts.eq.${cursor.ts},event_id.lt.${cursor.eventId})`);
  const { data, error } = await q
    .order("ts", { ascending: false })
    .order("event_id", { ascending: false })
    .limit(LOG_PAGE_SIZE + 1);
  if (error) throw new Error(`queryPortalEvents failed: ${error.message}`);
  const all = (data ?? []) as DeviceEventRow[];
  const rows = all.slice(0, LOG_PAGE_SIZE);
  return { rows, nextBefore: all.length > LOG_PAGE_SIZE ? logCursor(rows[rows.length - 1]) : null };
}

/** One event, only if it belongs to one of `projectIds`. */
export async function getPortalEvent(eventId: string, projectIds: readonly string[]): Promise<DeviceEventRow | null> {
  if (projectIds.length === 0) return null;
  const { data, error } = await supabaseAdmin()
    .from("dev_events")
    .select("*")
    .eq("event_id", eventId)
    .in("project_id", [...projectIds])
    .maybeSingle();
  if (error) throw new Error(`getPortalEvent failed: ${error.message}`);
  return (data as DeviceEventRow | null) ?? null;
}

/**
 * Billable calls over the window: read from `dev_billable_events`, never `dev_events`, so an
 * internal org's traffic can never count as usage.
 */
export async function countBillableEvents(input: {
  projectIds: readonly string[];
  env: Environment;
  sinceIso: string;
}): Promise<number> {
  if (input.projectIds.length === 0) return 0;
  const { count, error } = await supabaseAdmin()
    .from("dev_billable_events")
    .select("event_id", { count: "exact", head: true })
    .in("project_id", [...input.projectIds])
    .eq("env", input.env)
    .gte("ts", input.sinceIso);
  if (error) throw new Error(`countBillableEvents failed: ${error.message}`);
  return count ?? 0;
}
