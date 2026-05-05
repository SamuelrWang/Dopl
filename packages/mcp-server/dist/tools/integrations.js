"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIntegrationTools = registerIntegrationTools;
const zod_1 = require("zod");
const PROVIDERS = ["notion", "gmail", "google_drive"];
const ProviderArg = zod_1.z
    .enum(PROVIDERS)
    .describe("Third-party service to use. Supported: notion, gmail, google_drive.");
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function registerIntegrationTools(register, client) {
    // ── connect_integration ───────────────────────────────────────────
    register("connect_integration", "Connect a third-party service (Notion, Gmail, Google Drive) to the user's Dopl workspace. If already connected, returns `connected`. Otherwise returns `needs_auth` with an `auth_url` you should print verbatim — the user opens it, authorizes Dopl in the provider's consent screen, and is bounced back to a Dopl success page. After they authorize, call `integration_status` to confirm before pulling anything.", { provider: ProviderArg }, async ({ provider }) => {
        const result = await client.connectIntegration(provider);
        if (result.status === "connected") {
            return ok(`Already connected to **${provider}**.`);
        }
        return ok([
            `**${provider}** isn't connected yet. Ask the user to open this URL to authorize Dopl:`,
            "",
            result.auth_url,
            "",
            "After they authorize, call `integration_status` with the same provider to confirm before listing or ingesting.",
        ].join("\n"));
    });
    // ── integration_status ────────────────────────────────────────────
    register("integration_status", "Check whether a provider is currently connected for this workspace. Returns one of: `connected`, `needs_auth`, `error`, `disconnected`. Call after `connect_integration` to poll until the user finishes the OAuth flow.", { provider: ProviderArg }, async ({ provider }) => {
        const result = await client.getIntegrationStatus(provider);
        return ok(`Status for **${provider}**: \`${result.status}\``);
    });
    // ── list_integration_objects ──────────────────────────────────────
    register("list_integration_objects", "List or search objects in a connected provider (Notion pages, Gmail threads, Drive files). Returns `{ objects: [{ id, title, url, lastModified }], next_cursor }`. Pass a result ID to `read_integration_object` to fetch the body content, or to `ingest_from_integration` to turn it into a synthesized Dopl entry. Optional `query` narrows results by free text; `cursor` pages forward; `limit` caps page size (default 25, max 100).", {
        provider: ProviderArg,
        query: zod_1.z.string().max(200).optional().describe("Free-text search filter."),
        cursor: zod_1.z.string().max(500).optional().describe("Pagination cursor from a previous response."),
        limit: zod_1.z.number().int().min(1).max(100).optional(),
    }, async ({ provider, query, cursor, limit }) => {
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
    });
    // ── read_integration_object ───────────────────────────────────────
    register("read_integration_object", "Fetch the full content of one object from a connected provider. For Notion this returns the page rendered as markdown; for Gmail this returns the full thread (every message body, in chronological order); for Google Drive this returns the file's text content. Pure read — no Dopl entry is created. Use after `list_integration_objects` to drill into a specific result, or whenever you need to *read* external content without ingesting it. Returns `{ provider, object_id, title, url, last_modified, body }`. To turn the object into a synthesized Dopl entry instead, use `ingest_from_integration`.", {
        provider: ProviderArg,
        object_id: zod_1.z
            .string()
            .min(1)
            .max(500)
            .describe("ID from `list_integration_objects` (page id, thread id, file id)."),
    }, async ({ provider, object_id }) => {
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
    });
    // ── list_integration_actions ──────────────────────────────────────
    register("list_integration_actions", "Discover what write actions a connected provider exposes. Returns `{ actions: [{ name, summary, params }] }`. `params` documents each input field with `{ type, description, required }`. After picking an action, call `execute_integration_action` with `provider`, the chosen `name`, and a `params` object matching the descriptor. Read-only — no side effects, no broker call.", { provider: ProviderArg }, async ({ provider }) => {
        const result = await client.listIntegrationActions(provider);
        if (result.actions.length === 0) {
            return ok(`No write actions are available for **${provider}** yet.`);
        }
        const lines = [`## ${result.actions.length} ${provider} action(s)`, ""];
        for (const a of result.actions) {
            lines.push(`### \`${a.name}\``);
            lines.push(a.summary);
            lines.push("");
            lines.push("Params:");
            for (const [key, spec] of Object.entries(a.params)) {
                const req = spec.required ? "required" : "optional";
                lines.push(`- \`${key}\` (${spec.type}, ${req}) — ${spec.description}`);
            }
            lines.push("");
        }
        return ok(lines.join("\n"));
    });
    // ── execute_integration_action ────────────────────────────────────
    register("execute_integration_action", "Run a named write action on a connected provider (e.g. send a Gmail message, post a Slack reply). Always call `list_integration_actions` first to see the catalog and the exact `params` shape. `params` is a JSON object whose keys/types match the descriptor; missing required fields fail validation server-side. Returns `{ ok: true, data }` on success or `{ ok: false, error }` if the provider rejected the call. Side-effecting — only call after the user has explicitly asked for the action.", {
        provider: ProviderArg,
        action: zod_1.z.string().min(1).max(100).describe("Action name from list_integration_actions (e.g. send_email)."),
        params: zod_1.z
            .record(zod_1.z.string(), zod_1.z.unknown())
            .describe("Action params, keyed per the descriptor's params shape."),
    }, async ({ provider, action, params }) => {
        const result = await client.executeIntegrationAction(provider, {
            action,
            params,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    });
    // ── ingest_from_integration ───────────────────────────────────────
    register("ingest_from_integration", "Fetch one object from a connected provider and turn it into a Dopl entry. Returns the same shape `ingest_url` returns: `{ entry_id, content, prompts, instructions }`. Run the prompts in your own Claude context (or delegate to a subagent) and POST the artifacts to `submit_ingested_entry` with the returned `entry_id` to commit. The agent-driven synthesis flow is unchanged — only the source has shifted from a URL to a third-party object.", {
        provider: ProviderArg,
        object_id: zod_1.z.string().min(1).max(500).describe("ID from `list_integration_objects`."),
        kb_id: zod_1.z.string().uuid().optional().describe("Optional knowledge base UUID to associate the entry with."),
        cluster_id: zod_1.z.string().uuid().optional().describe("Optional cluster UUID to attach the entry to after submit."),
    }, async ({ provider, object_id, kb_id, cluster_id }) => {
        const result = await client.prepareFromIntegration({
            provider,
            object_id,
            kb_id,
            cluster_id,
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    });
}
