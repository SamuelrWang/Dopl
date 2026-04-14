import type { SearchResult, BuildResult, ListResult, SIEEntry, ClusterRow, ClusterDetail, ClusterQueryResult, CanvasPanel } from "./types.js";
export declare class SIEClient {
    private baseUrl;
    private apiKey;
    constructor(baseUrl: string, apiKey: string);
    private request;
    searchSetups(params: {
        query: string;
        tags?: string[];
        use_case?: string;
        max_results?: number;
        include_synthesis?: boolean;
    }): Promise<SearchResult>;
    getSetup(id: string): Promise<SIEEntry>;
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
    pingMcpStatus(): Promise<void>;
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
    synthesizeBrain(entries: Array<{
        title: string;
        agents_md: string;
        readme: string;
    }>): Promise<{
        instructions: string;
    }>;
    updateClusterBrain(slug: string, instructions: string): Promise<void>;
    ingestUrl(url: string, content?: {
        text?: string;
        images?: string[];
        links?: string[];
    }): Promise<{
        entry_id: string;
        status: string;
        stream_url?: string;
        title?: string | null;
    }>;
    updateCluster(slug: string, updates: {
        name?: string;
        entry_ids?: string[];
    }): Promise<ClusterRow>;
    deleteCluster(slug: string): Promise<void>;
    deleteClusterMemory(slug: string, memoryId: string): Promise<void>;
    updateEntry(id: string, updates: {
        title?: string;
        summary?: string;
        use_case?: string;
        complexity?: string;
    }): Promise<SIEEntry>;
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
    synthesizeIncremental(existingInstructions: string, newEntry: {
        title: string;
        agents_md: string;
        readme: string;
    }): Promise<{
        instructions: string;
    }>;
    deleteEntry(id: string): Promise<void>;
}
