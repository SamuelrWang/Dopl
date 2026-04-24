#!/usr/bin/env node
import { Command } from "commander";
import {
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
} from "@dopl/client";

import { MissingApiKeyError } from "../lib/client-factory.js";
import { writeError } from "../lib/output.js";
import { registerAuthCommands } from "../commands/auth.js";
import { registerPacksCommands } from "../commands/packs.js";

const EXIT_USER_ERROR = 1;
const EXIT_AUTH = 2;
const EXIT_NETWORK = 3;

async function run(): Promise<void> {
  const program = new Command();
  program
    .name("dopl")
    .description("Dopl CLI — browse and query the Dopl knowledge base from the shell")
    .version("0.1.0")
    .option("--api-key <key>", "Dopl API key (overrides env + config)")
    .option("--base-url <url>", "API base URL (overrides env + config)")
    .option("--json", "Emit JSON instead of human-readable output", false)
    .configureHelp({ showGlobalOptions: true });

  registerAuthCommands(program);
  registerPacksCommands(program);

  await program.parseAsync(process.argv);
}

function handleError(err: unknown): never {
  if (err instanceof MissingApiKeyError) {
    writeError(err.message);
    process.exit(EXIT_AUTH);
  }
  if (err instanceof DoplAuthError) {
    writeError(`Authentication failed (${err.status}). Check your API key or run \`dopl auth login\`.`);
    process.exit(EXIT_AUTH);
  }
  if (err instanceof DoplApiError) {
    if (err.status === 404) {
      writeError(`Not found (404): ${err.responseBody}`);
      process.exit(EXIT_USER_ERROR);
    }
    if (err.status >= 400 && err.status < 500) {
      writeError(`Request failed (${err.status}): ${err.responseBody}`);
      process.exit(EXIT_USER_ERROR);
    }
    writeError(`Server error (${err.status}): ${err.responseBody}`);
    process.exit(EXIT_NETWORK);
  }
  if (err instanceof DoplNetworkError) {
    writeError(`Network error: ${err.message}`);
    process.exit(EXIT_NETWORK);
  }
  writeError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_USER_ERROR);
}

run().catch(handleError);
