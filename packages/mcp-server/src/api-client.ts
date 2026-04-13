import type {
  SearchResult,
  BuildResult,
  ListResult,
  SIEEntry,
  ClusterRow,
  ClusterDetail,
  ClusterQueryResult,
  CanvasPanel,
} from "./types.js";

export class SIEClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
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

    return res.json() as Promise<T>;
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

  async getSetup(id: string): Promise<SIEEntry> {
    return this.request<SIEEntry>(`/api/entries/${id}`);
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
}
