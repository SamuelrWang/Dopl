#!/usr/bin/env node
import createDebug from "debug";
import { Command } from "commander";
import {
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
} from "@dopl/client";

import { MissingApiKeyError } from "../lib/client-factory.js";
import { getGlobalOpts } from "../lib/global-options.js";
import { writeError } from "../lib/output.js";
import { registerAuthCommands } from "../commands/auth.js";
import { registerPacksCommands } from "../commands/packs.js";
import { maybeNotifyOfUpdate } from "../lib/update-check.js";
import { packageVersion } from "../lib/version.js";

const cliLog = createDebug("dopl:cli");

const EXIT_USER_ERROR = 1;
const EXIT_AUTH = 2;
const EXIT_NETWORK = 3;

async function run(): Promise<void> {
  await maybeNotifyOfUpdate();

  const program = new Command();
  program
    .name("dopl")
    .description("Dopl CLI — browse and query the Dopl knowledge base from the shell")
    .version(packageVersion)
    .option("--api-key <key>", "Dopl API key (overrides env + config)")
    .option("--base-url <url>", "API base URL (overrides env + config)")
    .option("--json", "Emit JSON instead of human-readable output", false)
    .option("--verbose", "Log request/response trace to stderr", false)
    .option("--no-update-notifier", "Skip the once-a-day npm update check")
    .configureHelp({ showGlobalOptions: true });

  program.hook("preAction", (_thisCommand, actionCommand) => {
    const opts = getGlobalOpts(actionCommand);
    if (opts.verbose) createDebug.enable("dopl:*");
    cliLog(
      "command=%s verbose=%s json=%s",
      actionCommand.name(),
      opts.verbose ? "yes" : "no",
      opts.json ? "yes" : "no"
    );
  });

  registerAuthCommands(program);
  registerPacksCommands(program);

  await program.parseAsync(process.argv);
}

function formatApiError(err: DoplApiError): string | null {
  if (err.code && err.apiMessage) return `${err.code}: ${err.apiMessage}`;
  if (err.apiMessage) return err.apiMessage;
  return null;
}

function handleError(err: unknown): never {
  if (err instanceof MissingApiKeyError) {
    writeError(err.message);
    process.exit(EXIT_AUTH);
  }
  if (err instanceof DoplAuthError) {
    const detail = formatApiError(err);
    writeError(
      `Authentication failed (${err.status})${detail ? `: ${detail}` : ""}. Check your API key or run \`dopl auth login\`.`
    );
    process.exit(EXIT_AUTH);
  }
  if (err instanceof DoplApiError) {
    const detail = formatApiError(err);
    const prefix = err.status >= 500 ? "Server error" : "Request failed";
    writeError(`${prefix} (${err.status})${detail ? `: ${detail}` : ""}`);
    process.exit(err.status >= 500 ? EXIT_NETWORK : EXIT_USER_ERROR);
  }
  if (err instanceof DoplNetworkError) {
    writeError(`Network error: ${err.message}`);
    process.exit(EXIT_NETWORK);
  }
  writeError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_USER_ERROR);
}

run().catch(handleError);
