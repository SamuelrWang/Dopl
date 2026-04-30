import { DoplClient } from "@dopl/client";

import { defaultBaseUrl, readConfig } from "./config.js";
import { clientIdentifier } from "./version.js";

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

  // Workspace resolution priority:
  //   --workspace flag (UUID; slug-flag handling lives in the workspace
  //     command which resolves to UUID before constructing the client)
  //   DOPL_WORKSPACE_ID env var (UUID)
  //   config file workspaceId
  //   nothing → server falls back to the user's default workspace
  const workspaceId =
    nonEmpty(flags.workspace) ??
    nonEmpty(process.env.DOPL_WORKSPACE_ID) ??
    nonEmpty(cfg.workspaceId);
  const workspaceSlug =
    flags.workspace && flags.workspace === cfg.workspaceId
      ? cfg.workspaceSlug
      : nonEmpty(cfg.workspaceSlug);

  return { apiKey, baseUrl, source, workspaceId, workspaceSlug };
}

export async function createClient(flags: GlobalFlags): Promise<DoplClient> {
  const { apiKey, baseUrl, workspaceId } = await resolveCredentials(flags);
  return new DoplClient(baseUrl, apiKey, {
    toolHeaderName: "X-Dopl-Cli",
    clientIdentifier,
    workspaceId,
  });
}
