"use strict";
/**
 * `dopl_canvas` — manage the user's canvas (the saved-entries workspace).
 *
 * Consolidates the old `dopl_canvas(op='list')`, `dopl_canvas(op='add_entry')`,
 * `dopl_canvas(op='remove_entry')`, `dopl_canvas(op='search_and_add')`, and `dopl_canvas(op='rename_chat')` tools.
 * Follows the canonical pattern in `setups.ts`: one `register(...)` with an
 * `op` enum + a flat schema of all per-op params (optional), a handler that
 * switches on `op`, validates required params via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old handlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCanvasTools = registerCanvasTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const DESCRIPTION = `Manage the user's canvas — the workspace of saved knowledge-base entries. Set \`op\` to one of:
- "list" — list every panel currently on the user's canvas. Use this when the user asks 'what's on my canvas?', 'show me my saved setups', or before operations that need to reason about the current workspace (e.g. deciding what belongs in a new cluster). Returns a mix of entry panels (the saved KB entries — title, slug, source_url) and system panels (chat, connection, browse — the UI surfaces the user placed on their canvas). Entry panels are the ones relevant for clustering/add/remove operations; system panels are display-only.
- "add_entry" — add ONE known knowledge-base entry to the user's canvas by slug or UUID. Use this when you already have the exact entry the user wants to save. For search + add in one step (the common case when the user says 'save some good options for X to my canvas'), use op="search_and_add" instead — it's a batch operation and much faster than looping through search hits.
- "remove_entry" — take an entry off the user's canvas. The entry stays in the knowledge base — only the canvas panel is removed. Use when the user says 'clear this from my canvas', 'I don't need this anymore', or is pruning their workspace. For permanent deletion from the KB, use \`dopl_cluster_admin(op='delete_entry')\` instead (destructive, different scope).
- "search_and_add" — search the KB and add the top N matches to the user's canvas in one round trip. THIS is the default for 'save some good options for X to my canvas' / 'build me a starter canvas about Y' / 'find and bookmark patterns for Z' — much faster than \`search_setups\` followed by N add_entry calls. For adding a specific known entry by slug, use op="add_entry".
- "rename_chat" — rename a chat panel on the user's canvas. Use this when the user asks to rename a chat, or when the initial auto-derived title (first user message truncated) no longer captures the conversation's topic. Purpose-named wrapper over the generic panels PATCH endpoint.`;
function registerCanvasTools(register, client) {
    register("dopl_canvas", DESCRIPTION, {
        op: zod_1.z
            .enum(["list", "add_entry", "remove_entry", "search_and_add", "rename_chat"])
            .describe("Operation to perform."),
        entry: zod_1.z
            .string()
            .optional()
            .describe("op=add_entry: entry slug or UUID from search results or get_setup. op=remove_entry: entry slug or UUID to remove from canvas."),
        query: zod_1.z
            .string()
            .optional()
            .describe("op=search_and_add: natural language search query, e.g. 'marketing automations' or 'n8n workflows'."),
        max_results: zod_1.z
            .number()
            .optional()
            .describe("op=search_and_add: number of results to add (default 5, max 10)."),
        panel_id: zod_1.z
            .string()
            .optional()
            .describe("op=rename_chat: chat panel ID (e.g. 'panel-3')."),
        title: zod_1.z
            .string()
            .optional()
            .describe("op=rename_chat: new chat title."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return opList(client);
            case "add_entry": {
                const miss = (0, respond_1.missingParams)("add_entry", args, ["entry"]);
                if (miss)
                    return miss;
                return opAddEntry(client, args.entry);
            }
            case "remove_entry": {
                const miss = (0, respond_1.missingParams)("remove_entry", args, ["entry"]);
                if (miss)
                    return miss;
                return opRemoveEntry(client, args.entry);
            }
            case "search_and_add": {
                const miss = (0, respond_1.missingParams)("search_and_add", args, ["query"]);
                if (miss)
                    return miss;
                return opSearchAndAdd(client, args.query, args.max_results);
            }
            case "rename_chat": {
                const miss = (0, respond_1.missingParams)("rename_chat", args, ["panel_id", "title"]);
                if (miss)
                    return miss;
                return opRenameChat(client, args.panel_id, args.title);
            }
        }
    });
}
async function opList(client) {
    const panels = await client.listCanvasPanels();
    if (panels.length === 0) {
        return {
            content: [{ type: "text", text: "Your canvas is empty. Use `dopl_canvas(op='add_entry')` to add entries, or `search_setups` to find them first." }],
        };
    }
    // Split by panel type so the entry list stays clean for the agent's
    // clustering/search decisions, while system panels (chat, connection,
    // browse) render underneath as a separate group. The backend stores
    // panel_type; before this split, system panels rendered as "Untitled"
    // alongside real entries and confused the agent.
    const entryPanels = panels.filter((p) => p.panel_type === "entry");
    const systemPanels = panels.filter((p) => p.panel_type !== "entry");
    const lines = [];
    lines.push(`## Your Canvas — ${entryPanels.length} ${entryPanels.length === 1 ? "entry" : "entries"}${systemPanels.length > 0 ? ` + ${systemPanels.length} system panel${systemPanels.length === 1 ? "" : "s"}` : ""}\n`);
    if (entryPanels.length > 0) {
        lines.push("### Entries");
        for (const p of entryPanels) {
            const title = p.title || "Untitled entry";
            const url = client.entryUrl(p.slug);
            const label = url ? `[${title}](${url})` : title;
            lines.push(`- **${label}**`);
            if (p.summary)
                lines.push(`  ${p.summary}`);
            if (p.source_url)
                lines.push(`  Source: ${p.source_url}`);
        }
    }
    if (systemPanels.length > 0) {
        lines.push("");
        lines.push("### System panels (UI surfaces, not saved content)");
        for (const p of systemPanels) {
            const label = systemPanelLabel(p.panel_type);
            const detail = systemPanelDetail(p);
            lines.push(`- **${label}**${detail ? ` — ${detail}` : ""}`);
        }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
async function opAddEntry(client, entry) {
    const { panel, created } = await client.addCanvasPanel(entry);
    const verb = created ? "Added" : "Already on";
    const title = panel.title || "Untitled";
    const url = client.entryUrl(panel.slug);
    const label = url ? `[${title}](${url})` : title;
    return {
        content: [
            {
                type: "text",
                text: `${verb} canvas: **${label}**`,
            },
        ],
    };
}
async function opRemoveEntry(client, entry) {
    await client.removeCanvasPanel(entry);
    return {
        content: [
            {
                type: "text",
                text: `Removed entry from your canvas.`,
            },
        ],
    };
}
async function opSearchAndAdd(client, query, max_results) {
    const limit = Math.min(max_results ?? 5, 10);
    const searchResult = await client.searchSetups({
        query,
        max_results: limit,
    });
    if (searchResult.entries.length === 0) {
        return {
            content: [{
                    type: "text",
                    text: `No results found for "${query}".`,
                }],
        };
    }
    const added = [];
    const skipped = [];
    for (const entry of searchResult.entries) {
        const title = entry.title || "Untitled";
        const url = client.entryUrl(entry.slug);
        const label = url ? `[${title}](${url})` : title;
        try {
            const { created } = await client.addCanvasPanel(entry.entry_id);
            if (created) {
                added.push(`- **${label}** (${Math.round(entry.similarity * 100)}% match)`);
            }
            else {
                skipped.push(`- ${label} (already on canvas)`);
            }
        }
        catch {
            skipped.push(`- ${label} (failed to add)`);
        }
    }
    const lines = [];
    if (added.length > 0) {
        lines.push(`## Added to canvas (${added.length})\n`);
        lines.push(...added);
    }
    if (skipped.length > 0) {
        lines.push(`\n## Skipped (${skipped.length})\n`);
        lines.push(...skipped);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
async function opRenameChat(client, panel_id, title) {
    await client.renameChat(panel_id, title);
    return {
        content: [{
                type: "text",
                text: `Renamed chat to "${title}".`,
            }],
    };
}
function systemPanelLabel(type) {
    switch (type) {
        case "chat": return "Chat panel";
        case "connection": return "MCP connection panel";
        case "browse": return "Browse panel";
        default: return "System panel";
    }
}
function systemPanelDetail(panel) {
    // System panels occasionally carry a title (e.g. the browse panel's
    // active filter, a chat panel's conversation topic). Surface it when
    // present; otherwise describe the panel's purpose inline.
    if (panel.title)
        return panel.title;
    switch (panel.panel_type) {
        case "browse": return "the KB browse surface";
        case "connection": return "status of your connected MCP agent";
        case "chat": return "an in-canvas chat thread";
        default: return null;
    }
}
