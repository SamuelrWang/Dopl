"use strict";
/**
 * Agent-template methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-agent-templates.ts`.
 *
 * ⚠ FOUR VERBS AND THE OMISSION IS THE POINT. `DELETE /api/agent-templates/
 * {id}` is `sessionOnly` AND app-only by standing policy (Samuel's ruling Q9,
 * 2026-08-28), so binding it here would publish a method every MCP tool holds
 * and no MCP caller may ever use.
 *
 * ⚠ TEMPLATES ARE ADDRESSED BY UUID, never by slug — the route param validator
 * (`shared/api/agent-template-route.ts › requireTemplateId`) 400s anything
 * else. Name→id resolution is the MCP layer's job
 * (`packages/mcp-server/src/tools/agent-shared.ts`), over the already
 * visibility-filtered list this module returns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAgentTemplatesPayload = listAgentTemplatesPayload;
exports.listAgentTemplates = listAgentTemplates;
exports.getAgentTemplate = getAgentTemplate;
exports.createAgentTemplate = createAgentTemplate;
exports.updateAgentTemplate = updateAgentTemplate;
const enc = encodeURIComponent;
/**
 * The templates this caller may SEE, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves, and that is the pre-existing contract every
 * caller rides. An unrecognised value never reaches here — the MCP arg is an
 * enum and the route answers 400 — so this function never has to decide what a
 * misspelling means.
 */
async function listAgentTemplatesPayload(t, opts = {}) {
    const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
    return t.request(`/api/agent-templates${qs}`, {
        toolName: "agent_list_templates",
    });
}
/** The rows alone. ⚠ DELEGATES to {@link listAgentTemplatesPayload} — one HTTP
 *  call either way, and one place that knows the URL. */
async function listAgentTemplates(t, opts = {}) {
    return (await listAgentTemplatesPayload(t, opts)).templates;
}
async function getAgentTemplate(t, templateId) {
    const data = await t.request(`/api/agent-templates/${enc(templateId)}`, { toolName: "agent_get_template" });
    return data.template;
}
async function createAgentTemplate(t, input) {
    const data = await t.request("/api/agent-templates", { method: "POST", body: input, toolName: "agent_create_template" });
    return data.template;
}
async function updateAgentTemplate(t, templateId, patch) {
    const data = await t.request(`/api/agent-templates/${enc(templateId)}`, { method: "PATCH", body: patch, toolName: "agent_update_template" });
    return data.template;
}
