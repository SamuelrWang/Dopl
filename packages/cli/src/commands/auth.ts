import { createInterface } from "readline";

import { Command } from "commander";
import { DoplAuthError, DoplClient } from "@dopl/client";

import {
  clearConfig,
  configFilePath,
  defaultBaseUrl,
  readConfig,
  writeConfig,
} from "../lib/config.js";
import { createClient } from "../lib/client-factory.js";
import { writeError, writeJson, writeLine } from "../lib/output.js";

interface GlobalOptions {
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
}

function getGlobalOpts(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>();
}

async function promptSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Dopl API credentials");

  auth
    .command("login")
    .description("Store a Dopl API key for this CLI")
    .option("--base-url <url>", "Override API base URL for this login")
    .action(async (cmdOpts: { baseUrl?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      const existing = await readConfig();
      const key = await promptSecret("Paste your Dopl API key (sk-dopl-…): ");
      if (!key) {
        writeError("No key provided. Aborted.");
        process.exitCode = 1;
        return;
      }
      if (!key.startsWith("sk-dopl-")) {
        writeError("Warning: key does not start with `sk-dopl-`. Saving anyway.");
      }
      const baseUrl = cmdOpts.baseUrl ?? globals.baseUrl ?? existing.baseUrl;
      const next = {
        ...existing,
        apiKey: key,
        ...(baseUrl ? { baseUrl } : {}),
      };
      await writeConfig(next);
      const effectiveBase = next.baseUrl ?? defaultBaseUrl();
      writeError(`Saved to ${configFilePath()} (base: ${effectiveBase})`);
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
      writeLine(`Status: ${res.ok ? "ok" : "error"}`);
      writeLine(`Admin:  ${res.is_admin ? "yes" : "no"}`);
      writeLine(`Base:   ${res.baseUrl}`);
    });
}

async function pingWhoami(
  client: DoplClient
): Promise<{ ok: boolean; is_admin: boolean; baseUrl: string }> {
  const baseUrl = client.getBaseUrl();
  try {
    const { is_admin } = await client.pingMcpStatus();
    return { ok: true, is_admin, baseUrl };
  } catch (err) {
    if (err instanceof DoplAuthError) throw err;
    return { ok: false, is_admin: false, baseUrl };
  }
}
