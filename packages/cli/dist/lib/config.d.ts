export interface DoplConfig {
    apiKey?: string;
    baseUrl?: string;
    /** Active workspace UUID. Set by `dopl workspace use <slug>`. */
    workspaceId?: string;
    /** Slug of the active workspace. Stored alongside workspaceId for display. */
    workspaceSlug?: string;
}
export declare function readConfig(): Promise<DoplConfig>;
export declare function writeConfig(config: DoplConfig): Promise<void>;
export declare function clearConfig(): Promise<boolean>;
export declare function configFilePath(): string;
export declare function defaultBaseUrl(): string;
