import type { Command } from "commander";

export interface GlobalOptions {
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  verbose?: boolean;
  /** Active canvas (workspace) for this invocation. UUID. */
  canvas?: string;
}

export function getGlobalOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}
