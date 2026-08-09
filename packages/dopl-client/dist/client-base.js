"use strict";
/**
 * THE FIRST LINK of `DoplClient`'s per-domain method-group chain — §2's
 * scheduled remedy for the facade's size, finally built.
 *
 * The shape: this class owns construction and the transport-level accessors,
 * and NOTHING else. Each domain then contributes one `client-<domain>.ts`
 * method group that extends the previous link, and `client.ts` is the
 * terminal `DoplClient` that extends the last one. The chain is what keeps
 * every file under the 500-line cap while `DoplClient` stays a SINGLE class
 * with one flat, unchanged public surface — callers (`@dopl/mcp-server`, the
 * app) see exactly the methods they saw when they all lived in `client.ts`.
 *
 * THE CHAIN, in order — this is the only place the whole order is written
 * down, and each link names only its own predecessor:
 *
 *   DoplClientBase        (here)
 *     → WorkspaceMethods  client-workspaces.ts
 *     → ClusterMethods    client-clusters.ts
 *     → WorkflowMethods   client-workflows.ts
 *     → KnowledgeMethods  client-knowledge.ts
 *     → OntologyMethods   client-ontology.ts
 *     → ChatMethods       client-chats.ts
 *     → MemberMethods     client-members.ts
 *     → ChannelMethods    client-channels.ts
 *     → SkillMethods      client-skills.ts
 *     → DoplClient        client.ts
 *
 * The order carries NO meaning — no link may depend on a sibling's methods,
 * only on `this.transport`. Inserting a domain means editing two files (the
 * new link and the one that used to extend its predecessor) and this comment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClientBase = void 0;
const transport_js_1 = require("./transport.js");
class DoplClientBase {
    /**
     * PROTECTED, not private, and it stays that way: it is the hook every
     * per-domain method group in the chain above reads. There was one such link
     * before — `ChannelAgentsClient`, holding the channel agents + thread
     * participants group — and it went with those surfaces (channels rollback
     * §1), which left the class extending nothing until this file.
     */
    transport;
    constructor(baseUrl, apiKey, opts = {}) {
        this.transport = new transport_js_1.DoplTransport(baseUrl, apiKey, opts);
    }
    getBaseUrl() {
        return this.transport.getBaseUrl();
    }
    /**
     * Active canvas (workspace) for this client. When set, every request
     * carries an `X-Workspace-Id` header so the server scopes data
     * accordingly. Set null to clear.
     */
    setWorkspaceId(workspaceId) {
        this.transport.setWorkspaceId(workspaceId);
    }
    getWorkspaceId() {
        return this.transport.getWorkspaceId();
    }
}
exports.DoplClientBase = DoplClientBase;
