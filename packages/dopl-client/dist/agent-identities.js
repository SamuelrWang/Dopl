"use strict";
/**
 * Agent-identity methods (class side: `client-agent-identities.ts`). `DELETE` is app-only and
 * deliberately unbound. Identities are addressed by UUID (the route 400s anything else); name→id
 * resolution is the MCP layer's (`packages/mcp-server/src/tools/agent-shared.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAgentIdentitiesPayload = listAgentIdentitiesPayload;
exports.listAgentIdentities = listAgentIdentities;
exports.getAgentIdentity = getAgentIdentity;
exports.createAgentIdentity = createAgentIdentity;
exports.updateAgentIdentity = updateAgentIdentity;
const errors_js_1 = require("./errors.js");
const enc = encodeURIComponent;
/** The identities this caller may see; `shelf` absent = both shelves. */
async function listAgentIdentitiesPayload(t, opts = {}) {
    const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
    return t.request(`/api/agent-identities${qs}`, {
        toolName: "agent_list_identities",
    });
}
/** The rows alone (same single request as {@link listAgentIdentitiesPayload}). */
async function listAgentIdentities(t, opts = {}) {
    return (await listAgentIdentitiesPayload(t, opts)).identities;
}
async function getAgentIdentity(t, identityId) {
    const data = await t.request(`/api/agent-identities/${enc(identityId)}`, { toolName: "agent_get_identity" });
    return data.identity;
}
async function createAgentIdentity(t, input) {
    const data = await t.request("/api/agent-identities", { method: "POST", body: input, toolName: "agent_create_identity" });
    return data.identity;
}
async function updateAgentIdentity(t, identityId, patch, expectedVersion) {
    // Tri-state, like `knowledge.ts › writeKbFileByPath`: a string is a compare-and-swap
    // (`X-Updated-At`, 412 on mismatch), `null` forces, `undefined` is refused HERE — the route
    // still accepts an absent header so older desktops keep last-writer-wins.
    if (expectedVersion === undefined) {
        throw new errors_js_1.DoplApiError(412, JSON.stringify({
            error: {
                code: "EXPECTED_VERSION_REQUIRED",
                message: "Read this identity first and pass its Version as expected_version (or force to overwrite).",
            },
        }));
    }
    const data = await t.request(`/api/agent-identities/${enc(identityId)}`, {
        method: "PATCH",
        body: patch,
        toolName: "agent_update_identity",
        customHeaders: expectedVersion ? { "X-Updated-At": expectedVersion } : undefined,
    });
    return data.identity;
}
