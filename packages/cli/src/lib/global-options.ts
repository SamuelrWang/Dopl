import type { Command } from "commander";

export interface GlobalOptions {
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  verbose?: boolean;
}

export function getGlobalOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}
