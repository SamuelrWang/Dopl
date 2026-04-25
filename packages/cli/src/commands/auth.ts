import { Command } from "commander";
import {
  DoplApiError,
  DoplAuthError,
  DoplClient,
  DoplNetworkError,
} from "@dopl/client";

import {
  clearConfig,
  configFilePath,
  defaultBaseUrl,
  readConfig,
  writeConfig,
  type DoplConfig,
} from "../lib/config.js";
import { createClient, nonEmpty } from "../lib/client-factory.js";
import { getGlobalOpts } from "../lib/global-options.js";
import { writeError, writeJson, writeLine } from "../lib/output.js";
import { PromptAbortedError, promptSecret } from "../lib/prompt.js";
import { clientIdentifier } from "../lib/version.js";

interface LoginOpts {
  baseUrl?: string;
  verify: boolean;
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Dopl API credentials");

  auth
    .command("login")
    .description("Store a Dopl API key for this CLI")
    .option("--base-url <url>", "Override API base URL for this login")
    .option("--no-verify", "Skip the live /mcp-status ping before saving")
    .addHelpText(
      "after",
      "\nExamples:\n  $ dopl auth login\n  $ dopl auth login --base-url http://localhost:3000\n  $ dopl auth login --no-verify        # offline / proxy\n"
    )
    .action(async (cmdOpts: LoginOpts, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const existing = await readConfig();

      const key = await readKeyOrBail();
      if (!key) return;

      const baseUrl =
        nonEmpty(cmdOpts.baseUrl) ??
        nonEmpty(globals.baseUrl) ??
        nonEmpty(existing.baseUrl) ??
        defaultBaseUrl();

      if (cmdOpts.verify !== false) {
        try {
          const { is_admin } = await verifyKey(baseUrl, key);
          writeError(`Verified against ${baseUrl}${is_admin ? " (admin)" : ""}.`);
        } catch (err) {
          const verdict = describeVerifyFailure(err, baseUrl);
          writeError(verdict.message);
          process.exitCode = verdict.exitCode;
          return;
        }
      }

      const next: DoplConfig = { ...existing, apiKey: key };
      if (nonEmpty(cmdOpts.baseUrl) || nonEmpty(globals.baseUrl)) {
        next.baseUrl = baseUrl;
      }
      await writeConfig(next);
      writeError(`Saved to ${configFilePath()} (base: ${baseUrl})`);
    });

  auth
    .command("logout")
    .description("Remove the stored Dopl API key")
    .action(async () => {
      const removed = await clearConfig();
      if (removed) writeError(`Cleared ${configFilePath()}`);
      else writeError("No credentials were stored.");
    });

  auth
    .command("whoami")
    .description("Check the current key's identity and admin status")
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const client = await createClient(globals);
      const res = await pingWhoami(client);
      if (globals.json) {
        writeJson(res);
        return;
      }
      writeLine(`Status: ok`);
      writeLine(`Admin:  ${res.is_admin ? "yes" : "no"}`);
      writeLine(`Base:   ${res.baseUrl}`);
    });
}

async function readKeyOrBail(): Promise<string | null> {
  try {
    const key = await promptSecret("Paste your Dopl API key (sk-dopl-…): ");
    const trimmed = key.trim();
    if (!trimmed) {
      writeError("No key provided. Aborted.");
      process.exitCode = 1;
      return null;
    }
    if (!trimmed.startsWith("sk-dopl-")) {
      writeError("Warning: key does not start with `sk-dopl-`.");
    }
    return trimmed;
  } catch (err) {
    if (err instanceof PromptAbortedError) {
      writeError("\nAborted.");
      process.exitCode = 130;
      return null;
    }
    throw err;
  }
}

async function verifyKey(baseUrl: string, apiKey: string): Promise<{ is_admin: boolean }> {
  const client = new DoplClient(baseUrl, apiKey, {
    toolHeaderName: "X-Dopl-Cli",
    clientIdentifier,
  });
  return client.pingMcpStatus();
}

function describeVerifyFailure(
  err: unknown,
  baseUrl: string
): { message: string; exitCode: number } {
  if (err instanceof DoplAuthError) {
    return {
      message: `Authentication failed (${err.status}): key not saved. Pass --no-verify to override.`,
      exitCode: 2,
    };
  }
  if (err instanceof DoplApiError) {
    return {
      message: `Server rejected the key (${err.status}): ${err.message}. Key not saved.`,
      exitCode: err.status >= 500 ? 3 : 1,
    };
  }
  if (err instanceof DoplNetworkError) {
    return {
      message: `Could not reach ${baseUrl}: ${err.message}. Key not saved. Re-run with --no-verify to save anyway.`,
      exitCode: 3,
    };
  }
  throw err;
}

async function pingWhoami(
  client: DoplClient
): Promise<{ is_admin: boolean; baseUrl: string }> {
  const baseUrl = client.getBaseUrl();
  const { is_admin } = await client.pingMcpStatus();
  return { is_admin, baseUrl };
}
