"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClient = void 0;
const errors_js_1 = require("./errors.js");
const PENDING_CACHE_TTL_MS = 5_000;
class DoplClient {
    baseUrl;
    apiKey;
    pendingCache = null;
    toolHeaderName;
    constructor(baseUrl, apiKey, opts = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    entryUrl(slug) {
        if (!slug)
            return null;
        return `${this.baseUrl}/e/${encodeURIComponent(slug)}`;
    }
    buildHeaders(toolName, withJsonBody = true) {
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
        };
        if (withJsonBody)
            headers["Content-Type"] = "application/json";
        if (toolName)
            headers[this.toolHeaderName] = toolName;
        return headers;
    }
    async request(path, options = {}) {
        const { method = "GET", body, timeoutMs = 30_000, toolName } = options;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.buildHeaders(toolName),
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
            return (await res.json());
        }
        catch (error) {
            if (error instanceof errors_js_1.DoplApiError)
                throw error;
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new errors_js_1.DoplTimeoutError(method, path, timeoutMs);
            }
            throw new errors_js_1.DoplNetworkError(error instanceof Error ? error.message : String(error), error);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async searchSetups(params) {
        return this.request("/api/query", {
            method: "POST",
            toolName: "search_setups",
            body: {
                query: params.query,
                filters: {
                    tags: params.tags,
                    use_case: params.use_case,
                },
                max_results: params.max_results ?? 5,
            },
        });
    }
    async getSetup(id) {
        return this.request(`/api/entries/${id}`, { toolName: "get_setup" });
    }
    async describeLink(url) {
        return this.request("/api/links/describe", {
            method: "POST",
            body: { url },
            toolName: "describe_link",
        });
    }
    async getIngestContent(entryId, sourceUrl) {
        const qs = sourceUrl ? `?source_url=${encodeURIComponent(sourceUrl)}` : "";
        return this.request(`/api/ingest/content/${encodeURIComponent(entryId)}${qs}`, {
            toolName: "get_ingest_content",
        });
    }
    async buildSolution(params) {
        return this.request("/api/build", {
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
        return this.request(`/api/entries?${query.toString()}`, {
            toolName: "list_setups",
        });
    }
    async listCanvasPanels() {
        const res = await this.request("/api/canvas/panels", {
            toolName: "canvas_list_panels",
        });
        return res.panels;
    }
    async addCanvasPanel(entryId) {
        return this.request("/api/canvas/panels", {
            method: "POST",
            toolName: "canvas_add_entry",
            body: { entry_id: entryId },
        });
    }
    async removeCanvasPanel(entryId) {
        await this.requestNoContent(`/api/canvas/panels/${encodeURIComponent(entryId)}`, "DELETE", "canvas_remove_entry");
    }
    async createCluster(name, entryIds) {
        return this.request("/api/clusters", {
            method: "POST",
            toolName: "canvas_create_cluster",
            body: { name, entry_ids: entryIds },
        });
    }
    async listClusters() {
        return this.request("/api/clusters", {
            toolName: "list_clusters",
        });
    }
    async getCluster(slug) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}`, { toolName: "get_cluster" });
    }
    async queryCluster(slug, query, maxResults) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/query`, {
            method: "POST",
            toolName: "query_cluster",
            body: { query, max_results: maxResults ?? 5 },
        });
    }
    async pingMcpStatus() {
        const res = await this.request("/api/user/mcp-status", {
            method: "POST",
            toolName: "_mcp_status_ping",
            body: {},
        });
        return { is_admin: res.is_admin === true };
    }
    async getClusterBrain(slug) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain`, { toolName: "get_cluster_brain" });
    }
    async saveClusterMemory(slug, content) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
            method: "POST",
            toolName: "save_cluster_memory",
            body: { content },
        });
    }
    async getSkillTemplate() {
        return this.request("/api/cluster/synthesize", {
            method: "GET",
            toolName: "get_skill_template",
        });
    }
    async updateClusterBrain(slug, instructions) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain`, {
            method: "PATCH",
            toolName: "_update_cluster_brain",
            body: { instructions },
        });
    }
    async prepareIngest(url, content) {
        const result = await this.request("/api/ingest/prepare", {
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
        if (this.pendingCache &&
            now - this.pendingCache.ts < PENDING_CACHE_TTL_MS) {
            return this.pendingCache.data;
        }
        try {
            const data = await this.request("/api/ingest/pending", {
                toolName: "_pending_status",
            });
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
        return this.request("/api/ingest/submit", {
            method: "POST",
            toolName: "submit_ingested_entry",
            body: input,
            timeoutMs: 120_000,
        });
    }
    async skeletonIngest(url) {
        return this.request("/api/admin/skeleton-ingest", {
            method: "POST",
            toolName: "skeleton_ingest",
            body: { url },
            timeoutMs: 60_000,
        });
    }
    async updateCluster(slug, updates) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            toolName: "update_cluster",
            body: updates,
        });
    }
    async renameChat(panelId, title) {
        await this.request(`/api/canvas/panels/${encodeURIComponent(panelId)}`, {
            method: "PATCH",
            toolName: "rename_chat",
            body: { title },
        });
    }
    async deleteCluster(slug) {
        await this.requestNoContent(`/api/clusters/${encodeURIComponent(slug)}`, "DELETE", "delete_cluster");
    }
    async updateClusterMemory(slug, memoryId, content) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
            method: "PATCH",
            toolName: "update_cluster_memory",
            body: { memory_id: memoryId, content },
        });
    }
    async deleteClusterMemory(slug, memoryId) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
                method: "DELETE",
                headers: this.buildHeaders("delete_cluster_memory"),
                body: JSON.stringify({ memory_id: memoryId }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new errors_js_1.DoplApiError(res.status, text);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async updateEntry(id, updates) {
        return this.request(`/api/entries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            toolName: "update_entry",
            body: updates,
        });
    }
    async checkEntryUpdates(id) {
        return this.request(`/api/entries/${encodeURIComponent(id)}/check-updates`, {
            toolName: "check_entry_updates",
        });
    }
    async deleteEntry(id) {
        await this.requestNoContent(`/api/entries/${encodeURIComponent(id)}`, "DELETE", "delete_entry");
    }
    async listPacks() {
        return this.request("/api/knowledge/packs", {
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
        return this.request(`/api/knowledge/packs/${encodeURIComponent(pack)}/files${suffix}`, { toolName: "kb_list" });
    }
    async kbGet(pack, path) {
        return this.request(`/api/knowledge/packs/${encodeURIComponent(pack)}/file?path=${encodeURIComponent(path)}`, { toolName: "kb_get" });
    }
    async requestNoContent(path, method, toolName) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.buildHeaders(toolName, false),
                signal: controller.signal,
            });
            if (!res.ok && res.status !== 204) {
                const text = await res.text();
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.DoplClient = DoplClient;
