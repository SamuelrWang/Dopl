import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { canManageMembers, type PortalOrg } from "../portal/scope";
import type { InviteView, MemberView } from "../portal/view";
import { listOrgMembers } from "./portal-admin";
import { listOrgInvites } from "./portal-invites";

/** Team's read: members with their last visit, and the open invites a manager may see. */
export async function readTeam(userId: string, org: PortalOrg, now: Date): Promise<{ members: MemberView[]; invites: InviteView[] }> {
  const [people, invites] = await Promise.all([listOrgMembers(userId, org.id), canManageMembers(org.role) ? listOrgInvites(userId, org.id, now) : Promise.resolve([])]);
  return {
    members: people.map((p) => ({
      userId: p.userId,
      email: p.email,
      role: p.role,
      isOwner: p.isOwner,
      isYou: p.userId === userId,
      // The hourly touch runs beside this read, so it may not have written the reader yet.
      lastActiveAt: p.userId === userId ? now.toISOString() : p.lastActiveAt,
    })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expired: i.expired })),
  };
}

const TOUCH_EVERY_MS = 60 * 60 * 1000;
const touched = new Map<string, number>();

/** Best effort and at most hourly per instance: a visit must never fail or slow on this. */
export function touchMemberActivity(userId: string, orgId: string, now: Date): void {
  const key = `${orgId}:${userId}`;
  if (now.getTime() - (touched.get(key) ?? 0) < TOUCH_EVERY_MS) return;
  touched.set(key, now.getTime());
  void supabaseAdmin()
    .from("dev_org_members")
    .update({ last_active_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .then(({ error }) => {
      if (error) console.warn(`[device-sdk] member activity touch failed: ${error.message}`);
    });
}
