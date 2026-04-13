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
}
