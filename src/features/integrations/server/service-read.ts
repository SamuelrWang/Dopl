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
  findConnectionForWorkspace,
  touchConnection,
} from "./repository";
import {
  IntegrationFetchError,
  IntegrationNotConnectedError,
  IntegrationReadNotSupportedError,
} from "./errors";
import { getProviderConfig } from "./providers";
import { DEFAULT_LIST_LIMIT } from "../constants";
import type {
  IntegrationListResult,
  IntegrationProvider,
  PrepareFromIntegrationResult,
  ReadIntegrationObjectResult,
} from "../types";

/**
 * Read paths for the integrations feature: list / fetch / ingest.
 * Pulled out of `service.ts` to keep both files under the §2
 * file-size cap and to mirror the `service-actions.ts` boundary
 * (lifecycle vs read vs action). Every entry point requires a
 * connection that's been granted to the active workspace —
 * `findConnectionForWorkspace` enforces that at the lookup level.
 */
export type ReadServiceDeps = {
  db?: SupabaseClient;
  broker?: ComposioClient;
};

function brokerEntityId(userId: string): string {
  return userId;
}

export async function listIntegrationObjects(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { query?: string; cursor?: string; limit?: number; alias?: string },
  deps: ReadServiceDeps = {}
): Promise<IntegrationListResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const cfg = getProviderConfig(ctx.provider);
  if (!cfg.listActionSlug) {
    throw new IntegrationReadNotSupportedError(ctx.provider);
  }

  const found = await findConnectionForWorkspace(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    workspaceId: ctx.workspaceId,
    alias: input.alias,
  });
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const result = await broker.listObjects({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.userId),
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

export async function readIntegrationObject(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { objectId: string; alias?: string },
  deps: ReadServiceDeps = {}
): Promise<ReadIntegrationObjectResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const cfg = getProviderConfig(ctx.provider);
  if (!cfg.fetchActionSlug) {
    throw new IntegrationReadNotSupportedError(ctx.provider);
  }

  const found = await findConnectionForWorkspace(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    workspaceId: ctx.workspaceId,
    alias: input.alias,
  });
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const fetched = await broker.fetchObject({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.userId),
    provider: ctx.provider,
    fetchInput: { objectId: input.objectId },
  });
  await touchConnection(db, found.connection.id);

  return {
    provider: ctx.provider,
    objectId: input.objectId,
    title: fetched.title,
    url: fetched.url ?? cfg.urlBuilder(input.objectId),
    lastModified: fetched.lastModified,
    body: fetched.body,
  };
}

export async function prepareFromIntegration(
  ctx: { workspaceId: string; userId: string; provider: IntegrationProvider },
  input: { objectId: string; kbId?: string; clusterId?: string; alias?: string },
  deps: ReadServiceDeps = {}
): Promise<PrepareFromIntegrationResult> {
  const db = deps.db ?? supabaseAdmin();
  const broker = deps.broker ?? defaultComposioClient();

  const cfg = getProviderConfig(ctx.provider);
  if (!cfg.fetchActionSlug) {
    throw new IntegrationReadNotSupportedError(ctx.provider);
  }

  const found = await findConnectionForWorkspace(db, {
    userId: ctx.userId,
    provider: ctx.provider,
    workspaceId: ctx.workspaceId,
    alias: input.alias,
  });
  if (!found || found.connection.status !== "connected") {
    throw new IntegrationNotConnectedError(ctx.provider);
  }

  const fetched = await broker.fetchObject({
    brokerConnectionId: found.brokerConnectionId,
    entityId: brokerEntityId(ctx.userId),
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
