import type { PendingStatus } from "./types.js";
import type { BuildResult, CanvasPanel, ClusterDetail, ClusterQueryResult, ClusterRow, DoplEntry, ListResult, Pack, PackFile, PackFileMeta, PrepareIngestResult, SearchResult, SubmitIngestedEntryInput, SubmitIngestedEntryResult } from "./types.js";
import { DoplTransport } from "./transport.js";
export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";
export declare class DoplClient {
    private transport;
    private pendingCache;
    constructor(baseUrl: string, apiKey: string, opts?: ConstructorParameters<typeof DoplTransport>[2]);
    getBaseUrl(): string;
    entryUrl(slug: string | null | undefined): string | null;
    searchSetups(params: {
        query: string;
        tags?: string[];
        use_case?: string;
        max_results?: number;
    }): Promise<SearchResult>;
    getSetup(id: string): Promise<DoplEntry>;
    describeLink(url: string): Promise<{
        url: string;
        type: string;
        title: string | null;
        description: string | null;
        metadata: Record<string, unknown>;
        error?: string;
    }>;
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
    prepareIngest(url: string, content?: {
        text?: string;
        images?: string[];
        links?: string[];
    }): Promise<PrepareIngestResult>;
    getPendingStatus(): Promise<PendingStatus>;
    invalidatePendingCache(): void;
    submitIngestedEntry(input: SubmitIngestedEntryInput): Promise<SubmitIngestedEntryResult>;
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
    listPacks(): Promise<{
        packs: Pack[];
    }>;
    kbList(pack: string, opts?: {
        category?: string;
        limit?: number;
    }): Promise<{
        pack_id: string;
        files: PackFileMeta[];
    }>;
    kbGet(pack: string, path: string): Promise<{
        file: PackFile;
    }>;
}
