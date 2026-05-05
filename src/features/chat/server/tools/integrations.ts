import "server-only";
import {
  getIntegrationStatus,
  listIntegrationObjects,
  readIntegrationObject,
} from "@/features/integrations/server/service";
import { ProviderSchema } from "@/features/integrations/schema";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import type { ToolResult } from "./types";

/**
 * Read-only chat tools for the user's connected third-party services.
 * Mirrors the MCP-side `list_integration_objects` /
 * `ingest_from_integration` surface, but stripped of the
 * entry-creation step — the chat agent doesn't ingest, it just reads
 * and synthesizes.
 *
 * Available providers come from `INTEGRATION_PROVIDERS`. Status checks
 * are implicit: each tool fetches the connection row first; if it's
 * not `connected`, we return a structured error the model handles
 * gracefully.
 */

export async function executeListIntegrationObjects(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const provider = ProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    return {
      result: JSON.stringify({
        error: "Unknown provider. Supported: notion, gmail, google_drive.",
      }),
    };
  }

  const query =
    typeof input.query === "string" && input.query.length > 0
      ? input.query
      : undefined;
  const cursor =
    typeof input.cursor === "string" && input.cursor.length > 0
      ? input.cursor
      : undefined;
  const limitInput = input.limit;
  const limit =
    typeof limitInput === "number" && limitInput >= 1 && limitInput <= 50
      ? limitInput
      : 10;

  try {
    const result = await listIntegrationObjects(
      { workspaceId, userId, provider: provider.data },
      { query, cursor, limit }
    );
    return {
      result: JSON.stringify({
        provider: provider.data,
        objects: result.objects,
        next_cursor: result.nextCursor,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "chat.tools.list_integration_objects",
      message: `list_integration_objects failed: ${message}`,
      fingerprintKeys: ["integrations_list_failed", provider.data],
      metadata: { provider: provider.data, error: message },
      userId,
    });
    return {
      result: JSON.stringify({
        error: message,
        hint: `Check the integration's status with the chat asking the user to connect ${provider.data} from /<workspace>/integrations.`,
      }),
    };
  }
}

export async function executeReadIntegrationObject(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const provider = ProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    return {
      result: JSON.stringify({
        error: "Unknown provider. Supported: notion, gmail, google_drive.",
      }),
    };
  }
  const objectId =
    typeof input.object_id === "string" ? input.object_id : null;
  if (!objectId) {
    return { result: JSON.stringify({ error: "object_id is required." }) };
  }

  try {
    const result = await readIntegrationObject(
      { workspaceId, userId, provider: provider.data },
      { objectId }
    );
    return {
      result: JSON.stringify({
        provider: result.provider,
        object_id: result.objectId,
        title: result.title,
        url: result.url,
        last_modified: result.lastModified,
        body: result.body,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "chat.tools.read_integration_object",
      message: `read_integration_object failed: ${message}`,
      fingerprintKeys: ["integrations_read_failed", provider.data],
      metadata: {
        provider: provider.data,
        object_id: objectId,
        error: message,
      },
      userId,
    });
    return { result: JSON.stringify({ error: message }) };
  }
}

export async function executeIntegrationStatus(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const provider = ProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    return {
      result: JSON.stringify({
        error: "Unknown provider. Supported: notion, gmail, google_drive.",
      }),
    };
  }
  const status = await getIntegrationStatus({
    workspaceId,
    userId,
    provider: provider.data,
  });
  return {
    result: JSON.stringify({ provider: provider.data, status: status.status }),
  };
}
