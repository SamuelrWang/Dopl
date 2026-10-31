import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { DeviceEventRow } from "../types";
import { ROLE_RANK, isPortalRole, type PortalOrg, type PortalProject, type PortalRole } from "../portal/scope";
import { must } from "./portal-http";

/**
 * DEVELOPER PORTAL READS. Service role, server only.
 *
 * Every `dev_*` table is service-role only (A1: RLS on, no policy, no grant to `authenticated`),
 * so the portal's pages read here and nowhere else. ⚠ THE CALLER'S REACH IS DECIDED HERE, NOT BY
 * RLS: `listPortalProjects` is the one place a user id becomes project ids, and every other read
 * takes those ids (or a single id the caller already checked against them) and filters on them.
 */

/**
 * The ONE place a user id becomes org reach: orgs they own (`owner_user_id`, read as `owner`) plus
 * orgs they are a member of (`dev_org_members.role`), keeping the strongest role. An unknown role
 * string grants nothing. `cache`: one read per server render; a route handler reads each time.
 */
async function resolveOrgRoles(userId: string): Promise<Map<string, PortalRole>> {
  const db = supabaseAdmin();
  const [owned, memberships] = await Promise.all([
    db.from("dev_orgs").select("id").eq("owner_user_id", userId),
    db.from("dev_org_members").select("org_id, role").eq("user_id", userId),
  ]);
  const roleByOrg = new Map<string, PortalRole>();
  const grant = (orgId: string, role: PortalRole) => {
    const had = roleByOrg.get(orgId);
    if (!had || ROLE_RANK[role] > ROLE_RANK[had]) roleByOrg.set(orgId, role);
  };
  for (const o of must(owned, "resolveOrgRoles") ?? []) grant((o as { id: string }).id, "owner");
  for (const m of (must(memberships, "resolveOrgRoles") ?? []) as Array<{ org_id: string; role: string }>) {
    if (isPortalRole(m.role)) grant(m.org_id, m.role);
  }
  return roleByOrg;
}

/** The orgs `userId` can see, with their role, even an org that has no project yet. Customer orgs first, then by name. */
export const listPortalOrgs = cache(async (userId: string): Promise<PortalOrg[]> => {
  const roleByOrg = await resolveOrgRoles(userId);
  if (roleByOrg.size === 0) return [];
  const res = await supabaseAdmin().from("dev_orgs").select("id, name, internal, owner_user_id").in("id", [...roleByOrg.keys()]);
  const out: PortalOrg[] = [];
  for (const o of (must(res, "listPortalOrgs") ?? []) as Array<{ id: string; name: string; internal: boolean | null; owner_user_id: string }>) {
    const role = roleByOrg.get(o.id);
    if (role) out.push({ id: o.id, name: o.name, internal: o.internal === true, ownerUserId: o.owner_user_id, role });
  }
  return out.sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name));
});

/** The projects `userId` can see, in their orgs' order, then creation order. */
export async function listPortalProjects(userId: string): Promise<PortalProject[]> {
  const orgs = await listPortalOrgs(userId);
  if (orgs.length === 0) return [];
  const res = await supabaseAdmin()
    .from("dev_projects")
    .select("id, org_id, name, api_version, created_at")
    .in("org_id", orgs.map((o) => o.id))
    .order("created_at", { ascending: true });
  const projects = (must(res, "listPortalProjects") ?? []) as Array<{ id: string; org_id: string; name: string; api_version: string }>;
  return orgs.flatMap((org) =>
    projects
      .filter((p) => p.org_id === org.id)
      .map((p) => ({ id: p.id, name: p.name, apiVersion: p.api_version, org: { id: org.id, name: org.name, internal: org.internal }, role: org.role }))
  );
}

/**
 * The key's project and lifecycle, for the rotate route's checks. `null` when no such key.
 * Rotatable = not revoked, never rotated (`expires_at` unset); `keys.ts › rotateApiKey` re-checks
 * atomically, this read only lets the route answer the common refusals cleanly.
 */
export async function getKeyProject(
  keyId: string
): Promise<{ projectId: string; revokedAt: string | null; expiresAt: string | null } | null> {
  const res = await supabaseAdmin().from("dev_api_keys").select("project_id, revoked_at, expires_at").eq("id", keyId).maybeSingle();
  const row = must(res, "getKeyProject") as { project_id: string; revoked_at: string | null; expires_at: string | null } | null;
  return row ? { projectId: row.project_id, revokedAt: row.revoked_at, expiresAt: row.expires_at } : null;
}

/** One event, only if it belongs to one of `projectIds`. */
export async function getPortalEvent(eventId: string, projectIds: readonly string[]): Promise<DeviceEventRow | null> {
  if (projectIds.length === 0) return null;
  const res = await supabaseAdmin().from("dev_events").select("*").eq("event_id", eventId).in("project_id", [...projectIds]).maybeSingle();
  return must(res, "getPortalEvent") as DeviceEventRow | null;
}
