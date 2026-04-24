import {
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
  DoplTimeoutError,
} from "./errors.js";
import type {
  BuildResult,
  CanvasPanel,
  ClusterDetail,
  ClusterQueryResult,
  ClusterRow,
  DoplEntry,
  ListResult,
  Pack,
  PackFile,
  PackFileMeta,
  PendingStatus,
  PrepareIngestResult,
  SearchResult,
  SubmitIngestedEntryInput,
  SubmitIngestedEntryResult,
} from "./types.js";

const PENDING_CACHE_TTL_MS = 5_000;

export interface DoplClientOptions {
  toolHeaderName?: string;
}

export class DoplClient {
  private baseUrl: string;
  private apiKey: string;
  private pendingCache: { ts: number; data: PendingStatus } | null = null;
  private toolHeaderName: string;

  constructor(baseUrl: string, apiKey: string, opts: DoplClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  entryUrl(slug: string | null | undefined): string | null {
    if (!slug) return null;
    return `${this.baseUrl}/e/${encodeURIComponent(slug)}`;
  }

  private buildHeaders(toolName?: string, withJsonBody = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (withJsonBody) headers["Content-Type"] = "application/json";
    if (toolName) headers[this.toolHeaderName] = toolName;
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
        if (res.status === 401 || res.status === 403) {
          throw new DoplAuthError(res.status, text);
        }
        throw new DoplApiError(res.status, text);
      }

      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof DoplApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DoplTimeoutError(method, path, timeoutMs);
      }
      throw new DoplNetworkError(
        error instanceof Error ? error.message : String(error),
        error
      );
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

  async describeLink(url: string): Promise<{
    url: string;
    type: string;
    title: string | null;
    description: string | null;
    metadata: Record<string, unknown>;
    error?: string;
  }> {
    return this.request("/api/links/describe", {
      method: "POST",
      body: { url },
      toolName: "describe_link",
    });
  }

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
    await this.requestNoContent(
      `/api/canvas/panels/${encodeURIComponent(entryId)}`,
      "DELETE",
      "canvas_remove_entry"
    );
  }

  async createCluster(name: string, entryIds: string[]): Promise<ClusterRow> {
    return this.request<ClusterRow>("/api/clusters", {
      method: "POST",
      toolName: "canvas_create_cluster",
      body: { name, entry_ids: entryIds },
    });
  }

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
    return this.request(
      `/api/clusters/${encodeURIComponent(slug)}/brain`,
      {
        method: "PATCH",
        toolName: "_update_cluster_brain",
        body: { instructions },
      }
    );
  }

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
    this.invalidatePendingCache();
    return result;
  }

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
      const empty: PendingStatus = { pending_ingestions: 0, recent: [] };
      this.pendingCache = { ts: now, data: empty };
      return empty;
    }
  }

  invalidatePendingCache(): void {
    this.pendingCache = null;
  }

  async submitIngestedEntry(
    input: SubmitIngestedEntryInput
  ): Promise<SubmitIngestedEntryResult> {
    return this.request<SubmitIngestedEntryResult>("/api/ingest/submit", {
      method: "POST",
      toolName: "submit_ingested_entry",
      body: input,
      timeoutMs: 120_000,
    });
  }

  async skeletonIngest(
    url: string
  ): Promise<{ entry_id: string; slug: string | null; status: string; tier?: string; title?: string | null }> {
    return this.request(
      "/api/admin/skeleton-ingest",
      {
        method: "POST",
        toolName: "skeleton_ingest",
        body: { url },
        timeoutMs: 60_000,
      }
    );
  }

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
    await this.requestNoContent(
      `/api/clusters/${encodeURIComponent(slug)}`,
      "DELETE",
      "delete_cluster"
    );
  }

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
        throw new DoplApiError(res.status, text);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

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
    await this.requestNoContent(
      `/api/entries/${encodeURIComponent(id)}`,
      "DELETE",
      "delete_entry"
    );
  }

  async listPacks(): Promise<{ packs: Pack[] }> {
    return this.request<{ packs: Pack[] }>("/api/knowledge/packs", {
      toolName: "kb_list_packs",
    });
  }

  async kbList(
    pack: string,
    opts: { category?: string; limit?: number } = {}
  ): Promise<{ pack_id: string; files: PackFileMeta[] }> {
    const qs = new URLSearchParams();
    if (opts.category) qs.set("category", opts.category);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ pack_id: string; files: PackFileMeta[] }>(
      `/api/knowledge/packs/${encodeURIComponent(pack)}/files${suffix}`,
      { toolName: "kb_list" }
    );
  }

  async kbGet(pack: string, path: string): Promise<{ file: PackFile }> {
    return this.request<{ file: PackFile }>(
      `/api/knowledge/packs/${encodeURIComponent(pack)}/file?path=${encodeURIComponent(path)}`,
      { toolName: "kb_get" }
    );
  }

  private async requestNoContent(
    path: string,
    method: string,
    toolName: string
  ): Promise<void> {
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
          throw new DoplAuthError(res.status, text);
        }
        throw new DoplApiError(res.status, text);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
