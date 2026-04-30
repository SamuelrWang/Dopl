import { DoplClient } from "@dopl/client";
export interface ResolvedCredentials {
    apiKey: string;
    baseUrl: string;
    source: "flag" | "env" | "config";
    /** Active workspace UUID, if any. */
    workspaceId?: string;
    /** Active workspace slug, if any (for display). */
    workspaceSlug?: string;
}
export interface GlobalFlags {
    apiKey?: string;
    baseUrl?: string;
    /** Override the active workspace for a single command (slug or UUID). */
    workspace?: string;
}
export declare class MissingApiKeyError extends Error {
    constructor();
}
export declare function nonEmpty(value: string | undefined | null): string | undefined;
export declare function resolveCredentials(flags: GlobalFlags): Promise<ResolvedCredentials>;
export declare function createClient(flags: GlobalFlags): Promise<DoplClient>;
