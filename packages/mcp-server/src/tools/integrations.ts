/**
 * MCP tools for connecting third-party services (Notion, Gmail,
 * Drive) and pulling content from them into the user's Dopl
 * workspace as fully-synthesized entries.
 *
 * Five tools, all generic on `provider`:
 *   - `connect_integration`         — start (or check) the OAuth flow
 *   - `integration_status`          — re-poll connection state
 *   - `list_integration_objects`    — search/enumerate the connected service
 *   - `read_integration_object`     — fetch one object's body content
 *                                     (read-only; no entry/sources row).
 *   - `ingest_from_integration`     — fetch one object and produce a
 *                                     prepare-shaped bundle. Agent then
 *                                     calls existing `submit_ingested_entry`.
 *
 * Branding note: tool descriptions never mention the OAuth broker we
 * use under the hood. The agent only sees a Dopl-branded auth URL.
 */

import { z, type ZodRawShape } from "zod";
import type { DoplClient, IntegrationProvider } from "@dopl/client";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type RegisterTool = <S extends ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>
) => void;

const PROVIDERS = [
  "notion",
  "gmail",
  "google_drive",
  "github",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "slack",
  "attio",
] as const satisfies readonly IntegrationProvider[];
const ProviderArg = z
  .enum(PROVIDERS)
  .describe(
    "Third-party service to use. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack, attio."
  );

