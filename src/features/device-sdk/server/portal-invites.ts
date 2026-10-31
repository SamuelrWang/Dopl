import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { canAssignRole, canManageMembers, type AssignableRole } from "../portal/scope";
import { listPortalOrgs } from "./portal";
import { dbError, emailOf, memberRole, normalizeEmail, notFound, refuseInternal, requireOrg } from "./portal-admin";

/**
 * DEVELOPER ORG INVITES (P3, Plans/Dopl SDK Split › §6). Service role, server only.
 *
 * ⚠ AN INVITE IS EMAIL-BOUND AND STORED HASHED (`20261123210000_device_sdk_org_invites.sql`): the
 * raw token is returned once, to the inviter, and accepting needs the signed-in account's
 * CONFIRMED email to equal the invite's. ⚠ ACCEPT IS AN ATOMIC CLAIM: one invite, one membership.
 * Reach and role rules are `portal-admin.ts`'s (the W1.3 fence; roles only go down).
 */

/** Soft limit: count-then-insert, so concurrent invites can land a few over. */
const MAX_OPEN_INVITES_PER_ORG = 50;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 32 random bytes, base64url: 43 URL-safe characters. */
function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface OrgInviteView {
  id: string;
  email: string;
  role: AssignableRole;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

const INVITE_COLUMNS = "id, org_id, email, role, created_at, expires_at, accepted_at, accepted_by, revoked_at";

/** Open invites (not accepted, not revoked), newest first. Owner or admin. */
export async function listOrgInvites(userId: string, orgId: string, now: Date = new Date()): Promise<OrgInviteView[]> {
  const org = await requireOrg(userId, orgId);
  if (!canManageMembers(org.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can see invites");
  const { data, error } = await supabaseAdmin()
    .from("dev_org_invites")
    .select(INVITE_COLUMNS)
    .eq("org_id", org.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw dbError("listOrgInvites", error);
  return ((data ?? []) as Array<{ id: string; email: string; role: AssignableRole; created_at: string; expires_at: string }>).map(
    (r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      expired: Date.parse(r.expires_at) <= now.getTime(),
    })
  );
}

/**
 * Invite `email` into the org with `role`. Returns the raw token ONCE (the inviter copies the
 * link); only its hash is stored. An open, unexpired invite for the same email is refused; an
 * expired one is revoked first so the email can be invited again.
 */
export async function createInvite(
  userId: string,
  orgId: string,
  input: { email: unknown; role: unknown },
  now: Date = new Date()
): Promise<{ token: string; invite: OrgInviteView }> {
  const email = normalizeEmail(input.email);
  const org = await requireOrg(userId, orgId);
  if (!canManageMembers(org.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can invite");
  refuseInternal(org.internal);
  if (typeof input.role !== "string" || !canAssignRole(org.role, input.role)) {
    throw new HttpError(403, "FORBIDDEN", "You cannot grant that role");
  }
  const role = input.role;
  const db = supabaseAdmin();

  const open = await db
    .from("dev_org_invites")
    .select("id, email, expires_at")
    .eq("org_id", org.id)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (open.error) throw dbError("createInvite", open.error);
  const openRows = (open.data ?? []) as Array<{ id: string; email: string; expires_at: string }>;
  const same = openRows.find((r) => r.email === email);
  if (same && Date.parse(same.expires_at) > now.getTime()) {
    throw new HttpError(409, "INVITE_EXISTS", "This email already has an open invite. Revoke it to send a new one.");
  }
  if (same) {
    const { error } = await db
      .from("dev_org_invites")
      .update({ revoked_at: now.toISOString() })
      .eq("id", same.id)
      .is("accepted_at", null)
      .is("revoked_at", null);
    if (error) throw dbError("createInvite", error);
  }
  if (openRows.length - (same ? 1 : 0) >= MAX_OPEN_INVITES_PER_ORG) {
    throw new HttpError(409, "INVITE_LIMIT", `An org can have at most ${MAX_OPEN_INVITES_PER_ORG} open invites`);
  }

  const token = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  const { data, error } = await db
    .from("dev_org_invites")
    .insert({ org_id: org.id, email, role, token_hash: hashInviteToken(token), invited_by: userId, expires_at: expiresAt })
    .select(INVITE_COLUMNS)
    .single();
  if (error || !data) {
    // A concurrent invite for the same email won the one-open-invite index.
    if (error?.message.includes("dev_org_invites_one_open_per_email")) {
      throw new HttpError(409, "INVITE_EXISTS", "This email already has an open invite. Revoke it to send a new one.");
    }
    throw dbError("createInvite", error ?? { message: "no row" });
  }
  const r = data as { id: string; email: string; role: AssignableRole; created_at: string; expires_at: string };
  return {
    token,
    invite: { id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, expired: false },
  };
}

/** Revoke an open invite. Owner or admin of its org; anyone else gets 404. */
export async function revokeInvite(userId: string, inviteId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("dev_org_invites").select("id, org_id, accepted_at, revoked_at").eq("id", inviteId).maybeSingle();
  if (error) throw dbError("revokeInvite", error);
  const row = data as { org_id: string; accepted_at: string | null; revoked_at: string | null } | null;
  if (!row) throw notFound("Invite");
  const org = (await listPortalOrgs(userId)).find((o) => o.id === row.org_id);
  if (!org) throw notFound("Invite");
  if (!canManageMembers(org.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can revoke invites");
  if (row.accepted_at) throw new HttpError(409, "INVITE_ACCEPTED", "This invite was already accepted");
  if (row.revoked_at) return;
  const { error: upErr } = await db
    .from("dev_org_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (upErr) throw dbError("revokeInvite", upErr);
}

type InviteState = "open" | "expired" | "revoked" | "accepted";

interface InviteForToken {
  id: string;
  orgId: string;
  orgName: string;
  /** `dev_orgs.internal`: never joined through an invite (`portal-admin.ts › refuseInternal`). */
  orgInternal: boolean;
  email: string;
  role: AssignableRole;
  state: InviteState;
  acceptedBy: string | null;
}

/** The invite a raw token names, with its org's name, or null. The token is the secret. */
export async function getInviteForToken(token: string, now: Date = new Date()): Promise<InviteForToken | null> {
  if (!INVITE_TOKEN.test(token)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("dev_org_invites")
    .select(INVITE_COLUMNS)
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (error) throw dbError("getInviteForToken", error);
  const r = data as {
    id: string;
    org_id: string;
    email: string;
    role: AssignableRole;
    expires_at: string;
    accepted_at: string | null;
    accepted_by: string | null;
    revoked_at: string | null;
  } | null;
  if (!r) return null;
  const org = await db.from("dev_orgs").select("id, name, internal").eq("id", r.org_id).maybeSingle();
  if (org.error) throw dbError("getInviteForToken", org.error);
  if (!org.data) return null;
  const state: InviteState = r.accepted_at
    ? "accepted"
    : r.revoked_at
      ? "revoked"
      : Date.parse(r.expires_at) <= now.getTime()
        ? "expired"
        : "open";
  return {
    id: r.id,
    orgId: r.org_id,
    orgName: (org.data as { name: string }).name,
    orgInternal: (org.data as { internal?: boolean | null }).internal === true,
    email: r.email,
    role: r.role,
    state,
    acceptedBy: r.accepted_by,
  };
}

/**
 * Accept an invite as the signed-in user. Their CONFIRMED account email must equal the invite's.
 * The claim (`accepted_at`) is one conditional UPDATE, so an invite yields one membership; if the
 * membership write then fails, the claim is released. Joining never LOWERS a role the caller
 * already has (an admin who accepts a developer invite stays admin).
 */
export async function acceptInvite(userId: string, token: string, now: Date = new Date()): Promise<{ orgId: string }> {
  const invite = await getInviteForToken(token, now);
  if (!invite) throw notFound("Invite");
  if (invite.state === "accepted") {
    if (invite.acceptedBy === userId) return { orgId: invite.orgId };
    throw new HttpError(410, "INVITE_ACCEPTED", "This invite was already used");
  }
  if (invite.state === "revoked") throw new HttpError(410, "INVITE_REVOKED", "This invite was revoked");
  if (invite.state === "expired") throw new HttpError(410, "INVITE_EXPIRED", "This invite has expired");
  refuseInternal(invite.orgInternal);

  const me = await emailOf(userId, true);
  if (!me.email || !me.confirmed) {
    throw new HttpError(403, "EMAIL_UNCONFIRMED", "Confirm your account email before accepting an invite");
  }
  if (me.email.trim().toLowerCase() !== invite.email) {
    throw new HttpError(403, "INVITE_EMAIL_MISMATCH", "This invite is for a different email address");
  }

  const db = supabaseAdmin();
  const acceptedAt = now.toISOString();
  const claim = await db
    .from("dev_org_invites")
    .update({ accepted_at: acceptedAt, accepted_by: userId })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", acceptedAt)
    .select("id");
  if (claim.error) throw dbError("acceptInvite", claim.error);
  if (!Array.isArray(claim.data) || claim.data.length === 0) {
    throw new HttpError(410, "INVITE_ACCEPTED", "This invite was already used");
  }

  try {
    const org = await db.from("dev_orgs").select("owner_user_id").eq("id", invite.orgId).maybeSingle();
    if (org.error) throw dbError("acceptInvite", org.error);
    const isOwner = (org.data as { owner_user_id: string } | null)?.owner_user_id === userId;
    const had = isOwner ? "owner" : await memberRole(invite.orgId, userId);
    const keeps = had === "owner" || (had === "admin" && invite.role === "developer");
    if (!keeps) {
      const { error } = await db
        .from("dev_org_members")
        .upsert({ org_id: invite.orgId, user_id: userId, role: invite.role }, { onConflict: "org_id,user_id" });
      if (error) throw dbError("acceptInvite", error);
    }
  } catch (err) {
    // Release OUR claim so the invite can be retried; conditioned on our own values.
    const { error: relErr } = await db
      .from("dev_org_invites")
      .update({ accepted_at: null, accepted_by: null })
      .eq("id", invite.id)
      .eq("accepted_at", acceptedAt)
      .eq("accepted_by", userId);
    if (relErr) console.error(`[portal-admin] could not release invite claim ${invite.id}: ${relErr.message}`);
    throw err;
  }
  return { orgId: invite.orgId };
}
