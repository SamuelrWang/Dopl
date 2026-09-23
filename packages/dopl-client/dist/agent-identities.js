"use strict";
/**
 * Agent-identity methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-agent-identities.ts`.
 *
 * ⚠ FOUR VERBS AND THE OMISSION IS THE POINT. `DELETE /api/agent-identities/
 * {id}` is `sessionOnly` AND app-only by standing policy (Samuel's ruling Q9,
 * 2026-08-28), so binding it here would publish a method every MCP tool holds
 * and no MCP caller may ever use.
 *
 * ⚠ IDENTITIES ARE ADDRESSED BY UUID, never by slug — the route param validator
 * (`shared/api/agent-identity-route.ts › requireIdentityId`) 400s anything
 * else. Name→id resolution is the MCP layer's job
 * (`packages/mcp-server/src/tools/agent-shared.ts`), over the already
 * visibility-filtered list this module returns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAgentIdentitiesPayload = listAgentIdentitiesPayload;
exports.listAgentIdentities = listAgentIdentities;
exports.getAgentIdentity = getAgentIdentity;
exports.createAgentIdentity = createAgentIdentity;
exports.updateAgentIdentity = updateAgentIdentity;
const errors_js_1 = require("./errors.js");
const enc = encodeURIComponent;
/**
 * The identities this caller may SEE, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves, and that is the pre-existing contract every
 * caller rides. An unrecognised value never reaches here — the MCP arg is an
 * enum and the route answers 400 — so this function never has to decide what a
 * misspelling means.
 */
async function listAgentIdentitiesPayload(t, opts = {}) {
    const qs = opts.shelf ? `?shelf=${enc(opts.shelf)}` : "";
    return t.request(`/api/agent-identities${qs}`, {
        toolName: "agent_list_identities",
    });
}
/** The rows alone. ⚠ DELEGATES to {@link listAgentIdentitiesPayload} — one HTTP
 *  call either way, and one place that knows the URL. */
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
    // Optimistic concurrency, tri-state on `expectedVersion` — the SAME three
    // arms as `knowledge.ts › writeKbFileByPath` and `skills.ts ›
    // writeSkillBody`, which is what "matching the KB contract" means:
    //   - string    → atomic compare-and-swap (`X-Updated-At`; 412 on mismatch).
    //   - undefined → strict: REFUSED. An identity update always overwrites
    //                 something — there is no create arm here, which is why this
    //                 branch needs no existence probe where the KB one does.
    //   - null      → force: blind overwrite, no precondition.
    // ⚠ THE STRICTNESS IS CLIENT-SIDE ON PURPOSE. The route still accepts an
    // absent header, so a desktop in the field whose bundled client predates this
    // argument keeps its old last-writer-wins behaviour instead of losing the op
    // to a 412 it cannot satisfy.
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
