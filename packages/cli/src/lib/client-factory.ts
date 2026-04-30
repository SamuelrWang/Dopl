import { DoplClient } from "@dopl/client";

import { defaultBaseUrl, readConfig } from "./config.js";
import { clientIdentifier } from "./version.js";

export interface ResolvedCredentials {
  apiKey: string;
  baseUrl: string;
  source: "flag" | "env" | "config";
  /** Active canvas UUID, if any. */
  canvasId?: string;
  /** Active canvas slug, if any (for display). */
  canvasSlug?: string;
}

export interface GlobalFlags {
  apiKey?: string;
  baseUrl?: string;
  /** Override the active canvas for a single command (slug or UUID). */
  canvas?: string;
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

  // Canvas resolution priority:
  //   --canvas flag (UUID; slug-flag handling lives in the canvas
  //     command which resolves to UUID before constructing the client)
  //   DOPL_CANVAS_ID env var (UUID)
  //   config file canvasId
  //   nothing → server falls back to the user's default canvas
  const canvasId =
    nonEmpty(flags.canvas) ??
    nonEmpty(process.env.DOPL_CANVAS_ID) ??
    nonEmpty(cfg.canvasId);
  const canvasSlug =
    flags.canvas && flags.canvas === cfg.canvasId
      ? cfg.canvasSlug
      : nonEmpty(cfg.canvasSlug);

  return { apiKey, baseUrl, source, canvasId, canvasSlug };
}

export async function createClient(flags: GlobalFlags): Promise<DoplClient> {
  const { apiKey, baseUrl, canvasId } = await resolveCredentials(flags);
  return new DoplClient(baseUrl, apiKey, {
    toolHeaderName: "X-Dopl-Cli",
    clientIdentifier,
    canvasId,
  });
}
