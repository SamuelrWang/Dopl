export interface DoplTransportOptions {
    toolHeaderName?: string;
    clientIdentifier?: string;
}
export interface RequestOptions {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    toolName?: string;
    retries?: number;
}
export declare class DoplTransport {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly toolHeaderName;
    private readonly clientIdentifier;
    constructor(baseUrl: string, apiKey: string, opts?: DoplTransportOptions);
    getBaseUrl(): string;
    request<T>(path: string, options?: RequestOptions): Promise<T>;
    requestNoContent(path: string, method: string, toolName: string, body?: unknown): Promise<void>;
    buildHeaders(toolName?: string, withJsonBody?: boolean): Record<string, string>;
    private doFetch;
}
