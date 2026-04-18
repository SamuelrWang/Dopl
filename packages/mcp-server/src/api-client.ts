import type {
  SearchResult,
  BuildResult,
  ListResult,
  DoplEntry,
  ClusterRow,
  ClusterDetail,
  ClusterQueryResult,
  CanvasPanel,
  PrepareIngestResult,
  SubmitIngestedEntryInput,
  SubmitIngestedEntryResult,
  PendingStatus,
} from "./types.js";

/**
 * How long a successful pending-status fetch is reused without hitting the
 * backend. The MCP server appends `_dopl_status` to every tool response,
 * so a chatty agent firing 5+ tools in a turn coalesces down to ~1 call.
 * `invalidatePendingCache()` is called by `prepareIngest` so the moment
 * an agent claims a pending row, the footer is up-to-date on the next
 * tool response.
 */
const PENDING_CACHE_TTL_MS = 5_000;

export class DoplClient {
  private baseUrl: string;
  private apiKey: string;
  private pendingCache: { ts: number; data: PendingStatus } | null = null;

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
      },
    });
  }

  async getSetup(id: string): Promise<DoplEntry> {
    return this.request<DoplEntry>(`/api/entries/${id}`, { toolName: "get_setup" });
  }

  /**
   * Fetch extracted content for an in-progress (or completed) ingestion.
   * The prepare_ingest response no longer inlines `gathered_content` — the
   * agent calls this between prepare and submit to retrieve the body it
   * substitutes into prompt `{ALL_RAW_CONTENT}` / `{POST_TEXT}` slots.
   *
   * Passing `sourceUrl` restricts the response to one extracted source
   * (e.g. just the README for the content_type classifier), which keeps
   * per-prompt token cost down for large repos.
   */
  async getIngestContent(
    entryId: string,
    sourceUrl?: string
  ): Promise<{
    entry_id: string;
    source_url: string | null;
    content: string;
    chars: number;
    truncated: boolean;
  }> {
    const qs = sourceUrl ? `?source_url=${encodeURIComponent(sourceUrl)}` : "";
    return this.request(`/api/ingest/content/${encodeURIComponent(entryId)}${qs}`, {
      toolName: "get_ingest_content",
    });
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

  async pingMcpStatus(): Promise<{ is_admin: boolean }> {
    const res = await this.request<{ ok: boolean; is_admin?: boolean }>(
      "/api/user/mcp-status",
      {
        method: "POST",
        toolName: "_mcp_status_ping",
        body: {},
      }
    );
    return { is_admin: res.is_admin === true };
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

  /**
   * Fetch the canonical skill synthesis prompt + body template. Replaces
   * the old synthesizeBrain() method — all brain generation now happens
   * in the user's Claude Code (not on our server), so the client's job
   * is to grab the prompt and run synthesis locally.
   */
  async getSkillTemplate(): Promise<{
    version: string;
    prompt: string;
    template: string;
    payload: string;
  }> {
    return this.request<{ version: string; prompt: string; template: string; payload: string }>(
      "/api/cluster/synthesize",
      {
        method: "GET",
        toolName: "get_skill_template",
      }
    );
  }

  async updateClusterBrain(
    slug: string,
    instructions: string
  ): Promise<{
    id?: string;
    cluster_id?: string;
    instructions?: string;
    structure_warning?: {
      message: string;
      missing_sections: string[];
      suggestion: string;
    } | null;
  }> {
    return this.request<{
      id?: string;
      cluster_id?: string;
      instructions?: string;
      structure_warning?: {
        message: string;
        missing_sections: string[];
        suggestion: string;
      } | null;
    }>(
      `/api/clusters/${encodeURIComponent(slug)}/brain`,
      {
        method: "PATCH",
        toolName: "_update_cluster_brain",
        body: { instructions },
      }
    );
  }

  // ── Ingestion ─────────────────────────────────────────────────────
  //
  // The legacy `ingestUrl()` method (POST /api/ingest) has been removed.
  // All regular ingestion goes through `prepareIngest()` + `submitIngestedEntry()`
  // — no server-side Claude. Admin skeleton ingest uses `skeletonIngest()`.

  /**
   * Agent-driven ingest, step 1/2. Server fetches + extracts; we get back
   * the raw content and the prompts to run locally. Pair with
   * `submitIngestedEntry` once the agent has generated the artifacts.
   * Longer timeout because link-following can fetch many pages.
   */
  async prepareIngest(
    url: string,
    content?: { text?: string; images?: string[]; links?: string[] }
  ): Promise<PrepareIngestResult> {
    const result = await this.request<PrepareIngestResult>("/api/ingest/prepare", {
      method: "POST",
      toolName: "prepare_ingest",
      body: { url, content: content || {} },
      timeoutMs: 120_000,
    });
    // If this prepare just claimed a pending skeleton (or created a new
    // processing row), the pending count is now stale. Bust the cache so
    // the next tool response's footer reflects reality.
    this.invalidatePendingCache();
    return result;
  }

  // ── Pending-ingestion status ──────────────────────────────────────
  //
  // Read by the `withDoplStatus` wrapper in server.ts — it appends a
  // `_dopl_status` footer to every tool response so the connected agent
  // notices queued URLs on its next tool call.

  async getPendingStatus(): Promise<PendingStatus> {
    const now = Date.now();
    if (
      this.pendingCache &&
      now - this.pendingCache.ts < PENDING_CACHE_TTL_MS
    ) {
      return this.pendingCache.data;
    }
    try {
      const data = await this.request<PendingStatus>("/api/ingest/pending", {
        toolName: "_pending_status",
      });
      this.pendingCache = { ts: now, data };
      return data;
    } catch {
      // Never block a tool call on the status fetch failing. If the
      // endpoint is down or the user has no pending entries, just
      // return an empty snapshot so the wrapper omits the footer.
      const empty: PendingStatus = { pending_ingestions: 0, recent: [] };
      this.pendingCache = { ts: now, data: empty };
      return empty;
    }
  }

  invalidatePendingCache(): void {
    this.pendingCache = null;
  }

  /**
   * Agent-driven ingest, step 2/2. Submits the artifacts the agent generated;
   * server embeds + persists. Synchronous — returns once the entry is
   * status="complete".
   */
  async submitIngestedEntry(
    input: SubmitIngestedEntryInput
  ): Promise<SubmitIngestedEntryResult> {
    return this.request<SubmitIngestedEntryResult>("/api/ingest/submit", {
      method: "POST",
      toolName: "submit_ingested_entry",
      body: input,
      // Embeddings + DB writes can take 30–60s for large entries (50 chunks
      // × 10-batch through OpenAI + tag inserts + slug retry loop).
      // 120s leaves headroom for the worst case.
      timeoutMs: 120_000,
    });
  }

  /**
   * Admin-only skeleton ingestion — runs the cheap descriptor pipeline
   * against a public GitHub repo. Non-admin API keys get 404 from the
   * backend (admin surfaces are non-enumerable). Uses the existing
   * withAdminAuth gate in src/lib/auth/with-auth.ts, which reads
   * ADMIN_USER_ID.
   */
  async skeletonIngest(
    url: string
  ): Promise<{ entry_id: string; slug: string | null; status: string; tier?: string; title?: string | null }> {
    return this.request<{ entry_id: string; slug: string | null; status: string; tier?: string; title?: string | null }>(
      "/api/admin/skeleton-ingest",
      {
        method: "POST",
        toolName: "skeleton_ingest",
        body: { url },
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

  /**
   * Rename a chat panel on the user's canvas. Wraps the generic panels
   * PATCH endpoint so the agent has a purpose-named tool.
   */
  async renameChat(panelId: string, title: string): Promise<void> {
    await this.request<unknown>(
      `/api/canvas/panels/${encodeURIComponent(panelId)}`,
      {
        method: "PATCH",
        toolName: "rename_chat",
        body: { title },
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
