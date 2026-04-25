import type { Command } from "commander";
export interface GlobalOptions {
    json?: boolean;
    apiKey?: string;
    baseUrl?: string;
    verbose?: boolean;
}
export declare function getGlobalOpts(cmd: Command): GlobalOptions;
