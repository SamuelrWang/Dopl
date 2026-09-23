"use strict";
/**
 * The first link of `DoplClient`'s method-group chain (construction and transport accessors only).
 * Each `client-<domain>.ts` extends the previous link so every file stays under the 500-line cap while
 * `DoplClient` stays one class. The whole order, written only here:
 *
 *   DoplClientBase → WorkspaceMethods → KnowledgeMethods → OntologyMethods → ChatMethods →
 *   MemberMethods → ChannelMethods → SkillMethods → AgentIdentityMethods → HomeMethods →
 *   BillingMethods → DoplClient (`client.ts`)
 *
 * Order carries no meaning: a link may use only `this.transport`, never a sibling's methods.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClientBase = void 0;
const transport_js_1 = require("./transport.js");
class DoplClientBase {
    /** Protected, not private: every method group in the chain reads it. */
    transport;
    constructor(baseUrl, apiKey, opts = {}) {
        this.transport = new transport_js_1.DoplTransport(baseUrl, apiKey, opts);
    }
    getBaseUrl() {
        return this.transport.getBaseUrl();
    }
    /** Active canvas. Set → every request carries `X-Workspace-Id`. Null clears. */
    setWorkspaceId(workspaceId) {
        this.transport.setWorkspaceId(workspaceId);
    }
    getWorkspaceId() {
        return this.transport.getWorkspaceId();
    }
}
exports.DoplClientBase = DoplClientBase;
