import "server-only";
import { randomUUID } from "crypto";
import { checkAndRecordRateLimitSubject } from "@/shared/auth/mcp-session";
import { PLAYGROUND_CLIENT_ID } from "@/shared/auth/mcp-credential";
import { issuePlaygroundToken } from "./token";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  createWorkspaceForUser,
  listMyWorkspacesWithRole,
  deleteWorkspaceForUser,
} from "@/features/workspaces/server/service";

/**
 * Landing-page playground: an anonymous visitor gets a REAL, isolated
 * workspace (no account). One throwaway `auth.users` row (can never log in),
 * one normally-created + seeded workspace, one short-lived playground
 * `mcp_tokens` bearer. The token IS the session (agent MCP + viewer polling);
 * membership + RLS provide isolation.
 *
 * ⚠ Guests bill as free plan — the free credit allowance doubles as the abuse cap.
 */

/** Short on purpose; reaper deletes data after expiry + grace. */
const PLAYGROUND_TTL_S = 10 * 60;

/** Provisioning is the expensive call — user + workspace + seed + token. */
const CREATE_RPM = 2;

/** Reaper's second gate (with client id) — never delete an unmarked user. */
const GUEST_METADATA = { playground_guest: true } as const;

/** Synthetic, undeliverable — satisfies NOT NULL email; never sign-in-able. */
function guestEmail(): string {
  return `guest-${randomUUID()}@playground.usedopl.com`;
}

export interface PlaygroundSession {
  token: string;
  expiresAt: string;
  workspaceId: string;
}

export class PlaygroundRateLimited extends Error {
  constructor() {
    super("Rate limit exceeded. Try again shortly.");
    this.name = "PlaygroundRateLimited";
  }
}

/** `ip` (first `x-forwarded-for` hop) keys the rate limit; blank shares the
 *  "unknown" bucket — fails stricter. */
export async function createPlaygroundSession(
  ip: string,
): Promise<PlaygroundSession> {
  const within = await checkAndRecordRateLimitSubject(
    `playground:${ip || "unknown"}`,
    CREATE_RPM,
    "POST /api/playground/session",
  );
  if (!within) throw new PlaygroundRateLimited();

  const admin = supabaseAdmin();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: guestEmail(),
    email_confirm: true,
    user_metadata: { ...GUEST_METADATA },
  });
  if (error || !created?.user) {
    throw error ?? new Error("guest user creation returned no user");
  }
  const guestId = created.user.id;

  try {
    // Normal path on purpose: runs `seedNewWorkspace` (real starter corpus).
    const workspace = await createWorkspaceForUser(guestId, {
      name: "Playground",
      description: "Dopl playground demo workspace",
    });
    const { token, expiresAt } = await issuePlaygroundToken({
      userId: guestId,
      ttlSeconds: PLAYGROUND_TTL_S,
    });
    return { token, expiresAt, workspaceId: workspace.id };
  } catch (err) {
    // Roll back the half-provisioned guest (cascades workspace). Best-effort;
    // the reaper is the backstop.
    await admin.auth.admin.deleteUser(guestId).catch(() => undefined);
    throw err;
  }
}

/** Per-run cap; a backlog drains across runs. */
const REAP_SCAN_LIMIT = 200;

/** Grace after expiry so a just-lapsed demo isn't yanked mid-view. */
const REAP_GRACE_MS = 60 * 60 * 1000;

export interface ReapResult {
  scanned: number;
  deletedUsers: number;
  deletedWorkspaces: number;
}

/**
 * Delete expired-past-grace guest users + their workspaces. Storage, not
 * access — expired tokens are already refused.
 *
 * ⚠ DOUBLE GATE: playground client id on the token AND guest marker on the
 * user; failing the second is logged and skipped.
 */
export async function reapExpiredPlaygroundSessions(): Promise<ReapResult> {
  const admin = supabaseAdmin();
  const cutoff = new Date(Date.now() - REAP_GRACE_MS).toISOString();

  const { data: rows, error } = await admin
    .from("mcp_tokens")
    .select("user_id")
    .eq("client_id", PLAYGROUND_CLIENT_ID)
    .lt("access_expires_at", cutoff)
    .limit(REAP_SCAN_LIMIT);
  if (error) throw error;

  const result: ReapResult = {
    scanned: rows?.length ?? 0,
    deletedUsers: 0,
    deletedWorkspaces: 0,
  };
  const userIds = [...new Set((rows ?? []).map((r) => r.user_id as string))];

  for (const userId of userIds) {
    const { data: userRes } = await admin.auth.admin.getUserById(userId);
    const user = userRes?.user;
    // Already gone (previous run died mid-loop) — nothing to do.
    if (!user) continue;
    if (user.user_metadata?.playground_guest !== true) {
      console.error(
        `[playground-reaper] token row names user ${userId} but the user lacks the guest marker — skipping`,
      );
      continue;
    }

    // Owned workspaces first, via the role-checked path.
    const memberships = await listMyWorkspacesWithRole(userId);
    for (const m of memberships) {
      if (m.role !== "owner") continue;
      await deleteWorkspaceForUser(m.id, userId);
      result.deletedWorkspaces += 1;
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error(`[playground-reaper] deleteUser(${userId}) failed:`, delErr);
      continue;
    }
    result.deletedUsers += 1;
  }
  return result;
}
