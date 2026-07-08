"use strict";
/**
 * `dopl_canvas` — inspect the panels on the user's canvas.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCanvasTools = registerCanvasTools;
const zod_1 = require("zod");
const DESCRIPTION = `Inspect the user's canvas — the workspace of panels (knowledge bases, skills, workflows, artifacts). Set \`op\` to:
- "list" — list every panel currently on the user's canvas. Use this when the user asks 'what's on my canvas?' or before operations that need to reason about the current workspace.`;
function registerCanvasTools(register, client) {
    register("dopl_canvas", DESCRIPTION, {
        op: zod_1.z.enum(["list"]).describe("Operation to perform."),
    }, async () => opList(client));
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
        lines.push(`- **${label}** \`${p.panel_id}\`${detail ? ` — ${detail}` : ""}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
function panelLabel(type) {
    switch (type) {
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
    if (panel.panel_type === "connection") {
        return "status of your connected MCP agent";
    }
    return null;
}
