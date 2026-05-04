import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  buildAgentIngestBundle,
  AGENT_INGEST_INSTRUCTIONS,
} from "@/features/ingestion/server/agent-bundle";
import { fallbackSlugFromId } from "@/features/entries/server/slug";
import {
  defaultComposioClient,
  type ComposioClient,
} from "./composio-client";
import {
  findConnection,
  findConnectionWithBrokerId,
  upsertConnection,
  updateConnectionStatus,
  touchConnection,
  deleteConnection,
  listConnectionsForUser,
} from "./repository";
import {
  IntegrationNotConnectedError,
  IntegrationFetchError,
} from "./errors";
import { getProviderConfig, resolveAuthConfigId } from "./providers";
import { DEFAULT_LIST_LIMIT } from "../constants";
import type {
  ConnectInitiation,
  IntegrationListResult,
  IntegrationProvider,
  OAuthConnection,
  PrepareFromIntegrationResult,
} from "../types";

/**
 * The integrations service is the only thing routes call. It wraps:
 *   - the broker (Composio, hidden behind `ComposioClient`)
 *   - the `oauth_connections` table (via `repository.ts`)
 *   - the existing ingest pipeline (for `prepare-from-integration`)
 *
 * Tests inject a fake `ComposioClient` and a Supabase admin built
 * against `supabase start`. Production uses the lazy defaults.
 */
export type IntegrationsServiceDeps = {
  db?: SupabaseClient;
  broker?: ComposioClient;
};

function brokerEntityId(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://www.usedopl.com"
  );
}

/**
 * Status check + Dopl-hosted OAuth handoff URL. Doesn't talk to the
 * broker — that happens later, when the user actually opens the
 * returned URL and `startBrokerOAuth` runs server-side. Keeping the
 * broker initiation off this path means the agent doesn't burn a
 * broker request just to see whether auth is needed.
 *
 * Branding: the auth_url returned here is always a dopl.app URL, so
 * the agent never surfaces a broker domain to the user.
 */
export async function connectIntegration(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  deps: IntegrationsServiceDeps = {}
): Promise<ConnectInitiation> {
  const db = deps.db ?? supabaseAdmin();
  const existing = await findConnection(db, ctx);
  if (existing && existing.status === "connected") {
    return { status: "connected" };
  }
  return {
    status: "needs_auth",
    authUrl: `${appBaseUrl()}/connect/${ctx.provider}/start`,
  };
}

/**
 * Drives the actual OAuth handshake with the broker. Called from the
 * `/connect/[provider]/start` server component (which already holds
 * the user's session) — that page redirects to the broker URL we
 * return here, the broker bounces through the provider, and the
 * /api/integrations/[provider]/callback route catches the response.
 */
export async function startBrokerOAuth(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  deps: IntegrationsServiceDeps = {}
): Promise<{ status: "connected" } | { status: "needs_auth"; brokerAuthUrl: string }> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const existing = await findConnection(db, ctx);
  if (existing && existing.status === "connected") {
    return { status: "connected" };
  }

  const authConfigId = resolveAuthConfigId(ctx.provider);
  const entityId = brokerEntityId(ctx.workspaceId, ctx.userId);
  const callbackUrl = `${appBaseUrl()}/api/integrations/${ctx.provider}/callback?workspace_id=${encodeURIComponent(ctx.workspaceId)}&user_id=${encodeURIComponent(ctx.userId)}`;

  // Self-heal: purge any orphan broker accounts for this
  // (entity, authConfig) before initiating. Composio rejects fresh
  // initiates when more than one connected_account already exists for
  // the pair (the "Multiple connected accounts found … allowMultiple"
  // error). Orphans accumulate when a previous disconnect didn't
  // reach the broker, or when an OAuth handshake stalled mid-flow.
  // Cheap if there are zero — a single LIST call.
  await broker.purgeAccountsFor({ entityId, authConfigId });

  const init = await broker.initiateConnection({
    entityId,
    authConfigId,
    callbackUrl,
  });

  if (init.status === "connected") {
    await upsertConnection(db, {
      ...ctx,
      brokerConnectionId: init.brokerConnectionId,
      status: "connected",
    });
    return { status: "connected" };
  }

  await upsertConnection(db, {
    ...ctx,
    brokerConnectionId: init.brokerConnectionId,
    status: "needs_auth",
  });
  return { status: "needs_auth", brokerAuthUrl: init.authUrl };
}

export async function getIntegrationStatus(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  deps: IntegrationsServiceDeps = {}
): Promise<{ status: OAuthConnection["status"] | "disconnected" }> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const found = await findConnectionWithBrokerId(db, ctx);
  if (!found) return { status: "disconnected" };

  if (found.connection.status === "connected") {
    return { status: "connected" };
  }

  // We last saw it as needs_auth or error — re-poll the broker so the
  // agent gets accurate state without the user having to round-trip.
  let brokerStatus: { status: "connected" | "needs_auth" | "error" };
  try {
    brokerStatus = await broker.getConnectionStatus(found.brokerConnectionId);
  } catch {
    return { status: found.connection.status };
  }
  if (brokerStatus.status !== found.connection.status) {
    await updateConnectionStatus(db, {
      id: found.connection.id,
      status: brokerStatus.status,
    });
  }
  return { status: brokerStatus.status };
}

