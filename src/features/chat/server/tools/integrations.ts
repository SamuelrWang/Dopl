import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getIntegrationStatus,
  listIntegrationObjects,
  listIntegrationsForUser,
  readIntegrationObject,
} from "@/features/integrations/server/service";
import {
  executeIntegrationAction,
  listIntegrationActions,
} from "@/features/integrations/server/service-actions";
import { ProviderSchema } from "@/features/integrations/schema";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import type { ToolResult } from "./types";

// ── Tool definitions ───────────────────────────────────────────────
//
// Lives here (not in `index.ts`) so the chat-tool registry stays
// under the §2 file-size cap and integration-related schema lives in
// one place.

const INTEGRATION_PROVIDER_ENUM = [
  "notion",
  "gmail",
  "google_drive",
  "github",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "slack",
] as const;

export const INTEGRATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "integration_status",
    description:
      "Check whether a third-party service is connected for this workspace. Returns one of: connected, needs_auth, error, disconnected. Call this first when the user asks about external content; if `connected`, follow up with `list_integration_actions(provider)` to see EVERY action the agent can run for this provider — that's how you find both read-shaped (list_*, get_*, fetch_*) and write-shaped actions for any provider, including Calendar, Sheets, Slack, GitHub, Docs. If not connected, tell them to visit /settings/integrations to connect.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description:
            "Which third-party service to check. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
        },
      },
      required: ["provider"],
    },
  },
  {
    name: "list_integration_objects",
    description:
      "**Convenience tool — works on notion (pages), gmail (threads), google_drive (files) only.** Other providers (github, google_calendar, google_docs, google_sheets, slack) return INTEGRATION_READ_NOT_SUPPORTED. **DO NOT conclude those providers are 'write-only'** — they have plenty of read actions, just not through this convenience tool. To read from them, call `list_integration_actions(provider)` and look for action names like `list_events`, `get_spreadsheet`, `fetch_history`, `get_repository`, `get_document` — then run them via `execute_integration_action`. Returns `{ objects: [{ id, title, url, lastModified }], next_cursor }`.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: { type: "string", enum: INTEGRATION_PROVIDER_ENUM, description: "Which third-party service to search." },
        query: { type: "string", description: "Free-text query. Gmail uses Gmail search syntax; Notion is a title search." },
        cursor: { type: "string", description: "Pagination cursor from a previous response." },
        limit: { type: "number", description: "Max objects to return (default 10, max 50)." },
      },
      required: ["provider"],
    },
  },
  {
    name: "read_integration_object",
    description:
      "Fetch the full content of one object from a connected provider. **Read-shaped providers only**: notion (page → markdown), gmail (thread → all messages), google_drive (file → text). Other providers return INTEGRATION_READ_NOT_SUPPORTED. Use after `list_integration_objects` to drill into a result.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: { type: "string", enum: INTEGRATION_PROVIDER_ENUM, description: "Which third-party service the object lives in." },
        object_id: { type: "string", description: "The id from `list_integration_objects` (page id, thread id, file id)." },
      },
      required: ["provider", "object_id"],
    },
  },
  {
    name: "list_my_integrations",
    description:
      "**Always start here when the user mentions 'my connectors', 'my integrations', 'across my services', or asks to pull from external data.** Returns every account the user has connected across every provider in one call — saves polling `integration_status` for each of 8 providers. Returns `{ connections: [{ provider, alias, account_email, status, granted_workspace_ids, ... }] }`. After seeing what's connected, drill into each provider with `list_integration_actions(provider, query=…)` and run actions via `execute_integration_action`.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_integration_actions",
    description:
      "**Use this for ANY provider** — gmail, notion, drive, github, google_calendar, google_docs, google_sheets, slack — to discover actions available. Returns `{ actions: [{ name, summary, paramsJsonSchema, source }] }`. **Always pass `query` for big toolkits** — Calendar / Sheets / Drive / Slack catalogs are 50–150+ actions and an unfiltered call can be 100KB+; with a query like `event` / `spreadsheet` / `message` the response collapses to a few KB. Search by intent: `event` for Calendar; `spreadsheet` / `value` for Sheets; `document` for Docs; `message` / `channel` for Slack; `issue` / `repo` for GitHub. **DO call this whenever a user asks to read from a provider that `list_integration_objects` doesn't support — those providers HAVE read actions; you just discover them here.**",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: { type: "string", enum: INTEGRATION_PROVIDER_ENUM, description: "Which third-party service to enumerate actions for." },
        query: { type: "string", description: "Substring filter against action name + summary (case-insensitive). Strongly recommended for non-Gmail providers to keep responses small." },
      },
      required: ["provider"],
    },
  },
  {
    name: "execute_integration_action",
    description:
      "Run a named action on a connected provider — covers every action Composio exposes across all 8 providers (gmail, calendar, sheets, docs, drive, notion, github, slack). Includes both reads (list events, get spreadsheet, fetch slack history) and writes (send mail, create event, post message). ALWAYS call `list_integration_actions` first to discover the action name and exact `params` shape — don't guess. Returns `{ ok: true, data }` on success, `{ ok: false, error }` if the provider rejected the call. **Read actions** (`list_*`, `get_*`, `fetch_*`, `search_*`) are safe to call without confirmation — use them freely to gather data. **Write actions** (`create_*`, `send_*`, `delete_*`, `update_*`, `post_*`) are side-effecting; confirm with the user before running.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: { type: "string", enum: INTEGRATION_PROVIDER_ENUM, description: "Which third-party service to act on." },
        action: { type: "string", description: "Action name from `list_integration_actions` (e.g. 'send_email', 'list_events')." },
        params: { type: "object", description: "Action params, shape determined by the action's `paramsJsonSchema`." },
        alias: { type: "string", description: "Optional account alias when multiple accounts are connected for this provider." },
      },
      required: ["provider", "action", "params"],
    },
  },
];

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
        error: "Unknown provider. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
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
        error: "Unknown provider. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
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
        error: "Unknown provider. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
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

