/**
 * Public types for the integrations API. Mirrors the server-side
 * domain types but stays plain so the client can be consumed
 * without pulling Next.js / Supabase types.
 */
export type IntegrationProvider = "notion" | "gmail" | "google_drive";
export type IntegrationStatusValue = "connected" | "needs_auth" | "error" | "disconnected";
export type ConnectResponse = {
    status: "connected";
} | {
    status: "needs_auth";
    auth_url: string;
};
export type IntegrationStatusResponse = {
    status: IntegrationStatusValue;
};
export type IntegrationObjectSummary = {
    id: string;
    title: string;
    url: string | null;
    lastModified: string | null;
};
export type IntegrationListResponse = {
    objects: IntegrationObjectSummary[];
    next_cursor: string | null;
};
export type ReadIntegrationObjectResponse = {
    provider: IntegrationProvider;
    object_id: string;
    title: string;
    url: string | null;
    last_modified: string | null;
    body: string;
};
export type IntegrationActionParamSpec = {
    type: "string" | "number" | "boolean";
    description: string;
    required: boolean;
};
export type IntegrationActionDescriptor = {
    name: string;
    summary: string;
    params: Record<string, IntegrationActionParamSpec>;
};
export type IntegrationActionsResponse = {
    actions: IntegrationActionDescriptor[];
};
export type IntegrationActionResultResponse = {
    ok: true;
    data: Record<string, unknown>;
} | {
    ok: false;
    error: string;
};
export type PrepareFromIntegrationResponse = {
    status: "ready";
    entry_id: string;
    slug: string;
    source_url: string;
    source_platform: string;
    thumbnail_url: string | null;
    sources: Array<{
        url: string | null;
        source_type: string;
        depth: number;
        chars: number;
    }>;
    fetch_warnings: Array<{
        url: string | null;
        reason: string;
        fetch_status_code: number | null;
    }>;
    detected_links: string[];
    images: Array<{
        image_id: string;
        base64: string;
        mimeType: string;
    }>;
    prompts: unknown;
    instructions: string;
};
