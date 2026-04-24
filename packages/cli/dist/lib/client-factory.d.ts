import { DoplClient } from "@dopl/client";
export interface ResolvedCredentials {
    apiKey: string;
    baseUrl: string;
    source: "flag" | "env" | "config";
}
export interface GlobalFlags {
    apiKey?: string;
    baseUrl?: string;
}
export declare class MissingApiKeyError extends Error {
    constructor();
}
export declare function resolveCredentials(flags: GlobalFlags): Promise<ResolvedCredentials>;
export declare function createClient(flags: GlobalFlags): Promise<DoplClient>;
