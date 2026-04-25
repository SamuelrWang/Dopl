"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClient = exports.parseRetryAfter = void 0;
const transport_js_1 = require("./transport.js");
var retry_js_1 = require("./retry.js");
Object.defineProperty(exports, "parseRetryAfter", { enumerable: true, get: function () { return retry_js_1.parseRetryAfter; } });
const PENDING_CACHE_TTL_MS = 5_000;
class DoplClient {
    transport;
    pendingCache = null;
    constructor(baseUrl, apiKey, opts = {}) {
        this.transport = new transport_js_1.DoplTransport(baseUrl, apiKey, opts);
    }
    getBaseUrl() {
        return this.transport.getBaseUrl();
    }
    entryUrl(slug) {
        if (!slug)
            return null;
        return `${this.getBaseUrl()}/e/${encodeURIComponent(slug)}`;
    }
    async searchSetups(params) {
        return this.transport.request("/api/query", {
            method: "POST",
            toolName: "search_setups",
            body: {
                query: params.query,
                filters: { tags: params.tags, use_case: params.use_case },
                max_results: params.max_results ?? 5,
            },
        });
    }
    async getSetup(id) {
        return this.transport.request(`/api/entries/${id}`, {
            toolName: "get_setup",
        });
    }
    async describeLink(url) {
        return this.transport.request("/api/links/describe", {
            method: "POST",
            body: { url },
            toolName: "describe_link",
        });
    }
    async getIngestContent(entryId, sourceUrl) {
        const qs = sourceUrl ? `?source_url=${encodeURIComponent(sourceUrl)}` : "";
        return this.transport.request(`/api/ingest/content/${encodeURIComponent(entryId)}${qs}`, { toolName: "get_ingest_content" });
    }
    async buildSolution(params) {
        return this.transport.request("/api/build", {
            method: "POST",
            toolName: "build_solution",
            body: {
                brief: params.brief,
                constraints: {
                    preferred_tools: params.preferred_tools,
                    excluded_tools: params.excluded_tools,
                    max_complexity: params.max_complexity,
                },
            },
        });
    }
    async listSetups(params) {
        const query = new URLSearchParams();
        query.set("status", "complete");
        if (params?.use_case)
            query.set("use_case", params.use_case);
        if (params?.complexity)
            query.set("complexity", params.complexity);
        if (params?.limit)
            query.set("limit", String(params.limit));
        if (params?.offset)
            query.set("offset", String(params.offset));
        return this.transport.request(`/api/entries?${query.toString()}`, { toolName: "list_setups" });
    }
    async listCanvasPanels() {
        const res = await this.transport.request("/api/canvas/panels", { toolName: "canvas_list_panels" });
        return res.panels;
    }
    async addCanvasPanel(entryId) {
        return this.transport.request("/api/canvas/panels", {
            method: "POST",
            toolName: "canvas_add_entry",
            body: { entry_id: entryId },
        });
    }
    async removeCanvasPanel(entryId) {
        await this.transport.requestNoContent(`/api/canvas/panels/${encodeURIComponent(entryId)}`, "DELETE", "canvas_remove_entry");
    }
    async createCluster(name, entryIds) {
        return this.transport.request("/api/clusters", {
            method: "POST",
            toolName: "canvas_create_cluster",
            body: { name, entry_ids: entryIds },
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
    async queryCluster(slug, query, maxResults) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}/query`, {
            method: "POST",
            toolName: "query_cluster",
            body: { query, max_results: maxResults ?? 5 },
        });
    }
    async pingMcpStatus() {
        const res = await this.transport.request("/api/user/mcp-status", { method: "POST", toolName: "_mcp_status_ping", body: {} });
        return { is_admin: res.is_admin === true };
    }
    async getClusterBrain(slug) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}/brain`, { toolName: "get_cluster_brain" });
    }
    async saveClusterMemory(slug, content) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
            method: "POST",
            toolName: "save_cluster_memory",
            body: { content },
        });
    }
    async getSkillTemplate() {
        return this.transport.request("/api/cluster/synthesize", {
            method: "GET",
            toolName: "get_skill_template",
        });
    }
    async updateClusterBrain(slug, instructions) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}/brain`, {
            method: "PATCH",
            toolName: "_update_cluster_brain",
            body: { instructions },
        });
    }
    async prepareIngest(url, content) {
        const result = await this.transport.request("/api/ingest/prepare", {
            method: "POST",
            toolName: "prepare_ingest",
            body: { url, content: content || {} },
            timeoutMs: 120_000,
        });
        this.invalidatePendingCache();
        return result;
    }
    async getPendingStatus() {
        const now = Date.now();
        if (this.pendingCache && now - this.pendingCache.ts < PENDING_CACHE_TTL_MS) {
            return this.pendingCache.data;
        }
        try {
            const data = await this.transport.request("/api/ingest/pending", { toolName: "_pending_status" });
            this.pendingCache = { ts: now, data };
            return data;
        }
        catch {
            const empty = { pending_ingestions: 0, recent: [] };
            this.pendingCache = { ts: now, data: empty };
            return empty;
        }
    }
    invalidatePendingCache() {
        this.pendingCache = null;
    }
    async submitIngestedEntry(input) {
        return this.transport.request("/api/ingest/submit", {
            method: "POST",
            toolName: "submit_ingested_entry",
            body: input,
            timeoutMs: 120_000,
        });
    }
    async skeletonIngest(url) {
        return this.transport.request("/api/admin/skeleton-ingest", {
            method: "POST",
            toolName: "skeleton_ingest",
            body: { url },
            timeoutMs: 60_000,
        });
    }
    async updateCluster(slug, updates) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            toolName: "update_cluster",
            body: updates,
        });
    }
    async renameChat(panelId, title) {
        await this.transport.request(`/api/canvas/panels/${encodeURIComponent(panelId)}`, {
            method: "PATCH",
            toolName: "rename_chat",
            body: { title },
        });
    }
    async deleteCluster(slug) {
        await this.transport.requestNoContent(`/api/clusters/${encodeURIComponent(slug)}`, "DELETE", "delete_cluster");
    }
    async updateClusterMemory(slug, memoryId, content) {
        return this.transport.request(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
            method: "PATCH",
            toolName: "update_cluster_memory",
            body: { memory_id: memoryId, content },
        });
    }
    async deleteClusterMemory(slug, memoryId) {
        await this.transport.requestNoContent(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, "DELETE", "delete_cluster_memory", { memory_id: memoryId });
    }
    async updateEntry(id, updates) {
        return this.transport.request(`/api/entries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            toolName: "update_entry",
            body: updates,
        });
    }
    async checkEntryUpdates(id) {
        return this.transport.request(`/api/entries/${encodeURIComponent(id)}/check-updates`, { toolName: "check_entry_updates" });
    }
    async deleteEntry(id) {
        await this.transport.requestNoContent(`/api/entries/${encodeURIComponent(id)}`, "DELETE", "delete_entry");
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
}
exports.DoplClient = DoplClient;
