import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { listMyWorkspaces } from "@/features/workspaces/server/service";
import {
  defaultComposioClient,
  type ComposioClient,
} from "./composio-client";
import {
  addGrants,
  deleteConnection,
  deleteStalePendingForProvider,
  findConnectionByBrokerId,
  findConnectionForWorkspace,
  listConnectionsForProvider,
  listConnectionsWithGrantsForUser,
  listGrants,
  setGrants,
  updateConnectionAccountInfo,
  updateConnectionStatus,
  upsertConnection,
  verifyConnectionOwnership,
} from "./repository";
import { IntegrationFetchError } from "./errors";
import { getProviderConfig, resolveAuthConfigId } from "./providers";
import type {
  ConnectInitiation,
  IntegrationProvider,
  IntegrationStatus,
  OAuthConnectionWithGrants,
} from "../types";

/**
 * The integrations service is the only thing routes call. It wraps:
 *   - the broker (Composio, hidden behind `ComposioClient`)
 *   - the `oauth_connections` + `oauth_connection_grants` tables (via
 *     `repository.ts`)
 *   - the existing ingest pipeline (for `prepare-from-integration`)
 *
 * Tests inject a fake `ComposioClient` and a Supabase admin built
 * against `supabase start`. Production uses the lazy defaults.
 *
 * Connections are USER-LEVEL: one OAuth handshake per (user,
 * provider, alias). Workspace access is gated by per-connection
 * grants. The agent in workspace X can only use a connection that's
 * been granted to X. By default, connecting auto-grants all workspaces
 * the user belongs to so the common case is "use everywhere"; users
 * tighten grants from /settings/integrations.
 */
export type IntegrationsServiceDeps = {
  db?: SupabaseClient;
  broker?: ComposioClient;
};

function brokerEntityId(userId: string): string {
  // User-level connections: the broker entity is the user, not the
  // (workspace, user) pair we used in the old model. This lets a single
  // broker connection fan out across every workspace via grants.
  return userId;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://www.usedopl.com"
  );
}

// ── Connect ──────────────────────────────────────────────────────────

/**
 * Kick off a fresh OAuth handshake for `provider`. Returns the broker
 * URL the popup should open directly. We pass `allowMultiple: true`
 * so a user can connect multiple accounts (e.g. two Gmails); each
 * connection is keyed by alias which we backfill at callback time
 * from the connected account's email.
 *
 * Persists a `needs_auth` row keyed by `(userId, provider, alias)`
 * with a placeholder alias derived from the broker connection id —
 * the OAuth callback rewrites alias once we know the email.
 */
export async function connectIntegration(
  ctx: { userId: string; provider: IntegrationProvider },
  deps: IntegrationsServiceDeps = {}
): Promise<ConnectInitiation> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const authConfigId = resolveAuthConfigId(ctx.provider);
  const entityId = brokerEntityId(ctx.userId);
  const callbackUrl = `${appBaseUrl()}/api/integrations/${ctx.provider}/callback`;

  // Cleanup orphaned `pending:%` rows from prior abandoned attempts so
  // we don't keep accumulating placeholder rows on every retry. Real
  // connections (alias = email) are untouched.
  await deleteStalePendingForProvider(db, {
    userId: ctx.userId,
    provider: ctx.provider,
  });

  const init = await broker.initiateConnection({
    entityId,
    authConfigId,
    callbackUrl,
    allowMultiple: true,
  });

  // Placeholder alias — guaranteed unique against the (user, provider)
  // pair via the broker connection id, which we already know is
  // unique per Composio. Rewritten to the account email at callback.
  const placeholderAlias = `pending:${init.brokerConnectionId}`;

  const row = await upsertConnection(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    alias: placeholderAlias,
    brokerConnectionId: init.brokerConnectionId,
    status: init.status,
  });

  if (init.status === "connected") {
    // Rare path: broker pre-authorized (e.g. token already cached).
    // Still derive alias from account info + auto-grant.
    await finalizeConnectionRow(
      db,
      broker,
      row.id,
      init.brokerConnectionId,
      ctx.userId,
      ctx.provider
    );
    return { status: "connected", connectionId: row.id };
  }

  return {
    status: "needs_auth",
    authUrl: init.authUrl,
    connectionId: row.id,
  };
}