function ok(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

export function registerIntegrationTools(
  register: RegisterTool,
  client: DoplClient
): void {
  // ── connect_integration ───────────────────────────────────────────
  register(
    "connect_integration",
    "Connect a third-party service to the user's Dopl workspace. If already connected, returns `connected`. Otherwise returns `needs_auth` with an `auth_url` you should print verbatim — the user opens it, authorizes Dopl in the provider's consent screen, and is bounced back to a Dopl success page. After they authorize, call `integration_status` to confirm before pulling anything. Supported providers: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
    { provider: ProviderArg },
    async ({ provider }) => {
      const result = await client.connectIntegration(provider);
      if (result.status === "connected") {
        return ok(`Already connected to **${provider}**.`);
      }
      return ok(
        [
          `**${provider}** isn't connected yet. Ask the user to open this URL to authorize Dopl:`,
          "",
          result.auth_url,
          "",
          "After they authorize, call `integration_status` with the same provider to confirm before listing or ingesting.",
        ].join("\n")
      );
    }
  );

  // ── integration_status ────────────────────────────────────────────
  register(
    "integration_status",
    "Check whether a provider is currently connected for this workspace. Returns one of: `connected`, `needs_auth`, `error`, `disconnected`. Call after `connect_integration` to poll until the user finishes the OAuth flow.",
    { provider: ProviderArg },
    async ({ provider }) => {
      const result = await client.getIntegrationStatus(provider);
      return ok(`Status for **${provider}**: \`${result.status}\``);
    }
  );

  // ── list_integration_objects ──────────────────────────────────────
  register(
    "list_integration_objects",
    "List or search read-shaped objects in a connected provider. Supported on: notion (pages), gmail (threads), google_drive (files), github (repos), google_calendar (events), google_docs (documents), google_sheets (spreadsheets), slack (conversations), attio (CRM records — default `companies`; pass `query` as an Attio object slug like `people`/`deals` to list a different type). Returns `{ objects: [{ id, title, url, lastModified }], next_cursor }`. Pass a result ID to `read_integration_object` to fetch body content, or to `ingest_from_integration` to turn it into a synthesized Dopl entry. Optional `query` narrows results (provider-dependent); `cursor` pages forward; `limit` caps page size. Write-only actions (post a Slack reply, send a Gmail, etc.) live behind `list_integration_actions` + `execute_integration_action`.",
    {
      provider: ProviderArg,
      query: z.string().max(200).optional().describe("Free-text search filter."),
      cursor: z.string().max(500).optional().describe("Pagination cursor from a previous response."),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ provider, query, cursor, limit }) => {
      const result = await client.listIntegrationObjects(provider, {
        query,
        cursor,
        limit,
      });
      if (result.objects.length === 0) {
        return ok(`No matching objects in **${provider}**.`);
      }
      const lines = [`## ${result.objects.length} ${provider} object(s)\n`];
      for (const obj of result.objects) {
        const modified = obj.lastModified ? ` _(modified ${obj.lastModified})_` : "";
        lines.push(`- **${obj.title}** \`${obj.id}\`${modified}`);
      }
      if (result.next_cursor) {
        lines.push("", `_More results available — pass cursor: \`${result.next_cursor}\`_`);
      }
      return ok(lines.join("\n"));
    }
  );

  // ── read_integration_object ───────────────────────────────────────
  register(
    "read_integration_object",
    "Fetch the full content of one object from a connected provider. Supported on: notion (page → markdown), gmail (thread → all message bodies in order), google_drive (file → text), github (repo → README), google_calendar (event → details + attendees), google_docs (doc → text), google_sheets (spreadsheet → sheet inventory), slack (channel → recent messages), attio (CRM record → structured field values). Pure read — no Dopl entry is created. Use after `list_integration_objects` to drill into a specific result. Returns `{ provider, object_id, title, url, last_modified, body }`. To turn the object into a synthesized Dopl entry instead, use `ingest_from_integration`.",
    {
      provider: ProviderArg,
      object_id: z
        .string()
        .min(1)
        .max(500)
        .describe("ID from `list_integration_objects` (page id, thread id, file id)."),
    },
    async ({ provider, object_id }) => {
      const result = await client.readIntegrationObject(provider, { object_id });
      const meta = [
        `# ${result.title}`,
        result.url ? `Source: ${result.url}` : null,
        result.last_modified ? `Last modified: ${result.last_modified}` : null,
        "",
        result.body,
      ]
        .filter((line) => line !== null)
        .join("\n");
      return ok(meta);
    }
  );

  // ── list_my_integrations ──────────────────────────────────────────
  register(
    "list_my_integrations",
    "Single call to see every third-party account the user has connected, across every provider, with workspace grant info. Use this FIRST whenever the user mentions 'my connectors', 'my integrations', 'across my services', or asks to pull data from external sources — instead of polling `integration_status` for each of 8 providers. Returns `{ connections: [{ provider, alias, account_email, status, granted_workspace_ids, last_used_at }] }`. After seeing what's connected, drill into each provider with `list_integration_actions(provider, query=…)` and run actions via `execute_integration_action`.",
    {},
    async () => {
      const result = await client.listMyIntegrations();
      if (result.connections.length === 0) {
        return ok(
          "No integrations connected yet. The user needs to visit /settings/integrations and connect a provider before I can pull anything."
        );
      }
      const lines = [
        `## ${result.connections.length} connected account(s)`,
        "",
      ];
      const byProvider = new Map<string, typeof result.connections>();
      for (const c of result.connections) {
        const arr = byProvider.get(c.provider) ?? [];
        arr.push(c);
        byProvider.set(c.provider, arr);
      }
      for (const [provider, accounts] of byProvider) {
        lines.push(`### ${provider}`);
        for (const a of accounts) {
          const label = a.account_email ?? a.account_label ?? a.alias;
          const grants = a.granted_workspace_ids.length;
          lines.push(
            `- **${label}** (status: \`${a.status}\`, granted to ${grants} workspace${grants === 1 ? "" : "s"})`
          );
        }
        lines.push("");
      }
      lines.push(
        "Next step: pick a provider and call `list_integration_actions(provider, query=<keyword>)` to find the right action — use a query to keep the response small (catalogs can be 50–100+ actions per provider)."
      );
      return ok(lines.join("\n"));
    }
  );

  // ── list_integration_actions ──────────────────────────────────────
  register(
    "list_integration_actions",
    "Discover the actions a connected provider exposes. Returns `{ actions: [{ name, summary, paramsJsonSchema, source }] }`. `paramsJsonSchema` is a standard JSON Schema fragment — read it to construct the `params` object you'll pass to `execute_integration_action`. `source` is `curated` (hand-tuned by Dopl) or `auto` (auto-generated from the broker's full catalog). **Always pass `query` for big toolkits** — Calendar, Sheets, Drive, Slack, GitHub, and Notion catalogs are 50–150+ actions and the unfiltered response can be 100KB+; with a query like 'event', 'spreadsheet', 'message', the response collapses to a few KB. Search by intent: 'list_events' / 'find_event' for Calendar; 'spreadsheet' / 'get_values' for Sheets; 'message' / 'channel' for Slack; 'issue' / 'repository' for GitHub.",
    {
      provider: ProviderArg,
      query: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Substring filter against action name + summary (case-insensitive). Strongly recommended for non-Gmail providers to avoid 100KB+ responses."
        ),
    },
    async ({ provider, query }) => {
      const result = await client.listIntegrationActions(provider, { query });
      if (result.actions.length === 0) {
        return ok(
          query
            ? `No ${provider} actions match query \`${query}\`. Try a broader keyword, or call again without \`query\` to see the full catalog (warning: can be large).`
            : `No actions are available for **${provider}** yet.`
        );
      }
      return ok(
        [
          `## ${result.actions.length} ${provider} action(s)${query ? ` matching \`${query}\`` : ""}`,
          "",
          "Each action below has a `name`, `summary`, `paramsJsonSchema` (use to build `params`), and `source` (curated|auto).",
          "",
          "```json",
          JSON.stringify(result.actions, null, 2),
          "```",
        ].join("\n")
      );
    }
  );

  // ── execute_integration_action ────────────────────────────────────
  register(
    "execute_integration_action",
    "Run a named write action on a connected provider (e.g. send a Gmail message, post a Slack reply). Always call `list_integration_actions` first to see the catalog and the exact `params` shape. `params` is a JSON object whose keys/types match the descriptor; missing required fields fail validation server-side. Returns `{ ok: true, data }` on success or `{ ok: false, error }` if the provider rejected the call. Side-effecting — only call after the user has explicitly asked for the action.",
    {
      provider: ProviderArg,
      action: z.string().min(1).max(100).describe("Action name from list_integration_actions (e.g. send_email)."),
      params: z
        .record(z.string(), z.unknown())
        .describe("Action params, keyed per the descriptor's params shape."),
    },
    async ({ provider, action, params }) => {
      const result = await client.executeIntegrationAction(provider, {
        action,
        params,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ── ingest_from_integration ───────────────────────────────────────
  register(
    "ingest_from_integration",
    "Fetch one object from a connected provider and turn it into a Dopl entry. Returns the same shape `ingest_url` returns: `{ entry_id, content, prompts, instructions }`. Run the prompts in your own Claude context (or delegate to a subagent) and POST the artifacts to `submit_ingested_entry` with the returned `entry_id` to commit. The agent-driven synthesis flow is unchanged — only the source has shifted from a URL to a third-party object.",
    {
      provider: ProviderArg,
      object_id: z.string().min(1).max(500).describe("ID from `list_integration_objects`."),
      kb_id: z.string().uuid().optional().describe("Optional knowledge base UUID to associate the entry with."),
      cluster_id: z.string().uuid().optional().describe("Optional cluster UUID to attach the entry to after submit."),
    },
    async ({ provider, object_id, kb_id, cluster_id }) => {
      const result = await client.prepareFromIntegration({
        provider,
        object_id,
        kb_id,
        cluster_id,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