export async function listIntegrationObjects(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { query?: string; cursor?: string; limit?: number },
  deps: IntegrationsServiceDeps = {}
): Promise<IntegrationListResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const found = await findConnectionWithBrokerId(db, ctx);
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const result = await broker.listObjects({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.workspaceId, ctx.userId),
    provider: ctx.provider,
    listInput: {
      query: input.query,
      cursor: input.cursor,
      limit: input.limit ?? DEFAULT_LIST_LIMIT,
    },
  });

  await touchConnection(db, found.connection.id);
  return { objects: result.objects, nextCursor: result.nextCursor };
}

export async function prepareFromIntegration(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { objectId: string; kbId?: string; clusterId?: string },
  deps: IntegrationsServiceDeps = {}
): Promise<PrepareFromIntegrationResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const found = await findConnectionWithBrokerId(db, ctx);
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const cfg = getProviderConfig(ctx.provider);
  const fetched = await broker.fetchObject({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.workspaceId, ctx.userId),
    provider: ctx.provider,
    fetchInput: { objectId: input.objectId },
  });

  const sourceUrl = fetched.url ?? cfg.urlBuilder(input.objectId);
  const entryId = crypto.randomUUID();

  const { error: insertError } = await db.from("entries").insert({
    id: entryId,
    source_url: sourceUrl,
    source_platform: cfg.sourcePlatform,
    status: "processing",
    ingested_by: ctx.userId,
    slug: fallbackSlugFromId(entryId),
  });
  if (insertError) {
    throw new IntegrationFetchError(
      ctx.provider,
      `Failed to create entry: ${insertError.message}`
    );
  }

  const { error: sourceError } = await db.from("sources").insert({
    entry_id: entryId,
    url: sourceUrl,
    normalized_url: sourceUrl,
    source_type: cfg.sourceType,
    depth: 0,
    status: "ok",
    extracted_content: fetched.body,
    raw_content: fetched.body,
    content_metadata: {
      title: fetched.title,
      last_modified: fetched.lastModified,
      provider: ctx.provider,
      object_id: input.objectId,
    },
  });
  if (sourceError) {
    await db.from("entries").delete().eq("id", entryId);
    throw new IntegrationFetchError(
      ctx.provider,
      `Failed to persist source: ${sourceError.message}`
    );
  }

  await touchConnection(db, found.connection.id);

  const sourceIndex = [
    {
      url: sourceUrl,
      source_type: cfg.sourceType,
      depth: 0,
      chars: fetched.body.length,
    },
  ];
  const bundle = buildAgentIngestBundle({
    sources: sourceIndex,
    fetchWarnings: [],
  });

  return {
    status: "ready",
    entry_id: entryId,
    slug: fallbackSlugFromId(entryId),
    source_url: sourceUrl,
    source_platform: cfg.sourcePlatform,
    thumbnail_url: null,
    sources: bundle.sources,
    fetch_warnings: bundle.fetch_warnings,
    detected_links: [],
    images: [],
    prompts: bundle.prompts,
    instructions: AGENT_INGEST_INSTRUCTIONS,
  };
}

/**
 * Called from the OAuth callback route after the broker confirms the
 * provider's redirect succeeded. We trust the broker's notion of
 * connection state and flip our row to `connected`.
 */
export async function finalizeConnectionCallback(
  args: {
    workspaceId: string;
    userId: string;
    provider: IntegrationProvider;
  },
  deps: IntegrationsServiceDeps = {}
): Promise<void> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  // The broker connection id was persisted at `startBrokerOAuth` time;
  // re-poll the broker for the current status now that the user has
  // (presumably) completed the OAuth flow.
  const found = await findConnectionWithBrokerId(db, args);
  if (!found) {
    throw new IntegrationNotConnectedError(args.provider);
  }
  const status = await broker.getConnectionStatus(found.brokerConnectionId);
  await updateConnectionStatus(db, {
    id: found.connection.id,
    status: status.status,
  });
}

/**
 * List every integration connection the caller has in this workspace.
 * Powers the `/[workspaceSlug]/integrations` web page so users can
 * see/manage their connections without going through the agent.
 */
export async function listIntegrationsForUser(
  ctx: { workspaceId: string; userId: string },
  deps: IntegrationsServiceDeps = {}
): Promise<OAuthConnection[]> {
  const db = deps.db ?? supabaseAdmin();
  return listConnectionsForUser(db, ctx);
}

/**
 * Disconnect a provider for the caller. Deletes the broker-side
 * connected account first (so the next `initiateConnection` for the
 * same entity+auth-config isn't rejected by Composio's default
 * `allowMultiple=false`), then removes the local row. Best-effort on
 * the broker side — local deletion always proceeds.
 */
export async function disconnectIntegration(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  deps: IntegrationsServiceDeps = {}
): Promise<void> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();
  const found = await findConnectionWithBrokerId(db, ctx);
  if (!found) return;
  try {
    await broker.deleteConnection(found.brokerConnectionId);
  } catch {
    // Best-effort. If broker delete fails, we still purge our row —
    // the user shouldn't be stuck with a connection they can't shed.
    // Reconnect from scratch will surface a fresh error if the broker
    // really is wedged.
  }
  await deleteConnection(db, found.connection.id);
}