/**
 * Called from the OAuth callback once the broker confirms the
 * provider's redirect succeeded. Pulls the live broker status +
 * account metadata, rewrites the placeholder alias to the real
 * account email, and auto-grants every workspace the user currently
 * belongs to so the connection works "everywhere" by default.
 */
export async function finalizeConnectionCallback(
  args: { brokerConnectionId: string },
  deps: IntegrationsServiceDeps = {}
): Promise<{ provider: IntegrationProvider; status: IntegrationStatus }> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const found = await findConnectionByBrokerId(db, args.brokerConnectionId);
  if (!found) {
    throw new IntegrationFetchError(
      "notion",
      `Unknown broker connection id ${args.brokerConnectionId}`
    );
  }

  const status = await finalizeConnectionRow(
    db,
    broker,
    found.connection.id,
    args.brokerConnectionId,
    found.connection.userId,
    found.connection.provider
  );
  return { provider: found.connection.provider, status };
}

async function finalizeConnectionRow(
  db: SupabaseClient,
  broker: ComposioClient,
  connectionId: string,
  brokerConnectionId: string,
  userId: string,
  provider: IntegrationProvider
): Promise<IntegrationStatus> {
  const account = await broker.getConnectedAccount(brokerConnectionId);
  await updateConnectionStatus(db, { id: connectionId, status: account.status });

  // Account email / label resolution, in order of preference:
  //   1. Whatever the broker surfaced on the connectedAccount itself
  //      (rare — only if Composio's state.val happens to carry it).
  //   2. A per-provider profile action (`GMAIL_GET_PROFILE`,
  //      `GOOGLEDRIVE_GOOGLE_DRIVE_GET_ABOUT`, etc.) declared on the
  //      ProviderConfig — most reliable for Google + GitHub.
  //   3. Stable fallback derived from the broker connection id (e.g.
  //      `account:vch1dWNe`) — readable but ugly. Used as last resort
  //      so the alias unique constraint always has a non-empty value.
  const fallbackAlias = `account:${brokerConnectionId.slice(-8)}`;
  let derivedEmail: string | null = account.accountEmail;
  let derivedLabel: string | null = account.accountLabel;
  let derivedAvatarUrl: string | null = null;

  const cfg = getProviderConfig(provider);
  // Profile lookup runs whenever a slug is configured — not just when
  // email is missing — so the real avatar URL gets captured even for
  // providers that already surfaced an email at broker level.
  if (
    account.status === "connected" &&
    cfg.profileActionSlug &&
    cfg.parseProfileResponse
  ) {
    try {
      const { raw } = await broker.executeAction({
        brokerConnectionId,
        entityId: brokerEntityId(userId),
        provider,
        slug: cfg.profileActionSlug,
        arguments: cfg.buildProfileArgs?.() ?? {},
      });
      const parsed = cfg.parseProfileResponse(raw);
      derivedEmail = parsed.email ?? derivedEmail;
      derivedLabel = parsed.label ?? derivedLabel;
      derivedAvatarUrl = parsed.avatarUrl ?? derivedAvatarUrl;
    } catch (err) {
      // Profile lookup is best-effort — if Composio doesn't expose the
      // action under this toolkit, or the call rate-limits, we fall
      // through to the broker-id alias rather than blocking the whole
      // OAuth flow.
      console.warn(
        `[integrations] profile lookup failed for ${provider} via ${cfg.profileActionSlug}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  await updateConnectionAccountInfo(db, {
    id: connectionId,
    alias: derivedEmail ?? derivedLabel ?? fallbackAlias,
    accountEmail: derivedEmail,
    accountLabel: derivedLabel,
    accountAvatarUrl: derivedAvatarUrl,
  });

  if (account.status === "connected") {
    const workspaces = await listMyWorkspaces(userId);
    if (workspaces.length > 0) {
      await addGrants(db, {
        connectionId,
        workspaceIds: workspaces.map((w) => w.id),
      });
    }
  }

  return account.status;
}

// ── Status / List / Grants ───────────────────────────────────────────

/**
 * Returns the highest-quality status for this provider visible from
 * `workspaceId`. Considers only connections granted to the workspace.
 * "connected" beats "needs_auth" beats "error" beats "disconnected"
 * so multi-account setups report the best account's state.
 */
export async function getIntegrationStatus(
  ctx: {
    userId: string;
    provider: IntegrationProvider;
    workspaceId?: string;
  },
  deps: IntegrationsServiceDeps = {}
): Promise<{ status: IntegrationStatus | "disconnected" }> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  if (ctx.workspaceId) {
    const found = await findConnectionForWorkspace(db, {
      userId: ctx.userId,
      provider: ctx.provider,
      workspaceId: ctx.workspaceId,
    });
    if (!found) return { status: "disconnected" };
    if (found.connection.status === "connected") return { status: "connected" };
    try {
      const live = await broker.getConnectionStatus(found.brokerConnectionId);
      if (live.status !== found.connection.status) {
        await updateConnectionStatus(db, {
          id: found.connection.id,
          status: live.status,
        });
      }
      return { status: live.status };
    } catch {
      return { status: found.connection.status };
    }
  }

  // No workspace context — settings/integrations style. Pick the best
  // status across all this user's connections for the provider.
  const conns = await listConnectionsForProvider(db, {
    userId: ctx.userId,
    provider: ctx.provider,
  });
  if (conns.length === 0) return { status: "disconnected" };
  if (conns.some((c) => c.status === "connected")) return { status: "connected" };
  if (conns.some((c) => c.status === "needs_auth")) return { status: "needs_auth" };
  return { status: "error" };
}

/** Settings page: every connection the user owns + its workspace grants. */
export async function listIntegrationsForUser(
  ctx: { userId: string },
  deps: IntegrationsServiceDeps = {}
): Promise<OAuthConnectionWithGrants[]> {
  const db = deps.db ?? supabaseAdmin();
  return listConnectionsWithGrantsForUser(db, ctx);
}

/** Replace a connection's grants list. Caller must own the connection. */
export async function updateConnectionGrants(
  args: { userId: string; connectionId: string; workspaceIds: string[] },
  deps: IntegrationsServiceDeps = {}
): Promise<{ grantedWorkspaceIds: string[] }> {
  const db = deps.db ?? supabaseAdmin();
  // Ownership check — we don't expose other users' connections to this
  // path. The repository helper does the (id, user_id) lookup; if the
  // caller doesn't own the row, the call no-ops with a clear error.
  const owns = await verifyConnectionOwnership(db, args.connectionId, args.userId);
  if (!owns) {
    throw new IntegrationFetchError("notion", "Connection not found");
  }
  await setGrants(db, {
    connectionId: args.connectionId,
    workspaceIds: args.workspaceIds,
  });
  return {
    grantedWorkspaceIds: await listGrants(db, args.connectionId),
  };
}

/** Disconnect (delete) one connection by id. Caller must own it. */
export async function disconnectIntegration(
  ctx: { userId: string; connectionId: string },
  deps: IntegrationsServiceDeps = {}
): Promise<void> {
  const db = deps.db ?? supabaseAdmin();
  const owns = await verifyConnectionOwnership(db, ctx.connectionId, ctx.userId);
  if (!owns) return;
  await deleteConnection(db, ctx.connectionId);
  // Note: broker-side connected-account cleanup is best-effort. We
  // don't currently call broker.deleteConnection because Composio's
  // multi-account mode tolerates orphaned accounts and the user can
  // re-initiate freely. Add it back here if Composio's quotas bite.
}

// Read-path methods (listIntegrationObjects, readIntegrationObject,
// prepareFromIntegration) live in `service-read.ts` to keep both
// files under the §2 file-size cap. Re-export them here so existing
// imports (`from "@/features/integrations/server/service"`) keep
// working — at the API boundary it's still one feature.
export {
  listIntegrationObjects,
  readIntegrationObject,
  prepareFromIntegration,
} from "./service-read";
