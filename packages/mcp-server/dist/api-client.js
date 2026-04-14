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
        const { method = "GET", body, timeoutMs = 30_000 } = options;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`SIE API error ${res.status}: ${text}`);
            }
            return res.json();
        }
        catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new Error(`SIE API request timed out after ${timeoutMs}ms: ${method} ${path}`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}/api/canvas/panels/${encodeURIComponent(entryId)}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                },
                signal: controller.signal,
            });
            if (!res.ok && res.status !== 204) {
                const text = await res.text();
                throw new Error(`SIE API error ${res.status}: ${text}`);
            }
        }
        finally {
            clearTimeout(timeout);
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
    // ── MCP status ping ────────────────────────────────────────────────
    async pingMcpStatus() {
        await this.request("/api/user/mcp-status", {
            method: "POST",
            body: {},
        });
    }
    // ── Cluster brain methods ─────────────────────────────────────────
    async getClusterBrain(slug) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain`);
    }
    async saveClusterMemory(slug, content) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
            method: "POST",
            body: { content },
        });
    }
    async synthesizeBrain(entries) {
        return this.request("/api/cluster/synthesize", {
            method: "POST",
            body: { entries },
            timeoutMs: 120_000, // Synthesis can take a while
        });
    }
    async updateClusterBrain(slug, instructions) {
        await this.request(`/api/clusters/${encodeURIComponent(slug)}/brain`, {
            method: "PATCH",
            body: { instructions },
        });
    }
    // ── Ingestion ─────────────────────────────────────────────────────
    async ingestUrl(url, content) {
        return this.request("/api/ingest", {
            method: "POST",
            body: { url, content: content || {} },
            timeoutMs: 60_000,
        });
    }
    // ── Cluster mutations ─────────────────────────────────────────────
    async updateCluster(slug, updates) {
        return this.request(`/api/clusters/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            body: updates,
        });
    }
    async deleteCluster(slug) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: controller.signal,
            });
            if (!res.ok && res.status !== 204) {
                const text = await res.text();
                throw new Error(`SIE API error ${res.status}: ${text}`);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // ── Brain read + memory delete ────────────────────────────────────
    async deleteClusterMemory(slug, memoryId) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}/brain/memories`, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({ memory_id: memoryId }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`SIE API error ${res.status}: ${text}`);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // ── Entry mutations ───────────────────────────────────────────────
    async updateEntry(id, updates) {
        return this.request(`/api/entries/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: updates,
        });
    }
    async checkEntryUpdates(id) {
        return this.request(`/api/entries/${encodeURIComponent(id)}/check-updates`);
    }
    // ── Incremental synthesis ─────────────────────────────────────────
    async synthesizeIncremental(existingInstructions, newEntry) {
        return this.request("/api/cluster/synthesize-incremental", {
            method: "POST",
            body: { existing_instructions: existingInstructions, new_entry: newEntry },
            timeoutMs: 120_000,
        });
    }
    async deleteEntry(id) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
            const res = await fetch(`${this.baseUrl}/api/entries/${encodeURIComponent(id)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`SIE API error ${res.status}: ${text}`);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.SIEClient = SIEClient;
