export interface DoplConfig {
    apiKey?: string;
    baseUrl?: string;
}
export declare function readConfig(): Promise<DoplConfig>;
export declare function writeConfig(config: DoplConfig): Promise<void>;
export declare function clearConfig(): Promise<boolean>;
export declare function configFilePath(): string;
export declare function defaultBaseUrl(): string;
