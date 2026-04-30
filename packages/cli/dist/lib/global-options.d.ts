import type { Command } from "commander";
export interface GlobalOptions {
    json?: boolean;
    apiKey?: string;
    baseUrl?: string;
    verbose?: boolean;
    /** Active workspace for this invocation. UUID. */
    workspace?: string;
}
export declare function getGlobalOpts(cmd: Command): GlobalOptions;
