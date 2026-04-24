#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const client_1 = require("@dopl/client");
const client_factory_js_1 = require("../lib/client-factory.js");
const output_js_1 = require("../lib/output.js");
const auth_js_1 = require("../commands/auth.js");
const packs_js_1 = require("../commands/packs.js");
const EXIT_USER_ERROR = 1;
const EXIT_AUTH = 2;
const EXIT_NETWORK = 3;
async function run() {
    const program = new commander_1.Command();
    program
        .name("dopl")
        .description("Dopl CLI — browse and query the Dopl knowledge base from the shell")
        .version("0.1.0")
        .option("--api-key <key>", "Dopl API key (overrides env + config)")
        .option("--base-url <url>", "API base URL (overrides env + config)")
        .option("--json", "Emit JSON instead of human-readable output", false)
        .configureHelp({ showGlobalOptions: true });
    (0, auth_js_1.registerAuthCommands)(program);
    (0, packs_js_1.registerPacksCommands)(program);
    await program.parseAsync(process.argv);
}
function handleError(err) {
    if (err instanceof client_factory_js_1.MissingApiKeyError) {
        (0, output_js_1.writeError)(err.message);
        process.exit(EXIT_AUTH);
    }
    if (err instanceof client_1.DoplAuthError) {
        (0, output_js_1.writeError)(`Authentication failed (${err.status}). Check your API key or run \`dopl auth login\`.`);
        process.exit(EXIT_AUTH);
    }
    if (err instanceof client_1.DoplApiError) {
        if (err.status === 404) {
            (0, output_js_1.writeError)(`Not found (404): ${err.responseBody}`);
            process.exit(EXIT_USER_ERROR);
        }
        if (err.status >= 400 && err.status < 500) {
            (0, output_js_1.writeError)(`Request failed (${err.status}): ${err.responseBody}`);
            process.exit(EXIT_USER_ERROR);
        }
        (0, output_js_1.writeError)(`Server error (${err.status}): ${err.responseBody}`);
        process.exit(EXIT_NETWORK);
    }
    if (err instanceof client_1.DoplNetworkError) {
        (0, output_js_1.writeError)(`Network error: ${err.message}`);
        process.exit(EXIT_NETWORK);
    }
    (0, output_js_1.writeError)(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_USER_ERROR);
}
run().catch(handleError);
