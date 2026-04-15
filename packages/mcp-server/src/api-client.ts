import type {
  SearchResult,
  BuildResult,
  ListResult,
  DoplEntry,
  ClusterRow,
  ClusterDetail,
  ClusterQueryResult,
  CanvasPanel,
} from "./types.js";

export class DoplClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; timeoutMs?: number } = {}
  ): Promise<T> {
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
        throw new Error(`Dopl API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<T>;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Dopl API request timed out after ${timeoutMs}ms: ${method} ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchSetups(params: {
    query: string;
    tags?: string[];
    use_case?: string;
    max_results?: number;
    include_synthesis?: boolean;
  }): Promise<SearchResult> {
    return this.request<SearchResult>("/api/query", {
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

  async getSetup(id: string): Promise<DoplEntry> {
    return this.request<DoplEntry>(`/api/entries/${id}`);
  }

  async buildSolution(params: {
    brief: string;
    preferred_tools?: string[];
    excluded_tools?: string[];
    max_complexity?: string;
  }): Promise<BuildResult> {
    return this.request<BuildResult>("/api/build", {
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

  async listSetups(params?: {
    use_case?: string;
    complexity?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListResult> {
    const query = new URLSearchParams();
    query.set("status", "complete");
    if (params?.use_case) query.set("use_case", params.use_case);
    if (params?.complexity) query.set("complexity", params.complexity);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    return this.request<ListResult>(`/api/entries?${query.toString()}`);
  }

  // ── Canvas methods ───────────────────────────────────────────────────

  async listCanvasPanels(): Promise<CanvasPanel[]> {
    const res = await this.request<{ panels: CanvasPanel[] }>("/api/canvas/panels");
    return res.panels;
  }

  async addCanvasPanel(entryId: string): Promise<{ panel: CanvasPanel; created: boolean }> {
    return this.request<{ panel: CanvasPanel; created: boolean }>("/api/canvas/panels", {
      method: "POST",
      body: { entry_id: entryId },
    });
  }

  async removeCanvasPanel(entryId: string): Promise<void> {
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
        throw new Error(`Dopl API error ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async createCluster(name: string, entryIds: string[]): Promise<ClusterRow> {
    return this.request<ClusterRow>("/api/clusters", {
      method: "POST",
      body: { name, entry_ids: entryIds },
    });
  }

  // ── Cluster methods ──────────────────────────────────────────────────

  async listClusters(): Promise<{ clusters: ClusterRow[] }> {
    return this.request<{ clusters: ClusterRow[] }>("/api/clusters");
  }

  async getCluster(slug: string): Promise<ClusterDetail> {
    return this.request<ClusterDetail>(
      `/api/clusters/${encodeURIComponent(slug)}`
    );
  }

  async queryCluster(
    slug: string,
    query: string,
    maxResults?: number
  ): Promise<ClusterQueryResult> {
    return this.request<ClusterQueryResult>(
      `/api/clusters/${encodeURIComponent(slug)}/query`,
      {
        method: "POST",
        body: { query, max_results: maxResults ?? 5 },
      }
    );
  }

  // ── MCP status ping ────────────────────────────────────────────────

  async pingMcpStatus(): Promise<void> {
    await this.request<{ ok: boolean }>("/api/user/mcp-status", {
      method: "POST",
      body: {},
    });
  }

  // ── Cluster brain methods ─────────────────────────────────────────

  async getClusterBrain(slug: string): Promise<{ instructions: string; memories: { id: string; content: string }[] }> {
    return this.request<{ instructions: string; memories: { id: string; content: string }[] }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain`
    );
  }

  async saveClusterMemory(slug: string, content: string): Promise<{ id: string; content: string }> {
    return this.request<{ id: string; content: string }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain/memories`,
      {
        method: "POST",
        body: { content },
      }
    );
  }

  async synthesizeBrain(
    entries: Array<{ title: string; agents_md: string; readme: string }>
  ): Promise<{ instructions: string }> {
    return this.request<{ instructions: string }>("/api/cluster/synthesize", {
      method: "POST",
      body: { entries },
      timeoutMs: 120_000, // Synthesis can take a while
    });
  }

  async updateClusterBrain(slug: string, instructions: string): Promise<void> {
    await this.request<unknown>(
      `/api/clusters/${encodeURIComponent(slug)}/brain`,
      {
        method: "PATCH",
        body: { instructions },
      }
    );
  }

  // ── Ingestion ─────────────────────────────────────────────────────

  async ingestUrl(
    url: string,
    content?: { text?: string; images?: string[]; links?: string[] }
  ): Promise<{ entry_id: string; status: string; stream_url?: string; title?: string | null }> {
    return this.request<{ entry_id: string; status: string; stream_url?: string; title?: string | null }>(
      "/api/ingest",
      {
        method: "POST",
        body: { url, content: content || {} },
        timeoutMs: 60_000,
      }
    );
  }

  // ── Cluster mutations ─────────────────────────────────────────────

  async updateCluster(
    slug: string,
    updates: { name?: string; entry_ids?: string[] }
  ): Promise<ClusterRow> {
    return this.request<ClusterRow>(
      `/api/clusters/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        body: updates,
      }
    );
  }

  async deleteCluster(slug: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        }
      );
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`Dopl API error ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Brain read + memory delete ────────────────────────────────────

  async deleteClusterMemory(slug: string, memoryId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}/brain/memories`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ memory_id: memoryId }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dopl API error ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Entry mutations ───────────────────────────────────────────────

  async updateEntry(
    id: string,
    updates: { title?: string; summary?: string; use_case?: string; complexity?: string }
  ): Promise<DoplEntry> {
    return this.request<DoplEntry>(`/api/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: updates,
    });
  }

  async checkEntryUpdates(id: string): Promise<{
    entry_id: string;
    title: string | null;
    has_updates: boolean | null;
    reason?: string;
    ingested_at?: string;
    last_pushed_at?: string;
    days_since_ingestion?: number;
    days_since_push?: number;
    repo?: string;
  }> {
    return this.request(`/api/entries/${encodeURIComponent(id)}/check-updates`);
  }

  // ── Incremental synthesis ─────────────────────────────────────────

  async synthesizeIncremental(
    existingInstructions: string,
    newEntry: { title: string; agents_md: string; readme: string }
  ): Promise<{ instructions: string }> {
    return this.request<{ instructions: string }>("/api/cluster/synthesize-incremental", {
      method: "POST",
      body: { existing_instructions: existingInstructions, new_entry: newEntry },
      timeoutMs: 120_000,
    });
  }

  async deleteEntry(id: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/entries/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dopl API error ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
