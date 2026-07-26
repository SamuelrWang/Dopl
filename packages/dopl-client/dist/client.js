"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClient = exports.parseRetryAfter = void 0;
const transport_js_1 = require("./transport.js");
const kb = __importStar(require("./knowledge.js"));
const skills = __importStar(require("./skills.js"));
const ontology = __importStar(require("./ontology.js"));
const chats = __importStar(require("./chats.js"));
const members = __importStar(require("./members.js"));
const channel = __importStar(require("./channel.js"));
var retry_js_1 = require("./retry.js");
Object.defineProperty(exports, "parseRetryAfter", { enumerable: true, get: function () { return retry_js_1.parseRetryAfter; } });
class DoplClient {
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
    async createCluster(name) {
        return this.transport.request("/api/clusters", {
            method: "POST",
            toolName: "canvas_create_cluster",
            body: { name },
        });
    }
    async listClusters() {
        return this.transport.request("/api/clusters", {
            toolName: "list_clusters",
        });
    }
    async getCluster(slug) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}`, { toolName: "get_cluster" });
    }
    // ── Workflows ────────────────────────────────────────────────────
    async listWorkflows() {
        return this.transport.request("/api/workflows", { toolName: "list_workflows" });
    }
    async getWorkflow(idOrSlug) {
        return this.transport.request(`/api/workflows/${encodeURIComponent(idOrSlug)}`, { toolName: "get_workflow" });
    }
    async createWorkflow(name) {
        return this.transport.request("/api/workflows", {
            method: "POST",
            toolName: "create_workflow",
            body: { name },
        });
    }
    async updateWorkflow(idOrSlug, updates) {
        return this.transport.request(`/api/workflows/${encodeURIComponent(idOrSlug)}`, { method: "PATCH", toolName: "update_workflow", body: updates });
    }
    async deleteWorkflow(idOrSlug) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}`, "DELETE", "delete_workflow");
    }
    /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
    async listWorkflowTrash() {
        return this.transport.request("/api/workflows/trash", { toolName: "list_workflow_trash" });
    }
    /** Restore a soft-deleted workflow (recovery, not deletion). */
    async restoreWorkflow(idOrSlug) {
        return this.transport.request(`/api/workflows/${encodeURIComponent(idOrSlug)}/restore`, { method: "POST", toolName: "restore_workflow", body: {} });
    }
    // ── Workflow graph authoring ──────────────────────────────────────
    async setWorkflowGraph(idOrSlug, spec) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/graph`, "POST", "set_workflow_graph", spec);
    }
    async addWorkflowNode(idOrSlug, node) {
        return this.transport.request(`/api/workflows/${encodeURIComponent(idOrSlug)}/nodes`, { method: "POST", toolName: "add_workflow_node", body: node });
    }
    async updateWorkflowNode(idOrSlug, nodeId, patch) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/nodes/${encodeURIComponent(nodeId)}`, "PATCH", "update_workflow_node", patch);
    }
    async removeWorkflowNode(idOrSlug, nodeId) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/nodes/${encodeURIComponent(nodeId)}`, "DELETE", "remove_workflow_node");
    }
    async connectWorkflow(idOrSlug, from, to, condition) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/edges`, "POST", "connect_workflow", { from, to, condition });
    }
    async disconnectWorkflow(idOrSlug, from, to) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/edges`, "DELETE", "disconnect_workflow", { from, to });
    }
    // ── Workspaces ────────────────────────────────────────────────────
    async listWorkspaces() {
        return this.transport.request("/api/workspaces", { toolName: "list_workspaces" });
    }
    async getWorkspace(slug) {
        return this.transport.request(`/api/workspaces/${encodeURIComponent(slug)}`, { toolName: "get_workspace" });
    }
    /**
     * Resolve the active workspace — the one currently set on the transport
     * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
     * /api/workspaces/me`. Header-less resolution now depends on the caller's
     * membership count (exactly one auto-targets; 0 or 2+ → 400
     * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
     * so this is no longer on the boot path.
     */
    async getActiveWorkspace() {
        return this.transport.request("/api/workspaces/me", {
            toolName: "get_active_workspace",
        });
    }
    async pingMcpStatus() {
        const res = await this.transport.request("/api/user/mcp-status", {
            method: "POST",
            toolName: "_mcp_status_ping",
            body: {},
        });
        return {
            is_admin: res.is_admin === true,
            user_id: typeof res.user_id === "string" ? res.user_id : null,
        };
    }
    async updateCluster(slug, updates) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            toolName: "update_cluster",
            body: updates,
        });
    }
    async deleteCluster(slug) {
        await this.transport.requestNoContent(`/api/clusters/${encodeURIComponent(slug)}`, "DELETE", "delete_cluster");
    }
    // ─── User knowledge bases (Item 4) ────────────────────────────────
    // User-authored, editable knowledge bases. Path-based methods accept
    // a base id and a "/"-separated path; the server resolves to
    // folder/entry rows.
    listKbBases() {
        return kb.listKbBases(this.transport);
    }
    getKbBase(baseId) {
        return kb.getKbBase(this.transport, baseId);
    }
    getKbTree(baseId, opts) {
        return kb.getKbTree(this.transport, baseId, opts);
    }
    createKbBase(input) {
        return kb.createKbBase(this.transport, input);
    }
    updateKbBase(baseId, patch) {
        return kb.updateKbBase(this.transport, baseId, patch);
    }
    deleteKbBase(baseId) {
        return kb.deleteKbBase(this.transport, baseId);
    }
    restoreKbBase(baseId) {
        return kb.restoreKbBase(this.transport, baseId);
    }
    readKbFileByPath(baseId, path) {
        return kb.readKbFileByPath(this.transport, baseId, path);
    }
    writeKbFileByPath(baseId, path, input = {}, expectedVersion) {
        return kb.writeKbFileByPath(this.transport, baseId, path, input, expectedVersion);
    }
    listKbDirByPath(baseId, path = "") {
        return kb.listKbDirByPath(this.transport, baseId, path);
    }
    createKbFolderByPath(baseId, path, description) {
        return kb.createKbFolderByPath(this.transport, baseId, path, description);
    }
    deleteKbByPath(baseId, path) {
        return kb.deleteKbByPath(this.transport, baseId, path);
    }
    moveKbByPath(baseId, fromPath, toPath) {
        return kb.moveKbByPath(this.transport, baseId, fromPath, toPath);
    }
    listKbTrash(baseId) {
        return kb.listKbTrash(this.transport, baseId);
    }
    restoreKbFolder(folderId) {
        return kb.restoreKbFolder(this.transport, folderId);
    }
    restoreKbEntry(entryId) {
        return kb.restoreKbEntry(this.transport, entryId);
    }
    searchKb(query, opts = {}) {
        return kb.searchKb(this.transport, query, opts);
    }
    // ─── Ontology ────────────────────────────────────────────────────────
    getOntology() {
        return ontology.getOntology(this.transport);
    }
    getOntologyAnchor() {
        return ontology.getOntologyAnchor(this.transport);
    }
    createOntologyCluster(input) {
        return ontology.createOntologyCluster(this.transport, input);
    }
    updateOntologyCluster(clusterId, patch) {
        return ontology.updateOntologyCluster(this.transport, clusterId, patch);
    }
    deleteOntologyCluster(clusterId) {
        return ontology.deleteOntologyCluster(this.transport, clusterId);
    }
    restoreOntologyCluster(clusterRef) {
        return ontology.restoreOntologyCluster(this.transport, clusterRef);
    }
    createOntologyObject(input) {
        return ontology.createOntologyObject(this.transport, input);
    }
    updateOntologyObject(objectId, patch, expectedVersion) {
        return ontology.updateOntologyObject(this.transport, objectId, patch, expectedVersion);
    }
    deleteOntologyObject(objectId) {
        return ontology.deleteOntologyObject(this.transport, objectId);
    }
    claimOntologyAnchor(objectId) {
        return ontology.claimOntologyAnchor(this.transport, objectId);
    }
    // ─── Chats (archive) ───────────────────────────────────────────────
    // Agent-exported conversation archive. Reads return the caller's own
    // chats plus workspace-public ones; writes are owner-scoped
    // server-side.
    listChats() {
        return chats.listChats(this.transport);
    }
    getChat(chatId) {
        return chats.getChat(this.transport, chatId);
    }
    exportChat(input) {
        return chats.exportChat(this.transport, input);
    }
    appendChatMessages(chatId, messages) {
        return chats.appendChatMessages(this.transport, chatId, messages);
    }
    updateChat(chatId, patch) {
        return chats.updateChat(this.transport, chatId, patch);
    }
    deleteChat(chatId) {
        return chats.deleteChat(this.transport, chatId);
    }
    restoreChat(chatId) {
        return chats.restoreChat(this.transport, chatId);
    }
    listChatsTrash() {
        return chats.listChatsTrash(this.transport);
    }
    listChatFolders() {
        return chats.listChatFolders(this.transport);
    }
    createChatFolder(name) {
        return chats.createChatFolder(this.transport, name);
    }
    updateChatFolder(folderId, patch) {
        return chats.updateChatFolder(this.transport, folderId, patch);
    }
    deleteChatFolder(folderId) {
        return chats.deleteChatFolder(this.transport, folderId);
    }
    // ─── Members / teams / access (READ-ONLY) ──────────────────────────
    // Membership, team, and access changes are human decisions made in
    // the web UI — this client deliberately exposes no write path.
    getMyMembership() {
        return members.getMyMembership(this.transport);
    }
    listWorkspaceMembers() {
        return members.listMembers(this.transport);
    }
    listWorkspaceTeams() {
        return members.listTeams(this.transport);
    }
    getAccessMatrix() {
        return members.getAccessMatrix(this.transport);
    }
    getMyAccess() {
        return members.getMyAccess(this.transport);
    }
    getMemberAccess(targetUserId) {
        return members.getMemberAccess(this.transport, targetUserId);
    }
    // ─── Channels ──────────────────────────────────────────────────────
    // Cross-user, agent-to-agent collaboration threads. Messages carry a
    // monotonic `seq` cursor; `awaitChannelMessages` long-polls for arrivals
    // past a cursor so a listener can watch a channel without busy-looping.
    listChannels(opts) {
        return channel.listChannels(this.transport, opts);
    }
    getChannel(channelId) {
        return channel.getChannel(this.transport, channelId);
    }
    createChannel(input) {
        return channel.createChannel(this.transport, input);
    }
    listChannelMembers(channelId) {
        return channel.listChannelMembers(this.transport, channelId);
    }
    inviteToChannel(channelId, userId) {
        return channel.inviteToChannel(this.transport, channelId, userId);
    }
    readChannelMessages(channelId, opts) {
        return channel.readMessages(this.transport, channelId, opts);
    }
    postChannelMessage(channelId, input) {
        return channel.postMessage(this.transport, channelId, input);
    }
    awaitChannelMessages(channelId, opts) {
        return channel.awaitMessages(this.transport, channelId, opts);
    }
    // ─── Skills ─────────────────────────────────────────────────────────
    // Read paths are unrestricted; write paths are gated server-side by
    // the per-skill `agent_write_enabled` toggle for API-key (agent)
    // callers. Skills are single-file: one SKILL.md procedure body.
    listSkills() {
        return skills.listSkills(this.transport);
    }
    getSkill(slug) {
        return skills.getSkill(this.transport, slug);
    }
    createSkill(input) {
        return skills.createSkill(this.transport, input);
    }
    updateSkill(slug, patch) {
        return skills.updateSkill(this.transport, slug, patch);
    }
    deleteSkill(slug) {
        return skills.deleteSkill(this.transport, slug);
    }
    readSkillBody(slug) {
        return skills.readSkillBody(this.transport, slug);
    }
    writeSkillBody(slug, body, expectedVersion) {
        return skills.writeSkillBody(this.transport, slug, body, expectedVersion);
    }
}
exports.DoplClient = DoplClient;
