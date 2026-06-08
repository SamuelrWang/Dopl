"use strict";
/**
 * `dopl_canvas` — inspect and rename panels on the user's canvas.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCanvasTools = registerCanvasTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const DESCRIPTION = `Manage the user's canvas — the workspace of panels (chat, knowledge bases, skills, artifacts). Set \`op\` to one of:
- "list" — list every panel currently on the user's canvas. Use this when the user asks 'what's on my canvas?' or before operations that need to reason about the current workspace.
- "rename_chat" — rename a chat panel on the user's canvas. Use when the user asks to rename a chat, or when the auto-derived title no longer captures the conversation's topic.`;
function registerCanvasTools(register, client) {
    register("dopl_canvas", DESCRIPTION, {
        op: zod_1.z
            .enum(["list", "rename_chat"])
            .describe("Operation to perform."),
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
            content: [{ type: "text", text: "Your canvas is empty." }],
        };
    }
    const lines = [];
    lines.push(`## Your Canvas — ${panels.length} panel${panels.length === 1 ? "" : "s"}\n`);
    for (const p of panels) {
        const label = panelLabel(p.panel_type);
        const detail = panelDetail(p);
        lines.push(`- **${label}**${detail ? ` — ${detail}` : ""}`);
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
function panelLabel(type) {
    switch (type) {
        case "chat": return "Chat panel";
        case "connection": return "MCP connection panel";
        case "knowledge": return "Knowledge bases panel";
        case "skills": return "Skills panel";
        case "knowledge-base": return "Knowledge base panel";
        case "skill": return "Skill panel";
        case "artifact": return "Artifact panel";
        default: return "Panel";
    }
}
function panelDetail(panel) {
    if (panel.title)
        return panel.title;
    switch (panel.panel_type) {
        case "connection": return "status of your connected MCP agent";
        case "chat": return "an in-canvas chat thread";
        default: return null;
    }
}
