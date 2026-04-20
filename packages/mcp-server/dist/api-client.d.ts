import type { SearchResult, BuildResult, ListResult, DoplEntry, ClusterRow, ClusterDetail, ClusterQueryResult, CanvasPanel, PrepareIngestResult, SubmitIngestedEntryInput, SubmitIngestedEntryResult, PendingStatus } from "./types.js";
export declare class DoplClient {
    private baseUrl;
    private apiKey;
    private pendingCache;
    constructor(baseUrl: string, apiKey: string);
    /**
     * Public URL for an entry. The server hands this to AI clients instead of
     * leaking the internal UUID — the AI hyperlinks this in prose, and the
     * user sees a clean /e/<slug> URL.
     *
     * Returns null if no slug is available (extremely rare — the schema
     * guarantees every row has a slug, but MCP is called against older
     * backends during the cutover).
     */
    entryUrl(slug: string | null | undefined): string | null;
    /**
     * Build request headers, including the X-MCP-Tool header when a tool name
     * is provided. The API layer (`withMcpCredits` in src/lib/auth/with-auth.ts)
     * reads this header to record the MCP tool name in the `mcp_events`
     * analytics table. Without it, analytics would only see the HTTP endpoint,
     * which doesn't always map 1:1 to a tool name.
     */
    private buildHeaders;
    private request;
    searchSetups(params: {
        query: string;
        tags?: string[];
        use_case?: string;
        max_results?: number;
    }): Promise<SearchResult>;
    getSetup(id: string): Promise<DoplEntry>;
    /**
     * Fetch lightweight self-description metadata for a URL. Used by
     * the agent's post-submit `detected_links` review flow: after
     * filtering noise (badges, self-refs), the agent calls this per
     * surviving candidate to get authoritative one-liners for the
     * user-facing "want me to ingest these as separate entries?"
     * offer. Bounded ~1s per URL (5s hard timeout server-side).
     */
    describeLink(url: string): Promise<{
        url: string;
        type: string;
        title: string | null;
        description: string | null;
        metadata: Record<string, unknown>;
        error?: string;
    }>;
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
    getIngestContent(entryId: string, sourceUrl?: string): Promise<{
        entry_id: string;
        source_url: string | null;
        content: string;
        chars: number;
        truncated: boolean;
    }>;
    buildSolution(params: {
        brief: string;
        preferred_tools?: string[];
        excluded_tools?: string[];
        max_complexity?: string;
    }): Promise<BuildResult>;
    listSetups(params?: {
        use_case?: string;
        complexity?: string;
        limit?: number;
        offset?: number;
    }): Promise<ListResult>;
    listCanvasPanels(): Promise<CanvasPanel[]>;
    addCanvasPanel(entryId: string): Promise<{
        panel: CanvasPanel;
        created: boolean;
    }>;
    removeCanvasPanel(entryId: string): Promise<void>;
    createCluster(name: string, entryIds: string[]): Promise<ClusterRow>;
    listClusters(): Promise<{
        clusters: ClusterRow[];
    }>;
    getCluster(slug: string): Promise<ClusterDetail>;
    queryCluster(slug: string, query: string, maxResults?: number): Promise<ClusterQueryResult>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
    }>;
    getClusterBrain(slug: string): Promise<{
        instructions: string;
        memories: {
            id: string;
            content: string;
        }[];
    }>;
    saveClusterMemory(slug: string, content: string): Promise<{
        id: string;
        content: string;
    }>;
    /**
     * Fetch the canonical skill synthesis prompt + body template. Replaces
     * the old synthesizeBrain() method — all brain generation now happens
     * in the user's Claude Code (not on our server), so the client's job
     * is to grab the prompt and run synthesis locally.
     */
    getSkillTemplate(): Promise<{
        version: string;
        prompt: string;
        template: string;
        payload: string;
    }>;
    updateClusterBrain(slug: string, instructions: string): Promise<{
        id?: string;
        cluster_id?: string;
        instructions?: string;
        structure_warning?: {
            message: string;
            missing_sections: string[];
            suggestion: string;
        } | null;
    }>;
    /**
     * Agent-driven ingest, step 1/2. Server fetches + extracts; we get back
     * the raw content and the prompts to run locally. Pair with
     * `submitIngestedEntry` once the agent has generated the artifacts.
     * Longer timeout because link-following can fetch many pages.
     */
    prepareIngest(url: string, content?: {
        text?: string;
        images?: string[];
        links?: string[];
    }): Promise<PrepareIngestResult>;
    getPendingStatus(): Promise<PendingStatus>;
    invalidatePendingCache(): void;
    /**
     * Agent-driven ingest, step 2/2. Submits the artifacts the agent generated;
     * server embeds + persists. Synchronous — returns once the entry is
     * status="complete".
     */
    submitIngestedEntry(input: SubmitIngestedEntryInput): Promise<SubmitIngestedEntryResult>;
    /**
     * Admin-only skeleton ingestion — runs the cheap descriptor pipeline
     * against a public GitHub repo. Non-admin API keys get 404 from the
     * backend (admin surfaces are non-enumerable). Uses the existing
     * withAdminAuth gate in src/lib/auth/with-auth.ts, which reads
     * ADMIN_USER_ID.
     */
    skeletonIngest(url: string): Promise<{
        entry_id: string;
        slug: string | null;
        status: string;
        tier?: string;
        title?: string | null;
    }>;
    updateCluster(slug: string, updates: {
        name?: string;
        entry_ids?: string[];
    }): Promise<ClusterRow>;
    /**
     * Rename a chat panel on the user's canvas. Wraps the generic panels
     * PATCH endpoint so the agent has a purpose-named tool.
     */
    renameChat(panelId: string, title: string): Promise<void>;
    deleteCluster(slug: string): Promise<void>;
    updateClusterMemory(slug: string, memoryId: string, content: string): Promise<{
        id: string;
        content: string;
    }>;
    deleteClusterMemory(slug: string, memoryId: string): Promise<void>;
    updateEntry(id: string, updates: {
        title?: string;
        summary?: string;
        use_case?: string;
        complexity?: string;
    }): Promise<DoplEntry>;
    checkEntryUpdates(id: string): Promise<{
        entry_id: string;
        title: string | null;
        has_updates: boolean | null;
        reason?: string;
        ingested_at?: string;
        last_pushed_at?: string;
        days_since_ingestion?: number;
        days_since_push?: number;
        repo?: string;
    }>;
    deleteEntry(id: string): Promise<void>;
}
