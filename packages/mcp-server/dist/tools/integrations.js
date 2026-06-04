"use strict";
/**
 * MCP tools for connecting third-party services (Notion, Gmail,
 * Drive, etc.) and pulling content from them into the user's Dopl
 * workspace as fully-synthesized entries.
 *
 * Consolidated into ONE `op`-dispatched tool, `dopl_integration` (the
 * canonical pattern from `setups.ts`). These are connector ops — no
 * destructive split is needed. The op surface:
 *   - connect      — start (or check) the OAuth flow
 *   - status       — re-poll connection state
 *   - list_my      — every connected account across providers, in one call
 *   - list_objects — search/enumerate the connected service
 *   - read_object  — fetch one object's body content (read-only; no entry row)
 *   - list_actions — discover a provider's write actions + param schemas
 *   - execute_action — run a named write action (side-effecting)
 *   - ingest       — fetch one object → prepare-shaped bundle; agent then
 *                    calls existing `dopl_ingest(op='submit')`.
 *
 * Branding note: tool descriptions never mention the OAuth broker we
 * use under the hood. The agent only sees a Dopl-branded auth URL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIntegrationTools = registerIntegrationTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
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
];
const ProviderArg = zod_1.z
    .enum(PROVIDERS)
    .optional()
    .describe("Third-party service to use. Required for every op except list_my. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack, attio.");
const DESCRIPTION = `Connect third-party services to the user's Dopl workspace and pull content from them. Set \`op\` to one of:
- "connect" — connect a provider. If already connected, returns \`connected\`. Otherwise returns \`needs_auth\` with an \`auth_url\` you should print verbatim — the user opens it, authorizes Dopl in the provider's consent screen, and is bounced back to a Dopl success page. After they authorize, use op="status" with the same provider to confirm before pulling anything. Requires: provider.
- "status" — check whether a provider is currently connected for this workspace. Returns one of: \`connected\`, \`needs_auth\`, \`error\`, \`disconnected\`. Call after op="connect" to poll until the user finishes the OAuth flow. Requires: provider.
- "list_my" — single call to see every third-party account the user has connected, across every provider, with workspace grant info. Use this FIRST whenever the user mentions 'my connectors', 'my integrations', 'across my services', or asks to pull data from external sources — instead of polling op="status" for each of 8 providers. Returns connections with provider, alias, account_email, status, granted_workspace_ids, last_used_at. After seeing what's connected, drill into each provider with op="list_actions" (query=…) and run actions via op="execute_action".
- "list_objects" — list or search read-shaped objects in a connected provider: notion (pages), gmail (threads), google_drive (files), github (repos), google_calendar (events), google_docs (documents), google_sheets (spreadsheets), slack (conversations), attio (CRM records — default \`companies\`; pass \`query\` as an Attio object slug like \`people\`/\`deals\` to list a different type). Pass a result ID to op="read_object" to fetch body content, or to op="ingest" to turn it into a synthesized Dopl entry. Optional \`query\` narrows results; \`cursor\` pages forward; \`limit\` caps page size. Write-only actions (post a Slack reply, send a Gmail, etc.) live behind op="list_actions" + op="execute_action". Requires: provider.
- "read_object" — fetch the full content of one object from a connected provider: notion (page → markdown), gmail (thread → all message bodies in order), google_drive (file → text), github (repo → README), google_calendar (event → details + attendees), google_docs (doc → text), google_sheets (spreadsheet → sheet inventory), slack (channel → recent messages), attio (CRM record → structured field values). Pure read — no Dopl entry is created. To turn the object into a synthesized Dopl entry instead, use op="ingest". Requires: provider, object_id.
- "list_actions" — discover the actions a connected provider exposes. Returns actions with name, summary, paramsJsonSchema (a standard JSON Schema fragment — read it to construct the \`params\` object you'll pass to op="execute_action"), and source (\`curated\` = hand-tuned by Dopl, \`auto\` = auto-generated from the broker's full catalog). **Always pass \`query\` for big toolkits** — Calendar, Sheets, Drive, Slack, GitHub, and Notion catalogs are 50–150+ actions and the unfiltered response can be 100KB+; with a query like 'event', 'spreadsheet', 'message', the response collapses to a few KB. Search by intent: 'list_events' / 'find_event' for Calendar; 'spreadsheet' / 'get_values' for Sheets; 'message' / 'channel' for Slack; 'issue' / 'repository' for GitHub. Requires: provider.
- "execute_action" — run a named write action on a connected provider (e.g. send a Gmail message, post a Slack reply). Always use op="list_actions" first to see the catalog and the exact \`params\` shape. \`params\` is a JSON object whose keys/types match the descriptor; missing required fields fail validation server-side. Returns \`{ ok: true, data }\` on success or \`{ ok: false, error }\` if the provider rejected the call. Side-effecting — only call after the user has explicitly asked for the action. Requires: provider, action, params.
- "ingest" — fetch one object from a connected provider and turn it into a Dopl entry. Returns the same shape \`dopl_ingest(op='url')\` returns: \`{ entry_id, content, prompts, instructions }\`. Run the prompts in your own Claude context (or delegate to a subagent) and POST the artifacts to \`dopl_ingest(op='submit')\` with the returned \`entry_id\` to commit. The agent-driven synthesis flow is unchanged — only the source has shifted from a URL to a third-party object. Requires: provider, object_id.`;
function registerIntegrationTools(register, client) {
    register("dopl_integration", DESCRIPTION, {
        op: zod_1.z
            .enum([
            "connect",
            "status",
            "list_my",
            "list_objects",
            "read_object",
            "list_actions",
            "execute_action",
            "ingest",
        ])
            .describe("Operation to perform."),
        provider: ProviderArg,
        query: zod_1.z
            .string()
            .max(200)
            .optional()
            .describe("op=list_objects: free-text search filter. op=list_actions: substring filter against action name + summary (case-insensitive); strongly recommended for non-Gmail providers to avoid 100KB+ responses."),
        cursor: zod_1.z
            .string()
            .max(500)
            .optional()
            .describe("op=list_objects: pagination cursor from a previous response."),
        limit: zod_1.z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("op=list_objects: page size cap."),
        object_id: zod_1.z
            .string()
            .min(1)
            .max(500)
            .optional()
            .describe("op=read_object / op=ingest: ID from op=list_objects (page id, thread id, file id)."),
        action: zod_1.z
            .string()
            .min(1)
            .max(100)
            .optional()
            .describe("op=execute_action: action name from op=list_actions (e.g. send_email)."),
        params: zod_1.z
            .record(zod_1.z.string(), zod_1.z.unknown())
            .optional()
            .describe("op=execute_action: action params, keyed per the descriptor's params shape."),
        kb_id: zod_1.z
            .string()
            .uuid()
            .optional()
            .describe("op=ingest: optional knowledge base UUID to associate the entry with."),
        cluster_id: zod_1.z
            .string()
            .uuid()
            .optional()
            .describe("op=ingest: optional cluster UUID to attach the entry to after submit."),
    }, async (args) => {
        switch (args.op) {
            case "connect": {
                const miss = (0, respond_1.missingParams)("connect", args, ["provider"]);
                if (miss)
                    return miss;
                return opConnect(client, args.provider);
            }
            case "status": {
                const miss = (0, respond_1.missingParams)("status", args, ["provider"]);
                if (miss)
                    return miss;
                return opStatus(client, args.provider);
            }
            case "list_my":
                return opListMy(client);
            case "list_objects": {
                const miss = (0, respond_1.missingParams)("list_objects", args, ["provider"]);
                if (miss)
                    return miss;
                return opListObjects(client, args.provider, {
                    query: args.query,
                    cursor: args.cursor,
                    limit: args.limit,
                });
            }
            case "read_object": {
                const miss = (0, respond_1.missingParams)("read_object", args, ["provider", "object_id"]);
                if (miss)
                    return miss;
                return opReadObject(client, args.provider, args.object_id);
            }
            case "list_actions": {
                const miss = (0, respond_1.missingParams)("list_actions", args, ["provider"]);
                if (miss)
                    return miss;
                return opListActions(client, args.provider, args.query);
            }
            case "execute_action": {
                const miss = (0, respond_1.missingParams)("execute_action", args, ["provider", "action", "params"]);
                if (miss)
                    return miss;
                return opExecuteAction(client, args.provider, args.action, args.params);
            }
            case "ingest": {
                const miss = (0, respond_1.missingParams)("ingest", args, ["provider", "object_id"]);
                if (miss)
                    return miss;
                return opIngest(client, args.provider, {
                    object_id: args.object_id,
                    kb_id: args.kb_id,
                    cluster_id: args.cluster_id,
                });
            }
        }
    });
}
async function opConnect(client, provider) {
    const result = await client.connectIntegration(provider);
    if (result.status === "connected") {
        return (0, respond_1.ok)(`Already connected to **${provider}**.`);
    }
    return (0, respond_1.ok)([
        `**${provider}** isn't connected yet. Ask the user to open this URL to authorize Dopl:`,
        "",
        result.auth_url,
        "",
        "After they authorize, use op=\"status\" with the same provider to confirm before listing or ingesting.",
    ].join("\n"));
}
async function opStatus(client, provider) {
    const result = await client.getIntegrationStatus(provider);
    return (0, respond_1.ok)(`Status for **${provider}**: \`${result.status}\``);
}
async function opListObjects(client, provider, opts) {
    const result = await client.listIntegrationObjects(provider, {
        query: opts.query,
        cursor: opts.cursor,
        limit: opts.limit,
    });
    if (result.objects.length === 0) {
        return (0, respond_1.ok)(`No matching objects in **${provider}**.`);
    }
    const lines = [`## ${result.objects.length} ${provider} object(s)\n`];
    for (const obj of result.objects) {
        const modified = obj.lastModified ? ` _(modified ${obj.lastModified})_` : "";
        lines.push(`- **${obj.title}** \`${obj.id}\`${modified}`);
    }
    if (result.next_cursor) {
        lines.push("", `_More results available — pass cursor: \`${result.next_cursor}\`_`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opReadObject(client, provider, object_id) {
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
    return (0, respond_1.ok)(meta);
}
async function opListMy(client) {
    const result = await client.listMyIntegrations();
    if (result.connections.length === 0) {
        return (0, respond_1.ok)("No integrations connected yet. The user needs to visit /settings/integrations and connect a provider before I can pull anything.");
    }
    const lines = [
        `## ${result.connections.length} connected account(s)`,
        "",
    ];
    const byProvider = new Map();
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
            lines.push(`- **${label}** (status: \`${a.status}\`, granted to ${grants} workspace${grants === 1 ? "" : "s"})`);
        }
        lines.push("");
    }
    lines.push("Next step: pick a provider and call op=\"list_actions\" (provider, query=<keyword>) to find the right action — use a query to keep the response small (catalogs can be 50–100+ actions per provider).");
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opListActions(client, provider, query) {
    const result = await client.listIntegrationActions(provider, { query });
    if (result.actions.length === 0) {
        return (0, respond_1.ok)(query
            ? `No ${provider} actions match query \`${query}\`. Try a broader keyword, or call again without \`query\` to see the full catalog (warning: can be large).`
            : `No actions are available for **${provider}** yet.`);
    }
    return (0, respond_1.ok)([
        `## ${result.actions.length} ${provider} action(s)${query ? ` matching \`${query}\`` : ""}`,
        "",
        "Each action below has a `name`, `summary`, `paramsJsonSchema` (use to build `params`), and `source` (curated|auto).",
        "",
        "```json",
        JSON.stringify(result.actions, null, 2),
        "```",
    ].join("\n"));
}
async function opExecuteAction(client, provider, action, params) {
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
}
async function opIngest(client, provider, opts) {
    const result = await client.prepareFromIntegration({
        provider,
        object_id: opts.object_id,
        kb_id: opts.kb_id,
        cluster_id: opts.cluster_id,
    });
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}
