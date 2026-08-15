import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { canGrantRole } from "../member-policy";
import { assertCanAddMember } from "@/features/billing/server/entitlements";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { requireWorkspaceRole } from "./authz";
import { findMembership, findWorkspaceById } from "./repository";

/**
 * Shareable join links + admin-approved join requests. One standing link per
 * workspace; rotating the token kills previously shared copies. Anyone with the
 * link can request; an admin approves (picking a role) or declines. Requester
 * popups are driven by the two ack columns.
 */

export type JoinRequestStatus = "pending" | "approved" | "declined";

export interface JoinRequestNotice {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  workspacePublicId: string;
  status: JoinRequestStatus;
  /** Which popup this notice drives. */
  kind: "pending" | "resolved";
}

const REQUEST_COLS =
  "id, workspace_id, user_id, status, requested_at, resolved_at, pending_acknowledged_at, resolved_acknowledged_at";

/**
 * ⚠ Lowercase hex, NOT base64url: join links get retyped and pasted through
 * messaging apps that case-fold URLs, and a case-sensitive token then 404s.
 * Lookups normalize to lowercase for the same reason. 32 bytes = 64 hex chars.
 */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/* ----------------------------- link ------------------------------ */

/** Get the workspace's standing join link, creating it on first ask. Admin+. */
export async function getOrCreateJoinLink(
  workspaceId: string,
  callerId: string
): Promise<{ token: string }> {
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_join_links")
    .select("token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (data) return { token: (data as { token: string }).token };

  const token = generateToken();
  const { error: insertError } = await db.from("workspace_join_links").insert({
    workspace_id: workspaceId,
    token,
    created_by: callerId,
  });
  if (insertError) {
    // Concurrent first-ask: the other insert won; read it back.
    const { data: after } = await db
      .from("workspace_join_links")
      .select("token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (after) return { token: (after as { token: string }).token };
    throw insertError;
  }
  return { token };
}

/** Invalidate the current link and mint a fresh token. Admin+. */
export async function rotateJoinLink(
  workspaceId: string,
  callerId: string
): Promise<{ token: string }> {
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const token = generateToken();
  const db = supabaseAdmin();
  const { error } = await db.from("workspace_join_links").upsert(
    {
      workspace_id: workspaceId,
      token,
      rotated_at: new Date().toISOString(),
      created_by: callerId,
    },
    { onConflict: "workspace_id" }
  );
  if (error) throw error;
  return { token };
}

export interface JoinLinkInfo {
  workspaceId: string;
  workspaceName: string;
  inviterEmail: string | null;
  inviterName: string | null;
}

/** Public lookup for the /join/[token] landing page. Null if no such link. */
export async function getJoinLinkInfo(token: string): Promise<JoinLinkInfo | null> {
  if (!token) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_join_links")
    .select("workspace_id, created_by")
    .eq("token", normalizeToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { workspace_id: string; created_by: string | null };

  const workspace = await findWorkspaceById(row.workspace_id);
  if (!workspace) return null;

  let inviterEmail: string | null = null;
  let inviterName: string | null = null;
  if (row.created_by) {
    try {
      const { data: userRes } = await db.auth.admin.getUserById(row.created_by);
      inviterEmail = userRes?.user?.email ?? null;
      const meta = (userRes?.user?.user_metadata ?? {}) as {
        display_name?: string;
        full_name?: string;
        name?: string;
      };
      inviterName = meta.display_name ?? meta.full_name ?? meta.name ?? null;
    } catch {
      /* inviter context is cosmetic */
    }
  }
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    inviterEmail,
    inviterName,
  };
}

/* --------------------------- requests ----------------------------- */

export type RequestJoinResult =
  | { outcome: "already_member"; workspaceSlug: string; workspacePublicId: string }
  | { outcome: "requested" | "already_pending"; workspaceName: string };

/**
 * Create (or revive) a join request. Idempotent: an open pending request is
 * returned as-is; a declined/approved row resets to pending so the user can
 * re-request. Active members route straight to the workspace.
 */
export async function requestJoin(
  token: string,
  userId: string
): Promise<RequestJoinResult> {
  const info = await getJoinLinkInfo(token);
  if (!info) {
    throw new HttpError(404, "JOIN_LINK_NOT_FOUND", "This join link is no longer valid");
  }
  const db = supabaseAdmin();

  const membership = await findMembership(info.workspaceId, userId);
  if (membership && membership.status === "active") {
    const workspace = await findWorkspaceById(info.workspaceId);
    return {
      outcome: "already_member",
      workspaceSlug: workspace?.slug ?? "",
      workspacePublicId: workspace?.publicId ?? "",
    };
  }

  // ⚠ Solo is single-member — EVERY member-add path must gate. 402 up front
  // rather than parking a request no admin could approve. Already-active
  // members returned above, so this only fires for a genuine add.
  await assertCanAddMember(info.workspaceId);

  const { data: existing, error } = await db
    .from("workspace_join_requests")
    .select(REQUEST_COLS)
    .eq("workspace_id", info.workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  if (existing && (existing as { status: JoinRequestStatus }).status === "pending") {
    return { outcome: "already_pending", workspaceName: info.workspaceName };
  }

  const { error: upsertError } = await db.from("workspace_join_requests").upsert(
    {
      workspace_id: info.workspaceId,
      user_id: userId,
      status: "pending",
      requested_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      pending_acknowledged_at: null,
      resolved_acknowledged_at: null,
    },
    { onConflict: "workspace_id,user_id" }
  );
  if (upsertError) throw upsertError;
  return { outcome: "requested", workspaceName: info.workspaceName };
}

export interface PendingJoinRequestView {
  id: string;
  userId: string;
  requestedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Pending requests for the members-page approval queue. Admin+. */
export async function listPendingJoinRequests(
  workspaceId: string,
  callerId: string
): Promise<PendingJoinRequestView[]> {
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_join_requests")
    .select("id, user_id, requested_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; user_id: string; requested_at: string }>;
  // Concurrent: one serial GoTrue round trip per requester would take
  // seconds on a popular link's queue.
  return Promise.all(
    rows.slice(0, 100).map(async (r) => {
      let email: string | null = null;
      let displayName: string | null = null;
      let avatarUrl: string | null = null;
      try {
        const { data: userRes } = await db.auth.admin.getUserById(r.user_id);
        const u = userRes?.user;
        const meta = (u?.user_metadata ?? {}) as {
          display_name?: string;
          full_name?: string;
          name?: string;
          avatar_url?: string;
        };
        email = u?.email ?? null;
        displayName = meta.display_name ?? meta.full_name ?? meta.name ?? null;
        avatarUrl = meta.avatar_url ?? null;
      } catch {
        /* hydration is best-effort */
      }
      return {
        id: r.id,
        userId: r.user_id,
        requestedAt: r.requested_at,
        email,
        displayName,
        avatarUrl,
      };
    })
  );
}

/**
 * Approve (with a role) or decline a pending request. Admin+. Approval upserts
 * the membership as active; the outcome popup is driven by
 * `resolved_acknowledged_at` staying null.
 */
export async function resolveJoinRequest(
  workspaceId: string,
  callerId: string,
  requestId: string,
  action: { kind: "approve"; role: "admin" | "member" | "viewer" } | { kind: "decline" }
): Promise<void> {
  const callerRole = await requireWorkspaceRole(workspaceId, callerId, "admin");
  // ⚠ Same policy as updateMemberRole (member-policy.ts): only the owner mints
  // admins, else an admin could elevate an accomplice here.
  if (action.kind === "approve" && !canGrantRole(callerRole, action.role)) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Only the owner can approve someone as admin"
    );
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_join_requests")
    .select(REQUEST_COLS)
    .eq("id", requestId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "JOIN_REQUEST_NOT_FOUND", "Join request not found");
  const row = data as { user_id: string; status: JoinRequestStatus };
  if (row.status !== "pending") return; // Idempotent — already resolved.

  if (action.kind === "approve") {
    // ⚠ Never clobber an existing ACTIVE membership — a stale pending request
    // can outlive an email invite or a later promotion.
    const existing = await findMembership(workspaceId, row.user_id);
    if (!existing || existing.status !== "active") {
      // ⚠ Re-check before the upsert: a request raised while free/team
      // survives a downgrade to Solo. The already-active short-circuit above
      // skips this — it adds no seat.
      await assertCanAddMember(workspaceId);

      const { error: memberError } = await db.from("workspace_members").upsert(
        {
          workspace_id: workspaceId,
          user_id: row.user_id,
          role: action.role,
          status: "active",
          invited_by: callerId,
          invited_at: new Date().toISOString(),
          joined_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id" }
      );
      if (memberError) throw memberError;

      // Reconcile Pro subscription quantity. Best-effort: a billing hiccup
      // must not fail the approval.
      await syncSeatQuantity(workspaceId).catch((err) => {
        console.error(
          `[join-links] syncSeatQuantity failed for workspace ${workspaceId}:`,
          err instanceof Error ? err.message : err
        );
      });
    }
  }

  const { error: updateError } = await db
    .from("workspace_join_requests")
    .update({
      status: action.kind === "approve" ? "approved" : "declined",
      resolved_at: new Date().toISOString(),
      resolved_by: callerId,
      resolved_acknowledged_at: null,
    })
    .eq("id", requestId);
  if (updateError) throw updateError;
}

/* --------------------------- my notices ---------------------------- */

/**
 * Caller's unacknowledged join-request notices, oldest first:
 *   - pending + pending_acknowledged_at null  -> "awaiting approval"
 *   - approved/declined + resolved_acknowledged_at null -> outcome popup
 */
export async function listMyJoinNotices(userId: string): Promise<JoinRequestNotice[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_join_requests")
    .select(
      `${REQUEST_COLS}, workspace:workspaces!inner(id, name, slug, public_id)`
    )
    .eq("user_id", userId)
    .order("requested_at", { ascending: true });
  if (error) throw error;

  type WsJoin = { id: string; name: string; slug: string; public_id: string };
  type Row = {
    id: string;
    status: JoinRequestStatus;
    pending_acknowledged_at: string | null;
    resolved_acknowledged_at: string | null;
    workspace: WsJoin | WsJoin[] | null;
  };

  const out: JoinRequestNotice[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const ws = Array.isArray(r.workspace) ? r.workspace[0] : r.workspace;
    if (!ws) continue;
    const base = {
      id: r.id,
      workspaceId: ws.id,
      workspaceName: ws.name,
      workspaceSlug: ws.slug,
      workspacePublicId: ws.public_id,
      status: r.status,
    };
    if (r.status === "pending" && r.pending_acknowledged_at === null) {
      out.push({ ...base, kind: "pending" });
    } else if (r.status !== "pending" && r.resolved_acknowledged_at === null) {
      out.push({ ...base, kind: "resolved" });
    }
  }
  return out;
}

/** Mark a notice as seen so its popup doesn't show again. */
export async function acknowledgeJoinNotice(
  userId: string,
  requestId: string,
  kind: "pending" | "resolved"
): Promise<void> {
  const db = supabaseAdmin();
  const column =
    kind === "pending" ? "pending_acknowledged_at" : "resolved_acknowledged_at";
  const { error } = await db
    .from("workspace_join_requests")
    .update({ [column]: new Date().toISOString() })
    .eq("id", requestId)
    .eq("user_id", userId);
  if (error) throw error;
}
