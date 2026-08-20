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
 * Landing-page playground sessions: an anonymous visitor gets a REAL, isolated
 * workspace their agent can read AND write, with no account and no sign-in.
 *
 * Shape: one throwaway `auth.users` row (a foreign-key placeholder the visitor
 * never sees — it can never log in), one workspace created through the normal
 * path (so `seedNewWorkspace` populates the starter corpus), one short-lived
 * `mcp_tokens` bearer under the reserved playground client. The token is the
 * session: it authenticates the agent at `/api/playground/mcp/<token>` and the
 * viewer page's REST polling alike. Isolation is the product's own —
 * membership + RLS scope everything to the guest's workspace.
 *
 * ⚠ Guests are billed as the free plan (no `workspace_billing` row), so MCP
 * credits meter them with no playground-specific carve-out — the free
 * allowance doubles as the abuse cap.
 */

/** Session lifetime. Short on purpose — a demo, not a workspace; the token
 *  dies at expiry (`validateAccessToken`) and the reaper deletes the data
 *  after expiry + grace. */
export const PLAYGROUND_TTL_S = 10 * 60;

/** Provisioning is the expensive call — user + workspace + seed + token. */
const CREATE_RPM = 2;

/** Marks the guest row so the reaper can refuse to delete anything else even
 *  if a token row is somehow mislabeled. Belt and braces with the client id. */
const GUEST_METADATA = { playground_guest: true } as const;

/** Synthetic, undeliverable, unique — satisfies the NOT NULL email without
 *  ever being an address anyone can sign in with (no password, no confirm
 *  flow ever sent). */
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

/**
 * Provision one guest session. `ip` keys the rate limit — the caller passes
 * the first `x-forwarded-for` hop; a blank one shares the "unknown" bucket,
 * which fails toward stricter, not looser.
 */
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
    // Normal creation path on purpose: it runs `seedNewWorkspace`, so the
    // demo workspace arrives populated with the real starter corpus.
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
    // Half-provisioned guests are invisible junk — take the user row (and via
    // cascade its workspace, if it got that far) back out. Best-effort: the
    // reaper's metadata sweep is the backstop.
    await admin.auth.admin.deleteUser(guestId).catch(() => undefined);
    throw err;
  }
}

/** Cap per reaper run so a backlog drains across runs instead of one
 *  unbounded pass. */
const REAP_SCAN_LIMIT = 200;

/** Grace after token expiry before deletion, so a session that just lapsed
 *  mid-demo isn't yanked while the visitor is still looking at the page. */
const REAP_GRACE_MS = 60 * 60 * 1000;

export interface ReapResult {
  scanned: number;
  deletedUsers: number;
  deletedWorkspaces: number;
}

/**
 * Delete guest users whose playground token expired past the grace window,
 * with their workspaces. Token rows go with the user (FK) or stay revoked —
 * either way `validateAccessToken` refuses them the moment they expire, so
 * the reaper is about storage, not access.
 *
 * ⚠ DOUBLE GATE on deletion: the token row must carry the playground client
 * id AND the user row must carry the guest metadata marker. A row failing the
 * second check is logged and skipped — never deleted on one signal alone.
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

    // Owned workspaces first, through the role-checked path — the guest owns
    // exactly the one workspace provisioning created, but walk the list.
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