/**
 * Discovery for the connected provider's full Composio toolkit catalog
 * + any hand-curated overrides. Returns the same shape as the MCP-side
 * `list_integration_actions` tool: `{ actions: [{ name, summary,
 * paramsJsonSchema, source }] }`. Used by the chat agent to find
 * provider-specific actions (list calendar events, append a sheet
 * row, post a Slack message, …) without per-action wrapping code.
 *
 * `query` substring-filters action name + summary so the agent
 * doesn't have to chew through 100KB+ of catalog for big toolkits.
 */
export async function executeListIntegrationActionsTool(
  input: Record<string, unknown>,
  _userId?: string,
  _canvasContext?: unknown,
  _workspaceId?: string
): Promise<ToolResult> {
  const provider = ProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    return {
      result: JSON.stringify({
        error:
          "Unknown provider. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
      }),
    };
  }
  const query = typeof input.query === "string" ? input.query : undefined;
  try {
    const actions = await listIntegrationActions(provider.data, {}, { query });
    return {
      result: JSON.stringify({ provider: provider.data, actions }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: JSON.stringify({ error: message }) };
  }
}

/**
 * One-call summary of every connection the user owns, across all
 * providers. Designed to be the first tool the agent reaches for when
 * the user says "look at my connectors" / "search my services" /
 * "across my data" — saves polling `integration_status` for each of
 * 8 providers individually.
 */
export async function executeListMyIntegrationsTool(
  _input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  _workspaceId?: string
): Promise<ToolResult> {
  if (!userId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  try {
    const rows = await listIntegrationsForUser({ userId });
    return {
      result: JSON.stringify({
        connections: rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          alias: r.alias,
          status: r.status,
          account_email: r.accountEmail,
          account_label: r.accountLabel,
          last_used_at: r.lastUsedAt,
          granted_workspace_ids: r.grantedWorkspaceIds,
        })),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: JSON.stringify({ error: message }) };
  }
}

/**
 * Run one named action against a connected provider. Mirror of the
 * MCP-side `execute_integration_action` so the web chat agent can
 * call any Composio action — read or write — for any of the user's
 * connected providers. Workspace-scoped: the connection must be
 * granted to the active workspace (enforced inside service-actions
 * via `findConnectionForWorkspace`).
 *
 * Read-shaped action names (list_*, get_*, fetch_*, search_*) are
 * safe to call without explicit user confirmation; write-shaped ones
 * (create_*, send_*, delete_*, update_*) should be confirmed first
 * via the chat surface — the system prompt handles that nudge.
 */
export async function executeExecuteIntegrationActionTool(
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
        error:
          "Unknown provider. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
      }),
    };
  }
  const action = typeof input.action === "string" ? input.action : null;
  if (!action) {
    return { result: JSON.stringify({ error: "action is required." }) };
  }
  const params =
    input.params && typeof input.params === "object"
      ? (input.params as Record<string, unknown>)
      : {};
  const alias = typeof input.alias === "string" ? input.alias : undefined;

  try {
    const result = await executeIntegrationAction(
      { workspaceId, userId, provider: provider.data },
      { action, params, alias }
    );
    return { result: JSON.stringify({ provider: provider.data, action, result }) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "chat.tools.execute_integration_action",
      message: `execute_integration_action failed: ${message}`,
      fingerprintKeys: ["integrations_execute_failed", provider.data, action],
      metadata: { provider: provider.data, action, error: message },
      userId,
    });
    return { result: JSON.stringify({ error: message }) };
  }
}
