export interface SIEEntry {
    id: string;
    title: string | null;
    summary: string | null;
    source_url: string;
    source_platform: string | null;
    use_case: string | null;
    complexity: string | null;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    tags?: {
        tag_type: string;
        tag_value: string;
    }[];
    sources?: {
        source_type: string;
        url: string | null;
    }[];
}
export interface SearchResult {
    entries: {
        entry_id: string;
        title: string | null;
        summary: string | null;
        similarity: number;
        readme: string | null;
        agents_md: string | null;
        manifest: Record<string, unknown> | null;
        relevance_explanation?: string;
    }[];
    synthesis?: {
        recommendation: string;
        composite_approach?: string;
    };
}
export interface BuildResult {
    composite_readme: string;
    composite_agents_md: string;
    source_entries: {
        entry_id: string;
        title: string;
        how_used: string;
    }[];
    confidence: {
        score: number;
        gaps: string[];
        suggestions: string[];
    };
}
export interface ListResult {
    entries: SIEEntry[];
    total: number;
    limit: number;
    offset: number;
}
export interface ClusterRow {
    id: string;
    slug: string;
    name: string;
    created_at: string;
    updated_at: string;
    panel_count: number;
}
export interface ClusterDetailEntry {
    entry_id: string;
    title: string | null;
    summary: string | null;
    readme: string | null;
    agents_md: string | null;
}
export interface ClusterDetail extends ClusterRow {
    entries: ClusterDetailEntry[];
}
export interface CanvasPanel {
    id: string;
    entry_id: string;
    title: string | null;
    summary: string | null;
    source_url: string | null;
    x: number;
    y: number;
    added_at: string;
}
export interface ClusterQueryResult {
    cluster_slug: string;
    results: {
        entry_id: string;
        title: string | null;
        summary: string | null;
        similarity: number;
        readme: string | null;
        agents_md: string | null;
        manifest: Record<string, unknown> | null;
    }[];
}
