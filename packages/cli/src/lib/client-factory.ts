import { DoplClient } from "@dopl/client";

import { defaultBaseUrl, readConfig } from "./config.js";

export interface ResolvedCredentials {
  apiKey: string;
  baseUrl: string;
  source: "flag" | "env" | "config";
}

export interface GlobalFlags {
  apiKey?: string;
  baseUrl?: string;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "No Dopl API key found. Run `dopl auth login` or set DOPL_API_KEY."
    );
    this.name = "MissingApiKeyError";
  }
}

export async function resolveCredentials(
  flags: GlobalFlags
): Promise<ResolvedCredentials> {
  const cfg = await readConfig();

  let apiKey: string | undefined;
  let source: ResolvedCredentials["source"] = "config";

  if (flags.apiKey) {
    apiKey = flags.apiKey;
    source = "flag";
  } else if (process.env.DOPL_API_KEY) {
    apiKey = process.env.DOPL_API_KEY;
    source = "env";
  } else if (cfg.apiKey) {
    apiKey = cfg.apiKey;
    source = "config";
  }

  if (!apiKey) throw new MissingApiKeyError();

  const baseUrl =
    flags.baseUrl ?? process.env.DOPL_BASE_URL ?? cfg.baseUrl ?? defaultBaseUrl();

  return { apiKey, baseUrl, source };
}

export async function createClient(flags: GlobalFlags): Promise<DoplClient> {
  const { apiKey, baseUrl } = await resolveCredentials(flags);
  return new DoplClient(baseUrl, apiKey, { toolHeaderName: "X-Dopl-Cli" });
}
