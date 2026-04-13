"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIEClient = void 0;
class SIEClient {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
    }
    async request(path, options = {}) {
        const { method = "GET", body } = options;
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`SIE API error ${res.status}: ${text}`);
        }
        return res.json();
    }
    async searchSetups(params) {
        return this.request("/api/query", {
            method: "POST",
            body: {
                query: params.query,
                filters: {
                    tags: params.tags,
                    use_case: params.use_case,
                },
                max_results: params.max_results ?? 5,
                include_synthesis: params.include_synthesis ?? true,
            },
        });
    }
    async getSetup(id) {
        return this.request(`/api/entries/${id}`);
    }
    async buildSolution(params) {
        return this.request("/api/build", {
            method: "POST",
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
        return this.request(`/api/entries?${query.toString()}`);
    }
    // ── Canvas methods ───────────────────────────────────────────────────
    async listCanvasPanels() {
        const res = await this.request("/api/canvas/panels");
        return res.panels;
    }
    async addCanvasPanel(entryId) {
        return this.request("/api/canvas/panels", {
            method: "POST",
            body: { entry_id: entryId },
        });
    }
    async removeCanvasPanel(entryId) {
        const res = await fetch(`${this.baseUrl}/api/canvas/panels/${encodeURIComponent(entryId)}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        });
        if (!res.ok && res.status !== 204) {
            const text = await res.text();
            throw new Error(`SIE API error ${res.status}: ${text}`);
        }
    }
    async createCluster(name, entryIds) {
        return this.request("/api/clusters", {
            method: "POST",
            body: { name, entry_ids: entryIds },
        });
    }
    // ── Cluster methods ──────────────────────────────────────────────────
    async listClusters() {
        return this.request("/api/clusters");
    }
    async getCluster(slug) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}`);
    }
    async queryCluster(slug, query, maxResults) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/query`, {
            method: "POST",
            body: { query, max_results: maxResults ?? 5 },
        });
    }
}
exports.SIEClient = SIEClient;
