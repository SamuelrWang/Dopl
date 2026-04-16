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

  /**
   * Public URL for an entry. The server hands this to AI clients instead of
   * leaking the internal UUID — the AI hyperlinks this in prose, and the
   * user sees a clean /e/<slug> URL.
   *
   * Returns null if no slug is available (extremely rare — the schema
   * guarantees every row has a slug, but MCP is called against older
   * backends during the cutover).
   */
  entryUrl(slug: string | null | undefined): string | null {
    if (!slug) return null;
    return `${this.baseUrl}/e/${encodeURIComponent(slug)}`;
  }

  /**
   * Build request headers, including the X-MCP-Tool header when a tool name
   * is provided. The API layer (`withMcpCredits` in src/lib/auth/with-auth.ts)
   * reads this header to record the MCP tool name in the `mcp_events`
   * analytics table. Without it, analytics would only see the HTTP endpoint,
   * which doesn't always map 1:1 to a tool name.
   */
  private buildHeaders(toolName?: string, withJsonBody = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (withJsonBody) headers["Content-Type"] = "application/json";
    if (toolName) headers["X-MCP-Tool"] = toolName;
    return headers;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; timeoutMs?: number; toolName?: string } = {}
  ): Promise<T> {
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
      toolName: "search_setups",
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
    return this.request<DoplEntry>(`/api/entries/${id}`, { toolName: "get_setup" });
  }

  async buildSolution(params: {
    brief: string;
    preferred_tools?: string[];
    excluded_tools?: string[];
    max_complexity?: string;
  }): Promise<BuildResult> {
    return this.request<BuildResult>("/api/build", {
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

    return this.request<ListResult>(`/api/entries?${query.toString()}`, {
      toolName: "list_setups",
    });
  }

  // ── Canvas methods ───────────────────────────────────────────────────

  async listCanvasPanels(): Promise<CanvasPanel[]> {
    const res = await this.request<{ panels: CanvasPanel[] }>("/api/canvas/panels", {
      toolName: "canvas_list_panels",
    });
    return res.panels;
  }

  async addCanvasPanel(entryId: string): Promise<{ panel: CanvasPanel; created: boolean }> {
    return this.request<{ panel: CanvasPanel; created: boolean }>("/api/canvas/panels", {
      method: "POST",
      toolName: "canvas_add_entry",
      body: { entry_id: entryId },
    });
  }

  async removeCanvasPanel(entryId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${this.baseUrl}/api/canvas/panels/${encodeURIComponent(entryId)}`, {
        method: "DELETE",
        headers: this.buildHeaders("canvas_remove_entry", false),
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
      toolName: "canvas_create_cluster",
      body: { name, entry_ids: entryIds },
    });
  }

  // ── Cluster methods ──────────────────────────────────────────────────

  async listClusters(): Promise<{ clusters: ClusterRow[] }> {
    return this.request<{ clusters: ClusterRow[] }>("/api/clusters", {
      toolName: "list_clusters",
    });
  }

  async getCluster(slug: string): Promise<ClusterDetail> {
    return this.request<ClusterDetail>(
      `/api/clusters/${encodeURIComponent(slug)}`,
      { toolName: "get_cluster" }
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
        toolName: "query_cluster",
        body: { query, max_results: maxResults ?? 5 },
      }
    );
  }

  // ── MCP status ping ────────────────────────────────────────────────

  async pingMcpStatus(): Promise<void> {
    await this.request<{ ok: boolean }>("/api/user/mcp-status", {
      method: "POST",
      toolName: "_mcp_status_ping",
      body: {},
    });
  }

  // ── Cluster brain methods ─────────────────────────────────────────

  async getClusterBrain(slug: string): Promise<{ instructions: string; memories: { id: string; content: string }[] }> {
    return this.request<{ instructions: string; memories: { id: string; content: string }[] }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain`,
      { toolName: "get_cluster_brain" }
    );
  }

  async saveClusterMemory(slug: string, content: string): Promise<{ id: string; content: string }> {
    return this.request<{ id: string; content: string }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain/memories`,
      {
        method: "POST",
        toolName: "save_cluster_memory",
        body: { content },
      }
    );
  }

  async synthesizeBrain(
    entries: Array<{ title: string; agents_md: string; readme: string }>
  ): Promise<{ instructions: string }> {
    return this.request<{ instructions: string }>("/api/cluster/synthesize", {
      method: "POST",
      toolName: "_cluster_synthesize",
      body: { entries },
      timeoutMs: 120_000, // Synthesis can take a while
    });
  }

  async updateClusterBrain(slug: string, instructions: string): Promise<void> {
    await this.request<unknown>(
      `/api/clusters/${encodeURIComponent(slug)}/brain`,
      {
        method: "PATCH",
        toolName: "_update_cluster_brain",
        body: { instructions },
      }
    );
  }

  // ── Ingestion ─────────────────────────────────────────────────────

  async ingestUrl(
    url: string,
    content?: { text?: string; images?: string[]; links?: string[] }
  ): Promise<{ entry_id: string; slug: string | null; status: string; stream_url?: string; title?: string | null }> {
    return this.request<{ entry_id: string; slug: string | null; status: string; stream_url?: string; title?: string | null }>(
      "/api/ingest",
      {
        method: "POST",
        toolName: "ingest_url",
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
        toolName: "update_cluster",
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
          headers: this.buildHeaders("delete_cluster", false),
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

  // ── Brain read + memory delete/edit ───────────────────────────────

  async updateClusterMemory(
    slug: string,
    memoryId: string,
    content: string
  ): Promise<{ id: string; content: string }> {
    return this.request<{ id: string; content: string }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain/memories`,
      {
        method: "PATCH",
        toolName: "update_cluster_memory",
        body: { memory_id: memoryId, content },
      }
    );
  }

  async deleteClusterMemory(slug: string, memoryId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/clusters/${encodeURIComponent(slug)}/brain/memories`,
        {
          method: "DELETE",
          headers: this.buildHeaders("delete_cluster_memory"),
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
      toolName: "update_entry",
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
    return this.request(`/api/entries/${encodeURIComponent(id)}/check-updates`, {
      toolName: "check_entry_updates",
    });
  }

  // ── Incremental synthesis ─────────────────────────────────────────

  async synthesizeIncremental(
    existingInstructions: string,
    newEntry: { title: string; agents_md: string; readme: string }
  ): Promise<{ instructions: string }> {
    return this.request<{ instructions: string }>("/api/cluster/synthesize-incremental", {
      method: "POST",
      toolName: "_cluster_synthesize_incremental",
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
          headers: this.buildHeaders("delete_entry", false),
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
