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
    async listCanvasPanels() {
        const res = await this.transport.request("/api/canvas/panels", { toolName: "canvas_list_panels" });
        return res.panels;
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
    async connectWorkflow(idOrSlug, from, to) {
        await this.transport.requestNoContent(`/api/workflows/${encodeURIComponent(idOrSlug)}/edges`, "POST", "connect_workflow", { from, to });
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
     * via `setWorkspaceId(...)` or `X-Workspace-Id`. Used by the MCP server's
     * startup handshake to confirm the requested workspace exists and the
     * caller is a member.
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
    async listPacks() {
        return this.transport.request("/api/knowledge/packs", {
            toolName: "kb_list_packs",
        });
    }
    async kbList(pack, opts = {}) {
        const qs = new URLSearchParams();
        if (opts.category)
            qs.set("category", opts.category);
        if (opts.limit)
            qs.set("limit", String(opts.limit));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return this.transport.request(`/api/knowledge/packs/${encodeURIComponent(pack)}/files${suffix}`, { toolName: "kb_list" });
    }
    async kbGet(pack, path) {
        return this.transport.request(`/api/knowledge/packs/${encodeURIComponent(pack)}/file?path=${encodeURIComponent(path)}`, { toolName: "kb_get" });
    }
    // ─── User knowledge bases (Item 4) ────────────────────────────────
    // Distinct from Dopl knowledge packs above: these are user-authored,
    // editable knowledge bases. Path-based methods accept a base id and
    // a "/"-separated path; the server resolves to folder/entry rows.
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
    createKbFolderByPath(baseId, path) {
        return kb.createKbFolderByPath(this.transport, baseId, path);
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
    createOntologyObject(input) {
        return ontology.createOntologyObject(this.transport, input);
    }
    updateOntologyObject(objectId, patch) {
        return ontology.updateOntologyObject(this.transport, objectId, patch);
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
