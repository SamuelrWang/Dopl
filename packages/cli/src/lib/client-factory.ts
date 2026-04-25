import { DoplClient } from "@dopl/client";

import { defaultBaseUrl, readConfig } from "./config.js";
import { clientIdentifier } from "./version.js";

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

export function nonEmpty(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveCredentials(
  flags: GlobalFlags
): Promise<ResolvedCredentials> {
  const cfg = await readConfig();

  let apiKey: string | undefined;
  let source: ResolvedCredentials["source"] = "config";

  const fromFlag = nonEmpty(flags.apiKey);
  const fromEnv = nonEmpty(process.env.DOPL_API_KEY);
  const fromConfig = nonEmpty(cfg.apiKey);

  if (fromFlag) {
    apiKey = fromFlag;
    source = "flag";
  } else if (fromEnv) {
    apiKey = fromEnv;
    source = "env";
  } else if (fromConfig) {
    apiKey = fromConfig;
    source = "config";
  }

  if (!apiKey) throw new MissingApiKeyError();

  const baseUrl =
    nonEmpty(flags.baseUrl) ??
    nonEmpty(process.env.DOPL_BASE_URL) ??
    nonEmpty(cfg.baseUrl) ??
    defaultBaseUrl();

  return { apiKey, baseUrl, source };
}

export async function createClient(flags: GlobalFlags): Promise<DoplClient> {
  const { apiKey, baseUrl } = await resolveCredentials(flags);
  return new DoplClient(baseUrl, apiKey, {
    toolHeaderName: "X-Dopl-Cli",
    clientIdentifier,
  });
}
